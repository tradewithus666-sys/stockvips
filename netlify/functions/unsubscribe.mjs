// netlify/functions/unsubscribe.mjs
//
// 群發郵件底部的「取消訂閱」連結會來到這裡。
// - 打開連結（GET）：只顯示確認頁，不會直接退訂（避免郵件掃描器預先點開連結就被退訂）。
// - 按下確認（POST）：把 profiles.email_broadcast_optout 設為 true。
// - 郵件程式的「一鍵退訂」（List-Unsubscribe-Post）也是 POST，同樣處理。
// 連結內的簽名由 _shared/mail.mjs 產生，無法偽造別人的退訂連結。
// 只影響「群發電郵」；續費提醒和文章更新通知不受影響。

import { sbFetch, verifyUnsubscribe, escapeHtml, SITE_URL } from './_shared/mail.mjs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function page(title, message, extra = '', status = 200) {
  const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="font-family:sans-serif;background:#f6f6f6;margin:0;padding:40px 16px">
<div style="max-width:420px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;text-align:center">
<h2 style="margin-top:0;color:#111">${escapeHtml(title)}</h2>
<p style="color:#555;line-height:1.6">${escapeHtml(message)}</p>${extra}
<p style="margin-top:24px"><a href="${SITE_URL}" style="color:#B9761F">返回 StockVIP</a></p>
</div></body></html>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

export default async (req) => {
  const url = new URL(req.url);
  const u = url.searchParams.get('u') || '';
  const t = url.searchParams.get('t') || '';

  if (!UUID_RE.test(u) || !verifyUnsubscribe(u, t)) {
    return page('連結無效', '這個取消訂閱連結無效或已損壞。', '', 400);
  }

  if (req.method === 'POST') {
    try {
      await sbFetch(`profiles?id=eq.${u}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ email_broadcast_optout: true }),
      });
      return page('已取消訂閱', '你之後不會再收到 StockVIP 的群發推廣郵件。續費提醒等與你帳戶有關的系統通知不受影響。');
    } catch (err) {
      return page('發生錯誤', '暫時無法處理，請稍後再試。', '', 500);
    }
  }

  const form = `<form method="POST" action="${escapeHtml(url.pathname + url.search)}">
    <button type="submit" style="margin-top:8px;padding:12px 22px;background:#F2A93B;color:#14100a;border:none;border-radius:8px;font-weight:700;font-size:15px;cursor:pointer">確認取消訂閱</button>
  </form>`;
  return page('取消訂閱群發郵件', '按下按鈕後，你將不再收到 StockVIP 的群發推廣郵件。', form);
};
