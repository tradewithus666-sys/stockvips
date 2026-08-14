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

// ---------- 把这则消息接进今天的文章（新建或续接）----------
// 改成呼叫资料库函式做，让「读取 -> 计算 -> 写回」整个包在一个有行级锁保护的
// 原子操作里，同一频道如果好几个 webhook 请求几乎同时打进来（例如转发工具一次
// 补发一大串历史消息），会被强制排队依序处理，不会再互相覆盖彼此的内容。
async function appendToTodayArticle(config, timeHeader, contentBlock, minuteKey) {
  const result = await sbFetch('rpc/append_telegram_message', {
    method: 'POST',
    body: JSON.stringify({
      p_config_id: config.id,
      p_time_header: timeHeader,
      p_content_block: contentBlock,
      p_minute_key: minuteKey,
    }),
  });
  if (result?.status !== 'ok') {
    throw new Error('append_telegram_message failed: ' + JSON.stringify(result));
  }
  return result.article_id;
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

    // 「加入审核」事件：有人拿邀请连结申请加入频道，交给资料库那边判断
    // 这个 Telegram 帐号有没有绑定网站会员、且真的持有有效权限，符合才自动核准
    if (update.chat_join_request) {
      const req = update.chat_join_request;
      const result = await sbFetch('rpc/handle_telegram_join_request', {
        method: 'POST',
        body: JSON.stringify({
          p_chat_id: String(req.chat.id),
          p_telegram_user_id: String(req.from.id),
          p_bot_token: config.bot_token,
        }),
      });
      return new Response(JSON.stringify(result), { status: 200 });
    }

    // 有些第三方转发工具（例如 ForwardMsg）是用「使用者自己的 Telegram 帐号」模拟操作，
    // 而不是走一般 Bot API 直接发送，实际送出的事件类型可能是「已编辑」而不是「新发布」
    // （例如工具先发一个占位消息、再编辑内容进去），这里把这几种类型都一并接受
    const post = update.channel_post || update.message || update.edited_channel_post || update.edited_message;
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
