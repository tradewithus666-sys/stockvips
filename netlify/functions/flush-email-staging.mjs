// netlify/functions/flush-email-staging.mjs
//
// 每分钟由 cron-job.org 触发一次，检查 email_notify_staging 里
// 「超过 90 秒没有新内容更新」的记录（代表那一分钟真的结束了，不会再有新消息进来），
// 才把它排进 pending_email_notifications 真正寄出，达到「同一分钟内多则消息只寄一封信」的效果。

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FLUSH_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET; // 沿用同一把密钥即可

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
  const url = new URL(req.url);
  const secret = url.searchParams.get('secret');
  if (!FLUSH_SECRET || secret !== FLUSH_SECRET) {
    return new Response(JSON.stringify({ status: 'unauthorized' }), { status: 401 });
  }

  try {
    // 90 秒没更新，视为这一分钟已经结束、不会再有消息进来了
    const cutoff = new Date(Date.now() - 90 * 1000).toISOString();
    const staged = await sbFetch(
      `email_notify_staging?flushed=eq.false&last_updated_at=lt.${cutoff}&select=*`
    );

    let flushed = 0;
    for (const row of staged || []) {
      await sbFetch('pending_email_notifications', {
        method: 'POST',
        body: JSON.stringify({
          product_id: row.product_id,
          article_id: row.article_id,
          preview: row.content,
        }),
      });
      await sbFetch(
        `email_notify_staging?product_id=eq.${row.product_id}&minute_key=eq.${encodeURIComponent(row.minute_key)}`,
        { method: 'PATCH', body: JSON.stringify({ flushed: true }) }
      );
      flushed += 1;
    }

    return new Response(JSON.stringify({ status: 'ok', flushed }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ status: 'error', detail: err.message }), { status: 200 });
  }
};
