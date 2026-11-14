// src/pages/RemindersTab.jsx
//
// 後台「續費提醒」分頁：
//   1. 今天已發送的提醒（讀 renewal_reminder_log）
//   2. 今天應該寄、但還沒寄出的（排程沒跑或失敗時會出現在這裡）
//   3. 明天排程會寄出的名單
//
// 規則與 netlify/functions/send-renewal-reminders.mjs 完全一致：
//   - 提醒窗口 = 今天 ~ 今天+3 天（HK 時間）
//   - 同一筆權限 + 同一個到期日只寄一次
//   - 已下架（status = 'off'）的商品、沒有電郵的會員不會寄
//   - 同一個會員多個項目，合併成一封信

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';

const DAYS_AHEAD = 3;
const TYPE_LABEL = { course: '課程', subscription: '訂閱項目', shared: '共享帳號' };

// ---- 香港日期工具（不受瀏覽器時區影響）----
function hkToday() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}
function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function daysBetween(a, b) {
  const t = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((t(b) - t(a)) / 86400000);
}
function hkTime(iso) {
  return new Date(new Date(iso).getTime() + 8 * 3600 * 1000).toISOString().slice(11, 16);
}

// 把多筆項目依會員合併（同會員一封信）
function groupByMember(rows) {
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.memberId)) map.set(r.memberId, { memberId: r.memberId, email: r.email, items: [] });
    map.get(r.memberId).items.push(r);
  }
  return [...map.values()].sort((a, b) => a.email.localeCompare(b.email));
}

function ItemList({ items, showSentAt, today }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {items.map((it) => (
        <div key={`${it.permissionId}|${it.expires_at}`}>
          <b>{it.name}</b>
          <span style={{ color: 'var(--muted)', marginLeft: 6 }}>{TYPE_LABEL[it.type] || ''}</span>
          <span style={{ marginLeft: 10 }}>
            到期 {it.expires_at}（{daysBetween(today, it.expires_at) <= 0 ? '今天' : `${daysBetween(today, it.expires_at)} 天後`}）
          </span>
          {showSentAt && <span style={{ color: 'var(--muted)', marginLeft: 10 }}>寄出 {hkTime(it.sent_at)}</span>}
          {it.tag && <span className="status valid" style={{ marginLeft: 10 }}>{it.tag}</span>}
        </div>
      ))}
    </div>
  );
}

function Section({ title, hint, groups, showSentAt, today, emptyText }) {
  return (
    <div className="form-panel" style={{ marginTop: 16 }}>
      <h3 style={{ margin: 0 }}>{title}　<span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 13 }}>{groups.length} 封</span></h3>
      {hint && <p style={{ color: 'var(--muted)', fontSize: 13, margin: '6px 0 12px' }}>{hint}</p>}
      {groups.length === 0 ? (
        <p style={{ color: 'var(--muted)', margin: '12px 0 0' }}>{emptyText}</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>會員電郵</th><th>提醒內容</th></tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.memberId}>
                  <td style={{ whiteSpace: 'nowrap' }}>{g.email}</td>
                  <td><ItemList items={g.items} showSentAt={showSentAt} today={today} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function RemindersTab() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const today = hkToday();
      const tomorrow = addDays(today, 1);
      const dayStart = `${today}T00:00:00+08:00`;
      const dayEnd = `${tomorrow}T00:00:00+08:00`;
      const tomorrowLimit = addDays(tomorrow, DAYS_AHEAD);

      // 1. 今天已發送（renewal_reminder_log 需要管理員讀取權限，見 reminders_admin_read.sql）
      const sentQ = supabase
        .from('renewal_reminder_log')
        .select('permission_id, expires_at, sent_at, permissions(member_id, products(name,type), profiles(email))')
        .gte('sent_at', dayStart)
        .lt('sent_at', dayEnd)
        .order('sent_at', { ascending: true })
        .limit(1000);

      // 2. 窗口內（今天 ~ 明天+3 天）所有會到期的權限
      const permQ = supabase
        .from('permissions')
        .select('id, member_id, expires_at, products(name,type,status), profiles(email)')
        .gte('expires_at', today)
        .lte('expires_at', tomorrowLimit)
        .order('expires_at', { ascending: true })
        .limit(2000);

      // 3. 窗口內所有已寄紀錄（用來判斷「還沒寄」）
      const logQ = supabase
        .from('renewal_reminder_log')
        .select('permission_id, expires_at')
        .gte('expires_at', today)
        .lte('expires_at', tomorrowLimit)
        .limit(5000);

      const [sentRes, permRes, logRes] = await Promise.all([sentQ, permQ, logQ]);
      for (const r of [sentRes, permRes, logRes]) if (r.error) throw r.error;

      // 今天已發送
      const sentRows = (sentRes.data || [])
        .filter((l) => l.permissions?.profiles?.email)
        .map((l) => ({
          permissionId: l.permission_id,
          memberId: l.permissions.member_id,
          email: l.permissions.profiles.email,
          name: l.permissions.products?.name || '會員項目',
          type: l.permissions.products?.type,
          expires_at: l.expires_at,
          sent_at: l.sent_at,
        }));

      const logged = new Set((logRes.data || []).map((l) => `${l.permission_id}|${l.expires_at}`));

      // 可寄送的候選（跟排程一樣：未寄過、未下架、有電郵）
      const candidates = (permRes.data || [])
        .filter((p) => !logged.has(`${p.id}|${p.expires_at}`))
        .filter((p) => p.products?.status !== 'off' && p.profiles?.email)
        .map((p) => ({
          permissionId: p.id,
          memberId: p.member_id,
          email: p.profiles.email,
          name: p.products?.name || '會員項目',
          type: p.products?.type,
          expires_at: p.expires_at,
        }));

      const todayLimit = addDays(today, DAYS_AHEAD);
      // 今天應寄未寄：到期日落在 今天 ~ 今天+3
      const pendingToday = candidates.filter((c) => c.expires_at <= todayLimit);
      // 明天會寄：到期日落在 明天 ~ 明天+3（今天未寄的也會在明天補寄，一併列出）
      const tomorrowRows = candidates
        .filter((c) => c.expires_at >= tomorrow)
        .map((c) => ({ ...c, tag: c.expires_at === tomorrowLimit ? '新進入提醒期' : '補寄' }));

      setData({
        today,
        sent: groupByMember(sentRows),
        pendingToday: groupByMember(pendingToday),
        tomorrow: groupByMember(tomorrowRows),
        tomorrowDate: tomorrow,
      });
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>續費提醒</h3>
        <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading}>
          {loading ? '載入中…' : '重新整理'}
        </button>
        {data && <span style={{ color: 'var(--muted)', fontSize: 13 }}>香港日期 {data.today}</span>}
      </div>

      {error && (
        <div className="form-panel" style={{ marginTop: 16, color: 'var(--red)' }}>
          讀取失敗：{error}
          <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 6 }}>
            如果是權限錯誤，請先在 Supabase 執行 reminders_admin_read.sql。
          </div>
        </div>
      )}

      {data && (
        <>
          <Section
            title={`今天已發送（${data.today}）`}
            groups={data.sent}
            showSentAt
            today={data.today}
            emptyText="今天還沒有寄出任何提醒。"
          />
          <Section
            title="今天應寄但未寄出"
            hint="這些項目已進入提醒期，但還沒有寄出紀錄。如果這裡有資料，代表今天的排程還沒跑或寄送失敗。排程跑完或明天排程執行時會自動補寄。"
            groups={data.pendingToday}
            today={data.today}
            emptyText="沒有，今天該寄的都已寄出。"
          />
          <Section
            title={`明天將會發送（${data.tomorrowDate}）`}
            hint="「新進入提醒期」＝ 到期日剛好是 3 天後，明天第一次提醒；「補寄」＝ 之前還沒寄出的項目。名單以現在的資料計算，會員在明天前續費就會自動從名單消失。"
            groups={data.tomorrow}
            today={data.tomorrowDate}
            emptyText="明天沒有需要提醒的會員。"
          />
        </>
      )}
    </div>
  );
}
