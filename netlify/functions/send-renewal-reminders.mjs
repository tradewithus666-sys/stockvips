// netlify/functions/send-renewal-reminders.mjs
//
// 會員項目到期前 3 天，自動寄一封續費提醒（顯示項目名稱、到期日、續費價格、續費連結）。
//
// 觸發方式：跟 telegram-sync 一樣，由 cron-job.org 每天呼叫一次：
//   https://tradewithus888.com/.netlify/functions/send-renewal-reminders?secret=你的TELEGRAM_SYNC_SECRET
// 測試用：網址最後加 &dry=1，只列出「會寄給誰」，不會真的寄信。
//
// 重複寄送保護：每寄成功一筆，就寫進 renewal_reminder_log（permission_id + 到期日）。
// 同一個到期日不會再寄第二次；會員續費後到期日改變，下一期會重新提醒。
// 如果某天排程剛好沒跑，隔天會自動補寄（只要項目還沒過期）。

import { createHash } from 'node:crypto';
import {
  sbFetch, sbFetchAll, loadMailConfig, sendBatch, sleep,
  hkDate, daysBetween, escapeHtml, emailShell, ctaButton, json, SITE_URL,
} from './_shared/mail.mjs';

const CRON_SECRET = process.env.TELEGRAM_SYNC_SECRET;
const DAYS_AHEAD = 3;
const PRICE_UNIT = 'USDT'; // 價格後面顯示的單位，如果你的商品價格不是 USDT 請改這裡

const TYPE_LABEL = { course: '課程', subscription: '訂閱項目', shared: '共享帳號' };

// 與 src/pages/MemberCenter.jsx 的 getDurationPrice 完全相同的算法，確保信裡的價格跟網站一致
const DUR_MULT = { month: 1, quarter: 2.7, year: 9 };
function durationPrice(p, d) {
  if (p.type === 'subscription') {
    if (d === 'month') return p.price;
    if (d === 'quarter') return p.price_quarter ?? Math.round(p.price * DUR_MULT.quarter);
    if (d === 'year') return p.price_year ?? Math.round(p.price * DUR_MULT.year);
  }
  return Math.round(p.price * DUR_MULT[d]);
}

function priceLine(p) {
  if (!p || p.type === 'course' || !(Number(p.price) > 0)) return '';
  return [['month', '月費'], ['quarter', '季費'], ['year', '年費']]
    .map(([d, label]) => `${label} ${durationPrice(p, d)} ${PRICE_UNIT}`)
    .join('　|　');
}

function daysLabel(n) {
  if (n <= 0) return '今天到期';
  return `還有 ${n} 天`;
}

function buildEmail(items, today) {
  const sorted = [...items].sort((a, b) => a.expires_at.localeCompare(b.expires_at));
  const subject =
    sorted.length === 1
      ? `[StockVip] 「${sorted[0].name}」將於 ${sorted[0].expires_at} 到期`
      : `[StockVip] 你有 ${sorted.length} 個會員項目即將到期`;

  const cards = sorted
    .map((it) => {
      const left = daysBetween(today, it.expires_at);
      const price = priceLine(it.product);
      return `<div style="border:1px solid #eee;border-radius:10px;padding:14px 16px;margin:10px 0">
        <div style="font-size:16px;font-weight:700;color:#111">${escapeHtml(it.name)}</div>
        <div style="color:#888;font-size:12px;margin-top:2px">${escapeHtml(TYPE_LABEL[it.product?.type] || '')}</div>
        <div style="margin-top:8px;color:#333">到期日：<b>${escapeHtml(it.expires_at)}</b>（${daysLabel(left)}）</div>
        ${price ? `<div style="margin-top:6px;color:#666;font-size:13px">續費價格：${escapeHtml(price)}</div>` : ''}
      </div>`;
    })
    .join('');

  const link = `${SITE_URL}/member`;
  const html = emailShell({
    title: '你的會員項目即將到期',
    innerHtml: `<p style="color:#555;line-height:1.6">你好，以下會員項目快要到期了。到期後，該項目的會員內容將無法繼續查看。想繼續使用，請在到期前到會員中心續費。</p>
      ${cards}
      ${ctaButton(link, '前往會員中心續費 →')}`,
    footerHtml: '你收到這封信是因為你在 StockVIP 有即將到期的會員項目。這是系統自動發出的提醒。',
  });

  const text = [
    '你的會員項目即將到期',
    '',
    ...sorted.map((it) => {
      const price = priceLine(it.product);
      return `- ${it.name}　到期日：${it.expires_at}（${daysLabel(daysBetween(today, it.expires_at))}）${price ? `　續費價格：${price}` : ''}`;
    }),
    '',
    `到會員中心續費：${link}`,
  ].join('\n');

  return { subject, html, text };
}

export default async (req) => {
  const url = new URL(req.url);
  if (!CRON_SECRET || url.searchParams.get('secret') !== CRON_SECRET) {
    return json({ status: 'unauthorized' }, 401);
  }
  const dry = url.searchParams.get('dry') === '1';

  try {
    const today = hkDate(0);
    const limit = hkDate(DAYS_AHEAD);

    // 1. 找出「今天～3 天後」到期的項目（永久項目 expires_at 為空，不會被選到）
    const perms = await sbFetchAll(
      `permissions?expires_at=gte.${today}&expires_at=lte.${limit}` +
      `&select=id,member_id,expires_at,products(name,type,status,price,price_quarter,price_year),profiles(email)&order=id`
    );

    // 2. 排除已經寄過的
    const logs = await sbFetchAll(
      `renewal_reminder_log?expires_at=gte.${today}&expires_at=lte.${limit}&select=permission_id,expires_at&order=permission_id`
    );
    const sent = new Set(logs.map((l) => `${l.permission_id}|${l.expires_at}`));

    // 3. 依會員分組：同一個會員有多個項目到期，只寄一封
    const byMember = new Map();
    let skippedNoEmail = 0, skippedOff = 0;
    for (const p of perms) {
      if (sent.has(`${p.id}|${p.expires_at}`)) continue;
      if (p.products?.status === 'off') { skippedOff++; continue; } // 已下架，無法續費
      const email = p.profiles?.email;
      if (!email) { skippedNoEmail++; continue; }
      if (!byMember.has(p.member_id)) byMember.set(p.member_id, { email, items: [] });
      byMember.get(p.member_id).items.push({
        permissionId: p.id,
        expires_at: p.expires_at,
        name: p.products?.name || '會員項目',
        product: p.products,
      });
    }

    const members = [...byMember.values()];

    if (dry) {
      return json({
        status: 'dry_run',
        today, window: `${today} ~ ${limit}`,
        willEmail: members.length,
        skippedNoEmail, skippedOff,
        preview: members.map((m) => ({
          email: m.email,
          items: m.items.map((i) => `${i.name} (${i.expires_at})`),
        })),
      });
    }
    if (members.length === 0) {
      return json({ status: 'ok', sentEmails: 0, note: '今天沒有需要提醒的會員', skippedNoEmail, skippedOff });
    }

    // 4. 寄信（每 100 封一批），成功才寫入紀錄
    const mail = await loadMailConfig();
    let sentEmails = 0, failedEmails = 0, lastError = null;

    for (let i = 0; i < members.length; i += 100) {
      const chunk = members.slice(i, i + 100);
      const messages = chunk.map((m) => ({ to: m.email, ...buildEmail(m.items, today) }));
      const ids = chunk.flatMap((m) => m.items.map((it) => `${it.permissionId}:${it.expires_at}`)).sort().join(',');
      const result = await sendBatch(mail, messages, `renewal-${createHash('sha1').update(ids).digest('hex')}`);

      if (result.ok) {
        sentEmails += chunk.length;
        const rows = chunk.flatMap((m) =>
          m.items.map((it) => ({ permission_id: it.permissionId, expires_at: it.expires_at }))
        );
        await sbFetch('renewal_reminder_log', {
          method: 'POST',
          headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
          body: JSON.stringify(rows),
        }).catch((err) => { lastError = `寫入紀錄失敗：${err.message}`; });
      } else {
        failedEmails += chunk.length;
        lastError = result.error;
        if (result.quota) break; // 額度用完就停，明天排程會自動補寄
      }
      await sleep(300);
    }

    return json({ status: 'ok', sentEmails, failedEmails, skippedNoEmail, skippedOff, error: lastError });
  } catch (err) {
    return json({ status: 'error', detail: err.message }, 500);
  }
};
