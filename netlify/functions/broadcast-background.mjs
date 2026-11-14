// netlify/functions/broadcast-background.mjs
//
// 後台「群發電郵」的發送程式。檔名結尾的 -background 代表它是 Netlify 背景函式：
// 呼叫後立刻回覆 202，之後在背景最長跑 15 分鐘，所以會員再多也不會逾時。
// 進度與結果寫在 broadcast_log 表，後台頁面會自動讀取顯示。
//
// 安全：只有 profiles.role = 'admin' 的登入者可以使用（用登入 token 驗證，不是靠前端按鈕隱藏）。
// 注意：背景函式一旦「丟出錯誤」Netlify 會自動重試，會造成重複群發，
//       所以整支程式用 try/catch 包住，任何錯誤都只寫進 broadcast_log，不往外丟。

import {
  SUPABASE_URL, SERVICE_ROLE_KEY, sbFetch, sbFetchAll, loadMailConfig, sendBatch, sleep,
  textToHtml, emailShell, unsubscribeUrl,
} from './_shared/mail.mjs';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function getAdmin(token) {
  if (!token) return null;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const user = await res.json();
  if (!user?.id) return null;
  const rows = await sbFetch(`profiles?id=eq.${user.id}&select=id,email,role`);
  const p = rows?.[0];
  return p && p.role === 'admin' ? p : null;
}

function buildMessage(recipient, subject, body) {
  const unsub = unsubscribeUrl(recipient.id);
  const html = emailShell({
    title: subject,
    innerHtml: `<div style="color:#333;line-height:1.7;font-size:15px">${textToHtml(body)}</div>`,
    footerHtml: `你收到這封信是因為你是 StockVIP 的註冊會員。<br>不想再收到推廣郵件？<a href="${unsub}" style="color:#999">取消訂閱</a>`,
  });
  const text = `${body}\n\n---\n不想再收到推廣郵件？取消訂閱：${unsub}`;
  return {
    to: recipient.email,
    subject,
    html,
    text,
    headers: {
      'List-Unsubscribe': `<${unsub}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}

export default async (req) => {
  let logId = null;
  const patchLog = (fields) =>
    logId
      ? sbFetch(`broadcast_log?id=eq.${logId}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify(fields),
        }).catch(() => {})
      : Promise.resolve();

  try {
    if (req.method !== 'POST') return;

    const payload = await req.json().catch(() => null);
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const admin = await getAdmin(token).catch(() => null);
    if (!admin) { console.warn('broadcast: 非管理員或 token 無效，已忽略'); return; }

    const mode = payload?.mode === 'test' ? 'test' : 'send';
    const subject = String(payload?.subject || '').trim().slice(0, 150);
    const body = String(payload?.body || '').trim().slice(0, 20000);

    // 先建一筆紀錄，讓後台頁面看得到狀態
    const created = await sbFetch('broadcast_log', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ subject: subject || '(無標題)', mode, status: 'sending', created_by: admin.id }),
    });
    logId = created?.[0]?.id;

    if (!subject || !body) {
      await patchLog({ status: 'failed', error: '標題和內容都要填寫', finished_at: new Date().toISOString() });
      return;
    }

    // 防止重複按：30 分鐘內已有一筆正在發送的群發就不再開始
    if (mode === 'send') {
      const since = new Date(Date.now() - 30 * 60000).toISOString();
      const busy = await sbFetch(
        `broadcast_log?status=eq.sending&mode=eq.send&created_at=gte.${since}&id=neq.${logId}&select=id`
      );
      if (busy?.length) {
        await patchLog({ status: 'failed', error: '上一次群發還在進行中，請等它完成', finished_at: new Date().toISOString() });
        return;
      }
    }

    // 收件人
    let recipients;
    if (mode === 'test') {
      recipients = [{ id: admin.id, email: admin.email }];
    } else {
      const rows = await sbFetchAll(
        'profiles?select=id,email&email_broadcast_optout=eq.false&email=not.is.null&order=created_at'
      );
      const seen = new Set();
      recipients = rows.filter((r) => {
        const e = String(r.email || '').trim().toLowerCase();
        if (!EMAIL_RE.test(e) || seen.has(e)) return false;
        seen.add(e);
        r.email = e;
        return true;
      });
    }

    await patchLog({ total: recipients.length });
    if (recipients.length === 0) {
      await patchLog({ status: 'failed', error: '沒有可發送的收件人', finished_at: new Date().toISOString() });
      return;
    }

    const mail = await loadMailConfig();
    const finalSubject = mode === 'test' ? `[測試] ${subject}` : subject;
    let sent = 0, failed = 0, firstError = null, stopped = false;

    for (let i = 0, n = 0; i < recipients.length; i += 100, n++) {
      const chunk = recipients.slice(i, i + 100);
      const messages = chunk.map((r) => buildMessage(r, finalSubject, body));
      const result = await sendBatch(mail, messages, `bc-${logId}-${n}`);

      if (result.ok) sent += chunk.length;
      else {
        failed += chunk.length;
        firstError = firstError || result.error;
        if (result.quota) { stopped = true; failed += recipients.length - i - chunk.length; break; }
      }
      if (n % 3 === 2) await patchLog({ sent, failed });
      await sleep(400);
    }

    const status = failed === 0 ? 'done' : sent === 0 ? 'failed' : 'partial';
    await patchLog({
      sent, failed, status,
      error: firstError ? (stopped ? `${firstError}，其餘未發送` : firstError) : null,
      finished_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('broadcast error', err);
    await patchLog({ status: 'failed', error: String(err.message || err).slice(0, 300), finished_at: new Date().toISOString() });
  }
  // 不論成功失敗都正常結束，避免 Netlify 自動重試造成重複群發
};
