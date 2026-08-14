// netlify/functions/telegram-bind-webhook.mjs
//
// 专门处理会员点击「t.me/Stockvip_noti_bot?start=<token>」这个深层连结后，
// Bot 收到的 /start <token> 讯息，把发送者的 Telegram User ID 记录、
// 绑定到网站会员帐号。
//
// 这支 function 要另外注册一个专属的 webhook（用 @Stockvip_noti_bot 的 Token），
// 跟其他頻道监听用的 Bot 是分开的。

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BIND_WEBHOOK_SECRET = process.env.TELEGRAM_BIND_WEBHOOK_SECRET;
const NOTI_BOT_TOKEN = process.env.TELEGRAM_NOTI_BOT_TOKEN; // @Stockvip_noti_bot 的 Token

async function sbFetch(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function sendTelegramMessage(chatId, text) {
  await fetch(`https://api.telegram.org/bot${NOTI_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  }).catch(() => {});
}

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const secretHeader = req.headers.get('x-telegram-bot-api-secret-token');
  if (!BIND_WEBHOOK_SECRET || secretHeader !== BIND_WEBHOOK_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  let update;
  try {
    update = await req.json();
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  const message = update.message;
  if (!message?.text?.startsWith('/start')) {
    return new Response(JSON.stringify({ status: 'ignored' }), { status: 200 });
  }

  const parts = message.text.trim().split(/\s+/);
  const token = parts[1];
  const chatId = message.chat.id;
  const fromId = message.from?.id;
  const username = message.from?.username || null;

  if (!token) {
    await sendTelegramMessage(chatId, '請從網站會員中心點擊「連結 Telegram」按鈕，透過那個連結重新開始。');
    return new Response(JSON.stringify({ status: 'no_token' }), { status: 200 });
  }

  const result = await sbFetch('rpc/bind_telegram_account', {
    method: 'POST',
    body: JSON.stringify({
      p_token: token,
      p_telegram_user_id: String(fromId),
      p_telegram_username: username,
    }),
  }).catch((err) => ({ status: 'error', detail: err.message }));

  if (result?.status === 'ok') {
    await sendTelegramMessage(chatId, '✅ 綁定成功！你的 Telegram 帳號已經跟網站會員帳號連結，之後可以直接透過網站取得頻道邀請連結。');
  } else if (result?.status === 'invalid_token') {
    await sendTelegramMessage(chatId, '這個連結已經失效或已經使用過，請回網站會員中心重新產生一個新的連結。');
  } else {
    await sendTelegramMessage(chatId, '綁定過程發生錯誤，請稍後再試，或聯繫客服協助。');
  }

  return new Response(JSON.stringify({ status: 'ok' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
