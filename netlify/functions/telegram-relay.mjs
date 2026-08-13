// netlify/functions/telegram-relay.mjs
//
// 中继机械人：接住 ForwardMsg 送进「中继目的地」（一个私聊或小群组）的内容，
// 再用真正的 Bot API 呼叫（sendMessage/sendPhoto），用「频道自己的 Bot」身份，
// 把内容重新发布进真正的目标频道。
//
// 因为这一步是货真价实的 Bot API 动作，一定会正常触发 channel_post 事件，
// 原本的 telegram-webhook.mjs 完全不用改，会照常接收到、正常处理。
//
// 网址结构跟主 webhook 一样带 configId：
// https://tradewithus888.com/.netlify/functions/telegram-relay/<config_id>

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RELAY_SECRET = process.env.TELEGRAM_RELAY_SECRET; // 建议另外设一组，跟主 webhook 的密钥分开

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

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const url = new URL(req.url);
  const parts = url.pathname.split('/').filter(Boolean);
  const configId = parts[parts.length - 1];

  const secretHeader = req.headers.get('x-telegram-bot-api-secret-token');
  if (!RELAY_SECRET || secretHeader !== RELAY_SECRET) {
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
    if (!config || !config.enabled || !config.relay_bot_token || !config.relay_chat_id) {
      return new Response(JSON.stringify({ status: 'not_configured' }), { status: 200 });
    }

    // 中继目的地是私聊或群组，一般消息用 message，不是 channel_post
    const post = update.message || update.channel_post || update.edited_message || update.edited_channel_post;
    if (!post) return new Response(JSON.stringify({ status: 'ignored' }), { status: 200 });
    if (String(post.chat?.id) !== String(config.relay_chat_id)) {
      return new Response(JSON.stringify({ status: 'ignored_wrong_chat' }), { status: 200 });
    }

    const text = post.text || post.caption || '';
    const photos = post.photo;

    // 用「频道自己的 Bot」身份，把内容真的发布进目标频道——这是货真价实的 Bot API 动作，
    // 一定会正常触发 channel_post，原本的 webhook 会照常接收到
    if (photos && photos.length > 0) {
      const best = photos[photos.length - 1];
      await fetch(`https://api.telegram.org/bot${config.bot_token}/sendPhoto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: config.source_chat_id,
          photo: best.file_id, // Telegram 允许直接用 file_id 转发同一张图，不用重新上传
          caption: text || undefined,
        }),
      });
    } else if (text) {
      await fetch(`https://api.telegram.org/bot${config.bot_token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: config.source_chat_id,
          text,
        }),
      });
    }

    return new Response(JSON.stringify({ status: 'ok' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ status: 'error', detail: err.message }), { status: 200 });
  }
};
