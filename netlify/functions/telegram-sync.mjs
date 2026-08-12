// netlify/functions/telegram-sync.js
//
// 把「读 Telegram、分组、写文章、发 email 通知」整套逻辑从 Supabase RPC 搬过来这里，
// 用 Netlify Function（真正的 Node.js 伺服器环境）执行，不再受 Supabase 那边
// 连到 Telegram 网路不稳定、以及 anon RPC 呼叫大约 5 秒隐性逾时上限的影响。
//
// 触发方式：外部排程服务（cron-job.org）改成打这支 function 的网址，
// 带一个 secret 参数做验证（做法跟原本 cron_sync_telegram_messages 一样）。

const SUPABASE_URL = process.env.SUPABASE_URL; // 例如 https://mnuuylntergeqktsezkm.supabase.co
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; // 绝对不要写死在程式码里
const SYNC_SECRET = process.env.TELEGRAM_SYNC_SECRET; // 你自己设定的密钥，外部排程呼叫时要带这个
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

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------- 拿全域互斥锁，避免上一轮还没跑完、下一轮又被触发，重复处理 ----------
async function acquireLock() {
  // telegram_sync_lock 表：id=1 单笔row，locked=false 才能抢到锁
  const rows = await sbFetch(
    'telegram_sync_lock?id=eq.1&locked=eq.false',
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ locked: true, locked_at: new Date().toISOString() }),
    }
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function releaseLock() {
  await sbFetch('telegram_sync_lock?id=eq.1', {
    method: 'PATCH',
    body: JSON.stringify({ locked: false }),
  }).catch(() => {});
}

// ---------- Telegram API ----------
async function telegramGet(botToken, method, params = '') {
  const url = `https://api.telegram.org/bot${botToken}/${method}${params}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000); // Netlify 环境给足 8 秒，比 Postgres 那边宽裕很多
  try {
    const res = await fetch(url, { signal: controller.signal });
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ---------- 处理单一个来源频道 ----------
async function syncOneConfig(config, resendCfg) {
  const offsetParam = config.last_update_id ? `&offset=${config.last_update_id + 1}` : '';
  let updatesResp;
  try {
    updatesResp = await telegramGet(
      config.bot_token,
      'getUpdates',
      `?timeout=0&allowed_updates=["channel_post","message"]${offsetParam}`
    );
  } catch (err) {
    return { status: 'timeout', detail: err.message };
  }

  const updates = updatesResp?.result;
  if (!Array.isArray(updates)) {
    return { status: 'telegram_error', detail: updatesResp };
  }

  updates.sort((a, b) => a.update_id - b.update_id);

  let lastGoodUpdateId = config.last_update_id;
  let currentArticleId = config.current_article_id;
  let currentArticleDate = config.current_article_date;
  let count = 0;
  let errorCount = 0;
  const groups = []; // [{minute, blocks: [...]}]
  let currentGroup = null;

  for (const update of updates) {
    if (count >= 8) break; // Netlify 环境宽裕很多，一次可以处理比 Postgres 那边更多则
    const newestId = update.update_id;

    try {
      const post = update.channel_post || update.message;
      if (!post) { lastGoodUpdateId = newestId; continue; }
      if (String(post.chat?.id) !== String(config.source_chat_id)) { lastGoodUpdateId = newestId; continue; }

      const content = post.text || post.caption || '';
      const photos = post.photo;
      if (!content && !photos) { lastGoodUpdateId = newestId; continue; }

      const msgDate = new Date(post.date * 1000);
      const minuteKey = msgDate.toLocaleString('sv-SE', { timeZone: 'Asia/Hong_Kong' }).slice(0, 16).replace('T', ' ');

      const msgBlocks = [];
      if (content) msgBlocks.push({ type: 'text', value: content });

      if (photos && photos.length > 0) {
        try {
          const best = photos[photos.length - 1];
          const fileResp = await telegramGet(config.bot_token, 'getFile', `?file_id=${best.file_id}`);
          const filePath = fileResp?.result?.file_path;
          if (filePath) {
            msgBlocks.push({
              type: 'image',
              value: `https://api.telegram.org/file/bot${config.bot_token}/${filePath}`,
            });
          }
        } catch (imgErr) {
          await sbFetch('telegram_sync_errors', {
            method: 'POST',
            body: JSON.stringify({ update_id: newestId, error_message: '抓图失败：' + imgErr.message, raw_update: update }),
          }).catch(() => {});
        }
      }

      if (!currentGroup || currentGroup.minute !== minuteKey) {
        if (currentGroup) groups.push(currentGroup);
        currentGroup = { minute: minuteKey, blocks: [{ type: 'text', value: '🕐 ' + minuteKey }, ...msgBlocks] };
      } else {
        currentGroup.blocks.push(...msgBlocks);
      }

      count += 1;
      lastGoodUpdateId = newestId;
    } catch (err) {
      errorCount += 1;
      await sbFetch('telegram_sync_errors', {
        method: 'POST',
        body: JSON.stringify({ update_id: newestId, error_message: err.message, raw_update: update }),
      }).catch(() => {});

      // 重试保护：查这则訊息已经失败几次，超过 3 次就放弃跳过，避免卡住整条队伍
      const past = await sbFetch(`telegram_sync_errors?update_id=eq.${newestId}&select=id`).catch(() => []);
      if (Array.isArray(past) && past.length >= 3) {
        lastGoodUpdateId = newestId; // 放弃，跳过继续
      } else {
        break; // 还没试够次数，停在这里，下一轮真正重试
      }
    }
  }
  if (currentGroup) groups.push(currentGroup);

  // 新到旧排列，组跟组之间插分隔线
  const divider = { type: 'text', value: '──────────────────' };
  let batchOutput = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    batchOutput = batchOutput.length === 0 ? groups[i].blocks : [...batchOutput, divider, ...groups[i].blocks];
  }

  if (count > 0) {
    let wroteOk = false;
    if (currentArticleId && currentArticleDate === todayStr()) {
      const [article] = await sbFetch(`articles?id=eq.${currentArticleId}&select=blocks`).catch(() => [null]);
      if (article) {
        const newBlocks = article.blocks?.length ? [...batchOutput, divider, ...article.blocks] : batchOutput;
        await sbFetch(`articles?id=eq.${currentArticleId}`, {
          method: 'PATCH',
          body: JSON.stringify({ blocks: newBlocks }),
        });
        wroteOk = true;
      } else {
        currentArticleId = null;
      }
    }

    if (!wroteOk) {
      const productRows = await sbFetch(`products?id=eq.${config.target_product_id}&select=name`).catch(() => []);
      const productName = productRows?.[0]?.name || '';
      const title = `${productName} 實時資訊`;
      const [created] = await sbFetch('articles', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          product_id: config.target_product_id,
          category_id: config.target_category_id || null,
          title,
          summary: '',
          blocks: batchOutput,
        }),
      });
      currentArticleId = created.id;
      currentArticleDate = todayStr();
    }

    // Email 通知（不再发 Telegram 广播群组，跟你上次要求的一样）
    if (resendCfg?.resend_api_key) {
      const preview = batchOutput
        .filter((b) => b.type === 'text' && !b.value.startsWith('🕐') && !b.value.startsWith('──'))
        .map((b) => b.value)
        .join('\n');
      await sendArticleEmail(config.target_product_id, currentArticleId, preview, resendCfg).catch(() => {});
    }
  }

  const patch = { current_article_id: currentArticleId, current_article_date: currentArticleDate };
  if (lastGoodUpdateId != null && lastGoodUpdateId !== config.last_update_id) patch.last_update_id = lastGoodUpdateId;
  await sbFetch(`telegram_sync_configs?id=eq.${config.id}`, { method: 'PATCH', body: JSON.stringify(patch) });

  return { status: 'ok', synced: count, errors: errorCount };
}

function todayStr() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Hong_Kong' });
}

// ---------- Email 通知（直接呼叫 Resend，不再借道 Postgres 的 http 扩充功能）----------
async function sendArticleEmail(productId, articleId, preview, resendCfg) {
  const productRows = await sbFetch(`products?id=eq.${productId}&select=name`);
  const productName = productRows?.[0]?.name || '';
  const link = `${SITE_URL}/article/${articleId}`;
  const subject = `${new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Hong_Kong' }).slice(0, 16).replace('T', ' ')} ${productName} 實時資訊`;
  const previewLines = preview.split('\n').filter((l) => l.trim()).slice(0, 2).join('\n');
  const previewHtml = escapeHtml(previewLines).replace(/\n/g, '<br>');

  const html = `<div style="font-family:sans-serif;max-width:480px;margin:0 auto">
    <h2 style="color:#111">${escapeHtml(subject)}</h2>
    <p style="color:#555;white-space:pre-wrap">${previewHtml}</p>
    <a href="${link}" style="display:inline-block;margin-top:16px;padding:12px 20px;background:#F2A93B;color:#14100a;text-decoration:none;border-radius:8px;font-weight:700">查看完整內容 →</a>
    <p style="color:#999;font-size:12px;margin-top:30px">你收到這封信是因為你開啟了「${escapeHtml(productName)}」的更新通知，可以到會員中心關閉。</p>
  </div>`;
  const text = `${subject}\n\n${previewLines}\n\n查看：${link}`;

  const permissions = await sbFetch(
    `permissions?product_id=eq.${productId}&notify_email=eq.true&select=member_id,profiles(email)`
  ).catch(() => []);

  const emails = (permissions || [])
    .map((p) => p.profiles?.email)
    .filter(Boolean);

  if (emails.length === 0) return;

  const batchSize = 100;
  for (let i = 0; i < emails.length; i += batchSize) {
    const batch = emails.slice(i, i + batchSize).map((email) => ({
      from: `${resendCfg.notify_from_name || 'StockVIP'} <${resendCfg.notify_from_email || 'onboarding@resend.dev'}>`,
      to: [email],
      subject,
      html,
      text,
    }));
    await fetch('https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendCfg.resend_api_key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(batch),
    }).catch(() => {});
  }
}

// ---------- Netlify Function 入口 ----------
export default async (req) => {
  const url = new URL(req.url);
  const secret = url.searchParams.get('secret');
  if (!SYNC_SECRET || secret !== SYNC_SECRET) {
    return new Response(JSON.stringify({ status: 'unauthorized' }), { status: 401 });
  }

  const gotLock = await acquireLock().catch(() => false);
  if (!gotLock) {
    return new Response(JSON.stringify({ status: 'already_running' }), { status: 200 });
  }

  try {
    const configs = await sbFetch('telegram_sync_configs?enabled=eq.true');
    const [resendCfg] = await sbFetch('telegram_sync_config?id=eq.1&select=resend_api_key,notify_from_email,notify_from_name').catch(() => [null]);

    const results = [];
    for (const cfg of configs || []) {
      const result = await syncOneConfig(cfg, resendCfg).catch((err) => ({ status: 'error', detail: err.message }));
      results.push({ label: cfg.label, result });
    }

    return new Response(JSON.stringify({ status: 'ok', channels: results }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } finally {
    await releaseLock();
  }
};
