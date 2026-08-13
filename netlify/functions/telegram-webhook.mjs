// netlify/functions/telegram-webhook.mjs
//
// 改用 Webhook 模式：Telegram 一收到頻道新消息，立刻主動打這支 function，
// 不再需要每 2 分鐘去 getUpdates 問一次「有新消息嗎」。
// 好處：消息幾乎即時處理（1 秒內）、不會因為錯過某一輪輪詢而漏掉、
// 不用管 offset/last_update_id 這種容易出錯的進度追蹤。
//
// 網址結構：每個頻道各自一個 Webhook 網址，路徑帶著這個頻道在 telegram_sync_configs 的 id，
// 這樣 Telegram 打進來時，一看網址就知道是哪個頻道的消息。
// 例如：https://tradewithus888.com/.netlify/functions/telegram-webhook/029c0f64-9640-4e73-bf1a-5f99b4c964c5

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const SITE_URL = 'https://tradewithus888.com';

function sbHeaders(extra = {}) {
  return {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function sbFetch(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: { ...sbHeaders(), ...(options.headers || {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Supabase ${path} failed: ${res.status} ${text}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function hkNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Hong_Kong' }));
}

function hkDateStr(d) {
  return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Hong_Kong' });
}

function hkMinuteStr(d) {
  return d.toLocaleString('sv-SE', { timeZone: 'Asia/Hong_Kong' }).slice(0, 16).replace('T', ' ');
}

// ---------- 把这则消息接进今天的文章（新建或续接） ----------
async function appendToTodayArticle(config, timeHeader, contentBlock, minuteKey) {
  const today = hkDateStr(hkNow());
  const divider = { type: 'text', value: '──────────────────' };

  let article = null;
  if (config.current_article_id && config.current_article_date === today) {
    const rows = await sbFetch(`articles?id=eq.${config.current_article_id}&select=id,blocks,top_minute_key,top_minute_count`);
    article = rows?.[0] || null;
  }

  if (!article) {
    const productRows = await sbFetch(`products?id=eq.${config.target_product_id}&select=name`);
    const productName = productRows?.[0]?.name || '';
    const title = `${productName} 實時資訊`;
    const created = await sbFetch('articles', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        product_id: config.target_product_id,
        category_id: config.target_category_id || null,
        title,
        summary: '',
        blocks: [timeHeader, ...contentBlock],
        top_minute_key: minuteKey,
        top_minute_count: 1 + contentBlock.length,
      }),
    });
    const articleId = created[0].id;
    await sbFetch(`telegram_sync_configs?id=eq.${config.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ current_article_id: articleId, current_article_date: today }),
    });
    return articleId;
  }

  const articleId = article.id;
  let newBlocks, newTopKey, newTopCount;

  if (article.top_minute_key === minuteKey) {
    const top = article.blocks.slice(0, article.top_minute_count);
    const rest = article.blocks.slice(article.top_minute_count);
    newBlocks = [...top, ...contentBlock, ...rest];
    newTopKey = minuteKey;
    newTopCount = article.top_minute_count + contentBlock.length;
  } else {
    newBlocks = article.blocks.length
      ? [timeHeader, ...contentBlock, divider, ...article.blocks]
      : [timeHeader, ...contentBlock];
    newTopKey = minuteKey;
    newTopCount = 1 + contentBlock.length;
  }

  await sbFetch(`articles?id=eq.${articleId}`, {
    method: 'PATCH',
    body: JSON.stringify({ blocks: newBlocks, top_minute_key: newTopKey, top_minute_count: newTopCount }),
  });
  return articleId;
}

async function stageEmailContent(productId, minuteKey, articleId, newLine) {
  // 用 upsert：同一个 (product_id, minute_key) 已经有暂存记录的话，把新内容接在后面、更新 last_updated_at；
  // 没有的话新建一笔。之后由独立排程判断「多久没更新了」才真正寄出，达到「同一分钟只寄一次」的效果。
  const existing = await sbFetch(
    `email_notify_staging?product_id=eq.${productId}&minute_key=eq.${encodeURIComponent(minuteKey)}&select=content`
  );
  const prevContent = existing?.[0]?.content;

  if (prevContent !== undefined) {
    const merged = prevContent ? `${prevContent}\n${newLine}` : newLine;
    await sbFetch(
      `email_notify_staging?product_id=eq.${productId}&minute_key=eq.${encodeURIComponent(minuteKey)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ content: merged, article_id: articleId, last_updated_at: new Date().toISOString(), flushed: false }),
      }
    );
  } else {
    await sbFetch('email_notify_staging', {
      method: 'POST',
      body: JSON.stringify({ product_id: productId, minute_key: minuteKey, article_id: articleId, content: newLine }),
    });
  }
}

// ---------- Netlify Function 入口 ----------
export default async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const url = new URL(req.url);
  const parts = url.pathname.split('/').filter(Boolean);
  const configId = parts[parts.length - 1];

  const secretHeader = req.headers.get('x-telegram-bot-api-secret-token');
  if (!WEBHOOK_SECRET || secretHeader !== WEBHOOK_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  let update;
  try {
    update = await req.json();
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  try {
    const configs = await sbFetch(`telegram_sync_configs?id=eq.${configId}&select=*`);
    const config = configs?.[0];
    if (!config || !config.enabled) {
      return new Response(JSON.stringify({ status: 'not_configured' }), { status: 200 });
    }

    const post = update.channel_post || update.message;
    if (!post) return new Response(JSON.stringify({ status: 'ignored' }), { status: 200 });
    if (String(post.chat?.id) !== String(config.source_chat_id)) {
      return new Response(JSON.stringify({ status: 'ignored_wrong_chat' }), { status: 200 });
    }

    const content = post.text || post.caption || '';
    const photos = post.photo;
    if (!content && !photos) {
      return new Response(JSON.stringify({ status: 'ignored_empty' }), { status: 200 });
    }

    const msgDate = new Date(post.date * 1000);
    const minuteKey = hkMinuteStr(msgDate);
    const timeHeader = { type: 'text', value: '🕐 ' + minuteKey };
    const contentBlock = [];
    if (content) contentBlock.push({ type: 'text', value: content });

    if (photos && photos.length > 0) {
      try {
        const best = photos[photos.length - 1];
        const fileRes = await fetch(`https://api.telegram.org/bot${config.bot_token}/getFile?file_id=${best.file_id}`);
        const fileData = await fileRes.json();
        const filePath = fileData?.result?.file_path;
        if (filePath) {
          contentBlock.push({
            type: 'image',
            value: `https://api.telegram.org/file/bot${config.bot_token}/${filePath}`,
          });
        }
      } catch (imgErr) {
        await sbFetch('telegram_sync_errors', {
          method: 'POST',
          body: JSON.stringify({ update_id: update.update_id, error_message: '抓图失败：' + imgErr.message, raw_update: update }),
        }).catch(() => {});
      }
    }

    const articleId = await appendToTodayArticle(config, timeHeader, contentBlock, minuteKey);
    await stageEmailContent(config.target_product_id, minuteKey, articleId, content).catch(() => {});

    return new Response(JSON.stringify({ status: 'ok', article_id: articleId }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    await sbFetch('telegram_sync_errors', {
      method: 'POST',
      body: JSON.stringify({ update_id: update?.update_id, error_message: err.message, raw_update: update }),
    }).catch(() => {});
    // Webhook 一律回 200，避免 Telegram 因为「送达失败」而重试导致重复处理
    return new Response(JSON.stringify({ status: 'error', detail: err.message }), { status: 200 });
  }
};
