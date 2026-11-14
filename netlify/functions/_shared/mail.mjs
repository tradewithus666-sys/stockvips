// netlify/functions/_shared/mail.mjs
//
// 續費提醒、群發電郵、退訂頁面共用的小工具。
// 資料夾名稱以底線開頭（_shared），Netlify 不會把它當成獨立的 function。
// 沿用你現有 telegram-sync.mjs 的做法：Supabase service role + Resend 設定存在 telegram_sync_config。

import { createHmac, timingSafeEqual } from 'node:crypto';

export const SUPABASE_URL = process.env.SUPABASE_URL;
export const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
export const SITE_URL = 'https://tradewithus888.com';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- Supabase ---------------- */

export function sbHeaders(extra = {}) {
  return {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

export async function sbFetch(path, options = {}) {
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

// Supabase 一次最多回傳 1000 筆，這個函式會自動分頁抓完。
export async function sbFetchAll(path, pageSize = 1000) {
  const all = [];
  for (let offset = 0; ; offset += pageSize) {
    const sep = path.includes('?') ? '&' : '?';
    const rows = await sbFetch(`${path}${sep}limit=${pageSize}&offset=${offset}`);
    if (!rows || rows.length === 0) break;
    all.push(...rows);
    if (rows.length < pageSize) break;
  }
  return all;
}

/* ---------------- 日期 / 文字 ---------------- */

// 香港時間的日期字串（YYYY-MM-DD），offsetDays 可以往後推幾天
export function hkDate(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Hong_Kong' });
}

export function daysBetween(fromStr, toStr) {
  return Math.round((Date.parse(toStr) - Date.parse(fromStr)) / 86400000);
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// 純文字 → HTML（保留換行，網址自動變成連結；網址結尾的標點不算進連結）
export function textToHtml(text) {
  const escaped = escapeHtml(text);
  const linked = escaped.replace(/https?:\/\/[A-Za-z0-9\-._~:\/?#@!$&'()*+,;=%\[\]]+/g, (m) => {
    const trail = (m.match(/(?:[.,;:!?)]|&amp;)+$/) || [''])[0];
    const url = trail ? m.slice(0, -trail.length) : m;
    return `<a href="${url}" style="color:#B9761F">${url}</a>${trail}`;
  });
  return linked.replace(/\r?\n/g, '<br>');
}

/* ---------------- Resend ---------------- */

export async function loadMailConfig() {
  const rows = await sbFetch(
    'telegram_sync_config?id=eq.1&select=resend_api_key,notify_from_email,notify_from_name'
  );
  const cfg = rows?.[0];
  if (!cfg?.resend_api_key) {
    throw new Error('找不到 Resend API Key（telegram_sync_config.resend_api_key 是空的）');
  }
  return {
    apiKey: cfg.resend_api_key,
    from: `${cfg.notify_from_name || 'StockVIP'} <${cfg.notify_from_email || 'notifications@tradewithus888.com'}>`,
  };
}

// messages: [{ to, subject, html, text, headers? }]，最多 100 封
export async function sendBatch(mail, messages, idempotencyKey) {
  const body = messages.map(({ to, ...rest }) => ({ from: mail.from, to: [to], ...rest }));
  const headers = {
    Authorization: `Bearer ${mail.apiKey}`,
    'Content-Type': 'application/json',
  };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  for (let attempt = 0; attempt < 4; attempt++) {
    let res;
    try {
      res = await fetch('https://api.resend.com/emails/batch', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
    } catch (err) {
      await sleep(1500 * (attempt + 1));
      continue;
    }
    if (res.ok) return { ok: true };

    const text = await res.text().catch(() => '');
    // 額度用完，重試也沒用，直接回報
    if (/quota_exceeded/i.test(text)) {
      return { ok: false, quota: true, error: '已達 Resend 發信額度上限，請到 Resend 後台確認用量' };
    }
    if (res.status === 429 || res.status >= 500) {
      await sleep(1500 * (attempt + 1));
      continue;
    }
    return { ok: false, error: `Resend ${res.status}: ${text.slice(0, 250)}` };
  }
  return { ok: false, error: '連續重試仍失敗（Resend 無回應或被限流）' };
}

/* ---------------- 退訂連結（簽名，不用另外存 token） ---------------- */

function sign(userId) {
  return createHmac('sha256', SERVICE_ROLE_KEY).update(`unsub:${userId}`).digest('hex');
}

export function unsubscribeUrl(userId) {
  return `${SITE_URL}/.netlify/functions/unsubscribe?u=${userId}&t=${sign(userId)}`;
}

export function verifyUnsubscribe(userId, token) {
  try {
    const a = Buffer.from(sign(userId), 'hex');
    const b = Buffer.from(String(token), 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/* ---------------- 郵件外框（跟你現有通知郵件同一風格） ---------------- */

export function emailShell({ title, innerHtml, footerHtml }) {
  return `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:8px">
    <h2 style="color:#111;margin:0 0 16px">${escapeHtml(title)}</h2>
    ${innerHtml}
    <p style="color:#999;font-size:12px;margin-top:30px;line-height:1.6">${footerHtml}</p>
  </div>`;
}

export function ctaButton(link, label) {
  return `<a href="${link}" style="display:inline-block;margin-top:16px;padding:12px 20px;background:#F2A93B;color:#14100a;text-decoration:none;border-radius:8px;font-weight:700">${escapeHtml(label)}</a>`;
}

export function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
