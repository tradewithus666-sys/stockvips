// src/pages/PurchaseRecordsTab.jsx
//
// 後台「購買記錄」分頁：按日期（香港時間）查看會員在網頁上自行
//   1. 購買（用餘額購買／續費，來自 purchases 表）
//   2. 增值（成功的充值，來自 wallet_tx 表）
// 預設顯示今天，可用日期選擇或「前一天／後一天」切換。管理員在後台直接開通權限不會出現在這裡。

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import { usdtToHkd } from '../lib/format';

const DUR_TEXT = { month: '月費', quarter: '季費', year: '年費' };

function hkToday() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}
function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function hkDateTime(iso) {
  return new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Hong_Kong' }); // 2026-11-15 13:05:22
}
function money(n) {
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function PurchaseRecordsTab() {
  const [date, setDate] = useState(hkToday());
  const [rows, setRows] = useState([]);
  const [filter, setFilter] = useState('all'); // all | purchase | recharge
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async (d) => {
    setLoading(true);
    setError(null);
    try {
      const start = `${d}T00:00:00+08:00`;
      const end = `${addDays(d, 1)}T00:00:00+08:00`;
      const [puRes, txRes] = await Promise.all([
        supabase.from('purchases').select('*, products(name)')
          .gte('purchased_at', start).lt('purchased_at', end)
          .order('purchased_at', { ascending: false }).limit(1000),
        supabase.from('wallet_tx').select('*')
          .eq('status', 'success')
          .gte('created_at', start).lt('created_at', end)
          .order('created_at', { ascending: false }).limit(1000),
      ]);
      if (puRes.error) throw puRes.error;
      if (txRes.error) throw txRes.error;

      // 會員電郵另外查（不依賴外鍵關係）
      const ids = [...new Set([...(puRes.data || []), ...(txRes.data || [])].map((r) => r.member_id).filter(Boolean))];
      const emailById = {};
      if (ids.length) {
        const { data: profs, error: pErr } = await supabase.from('profiles').select('id, email').in('id', ids);
        if (pErr) throw pErr;
        (profs || []).forEach((p) => { emailById[p.id] = p.email; });
      }

      const purchases = (puRes.data || []).map((r) => ({
        key: `p-${r.id}`,
        time: r.purchased_at,
        kind: 'purchase',
        email: emailById[r.member_id] || r.member_id,
        label: `${r.products?.name || '（已刪除的商品）'}${r.duration ? ` · ${DUR_TEXT[r.duration] || r.duration}` : ''}`,
        amount: Number(r.price || 0),
      }));
      const recharges = (txRes.data || []).map((r) => ({
        key: `t-${r.id}`,
        time: r.created_at,
        kind: 'recharge',
        email: emailById[r.member_id] || r.member_id,
        label: '增值 USDT',
        amount: Number(r.amount || 0),
      }));
      setRows([...purchases, ...recharges].sort((a, b) => new Date(b.time) - new Date(a.time)));
    } catch (e) {
      setError(e.message || String(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(date); }, [date, load]);

  const summary = useMemo(() => {
    const s = { purchase: { n: 0, sum: 0 }, recharge: { n: 0, sum: 0 } };
    rows.forEach((r) => { s[r.kind].n += 1; s[r.kind].sum += r.amount; });
    return s;
  }, [rows]);

  const shown = rows.filter((r) => filter === 'all' || r.kind === filter);
  const isToday = date === hkToday();

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <button className="btn btn-ghost btn-sm" onClick={() => setDate(addDays(date, -1))}>◀ 前一天</button>
        <input
          type="date"
          value={date}
          max={hkToday()}
          onChange={(e) => e.target.value && setDate(e.target.value)}
          style={{ maxWidth: 170 }}
        />
        <button className="btn btn-ghost btn-sm" disabled={isToday} onClick={() => setDate(addDays(date, 1))}>後一天 ▶</button>
        {!isToday && <button className="btn btn-ghost btn-sm" onClick={() => setDate(hkToday())}>回到今天</button>}
        <button className="btn btn-ghost btn-sm" disabled={loading} onClick={() => load(date)}>{loading ? '載入中…' : '重新整理'}</button>
        <span style={{ color: 'var(--muted)', fontSize: 12.5 }}>香港時間 {date}{isToday ? '（今天）' : ''}</span>
      </div>

      {error && (
        <div className="form-panel" style={{ color: 'var(--red)', marginBottom: 16 }}>
          讀取失敗：{error}
          <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 6 }}>
            如果是權限錯誤，請先在 Supabase 執行 purchase_records_admin_read.sql。
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div className="form-panel" style={{ flex: '1 1 200px', margin: 0 }}>
          <div style={{ color: 'var(--muted)', fontSize: 12.5 }}>購買（{summary.purchase.n} 筆）</div>
          <div className="price" style={{ fontSize: 22 }}>{money(summary.purchase.sum)} USDT</div>
          <div className="fx-hint" style={{ marginLeft: 0 }}>≈ {usdtToHkd(summary.purchase.sum)} HKD</div>
        </div>
        <div className="form-panel" style={{ flex: '1 1 200px', margin: 0 }}>
          <div style={{ color: 'var(--muted)', fontSize: 12.5 }}>增值（{summary.recharge.n} 筆）</div>
          <div className="price" style={{ fontSize: 22 }}>{money(summary.recharge.sum)} USDT</div>
          <div className="fx-hint" style={{ marginLeft: 0 }}>≈ {usdtToHkd(summary.recharge.sum)} HKD</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {[['all', '全部'], ['purchase', '只看購買'], ['recharge', '只看增值']].map(([k, label]) => (
          <button key={k} className={filter === k ? 'btn btn-amber btn-sm' : 'btn btn-ghost btn-sm'} onClick={() => setFilter(k)}>{label}</button>
        ))}
      </div>

      <div className="form-panel">
        {!loading && shown.length === 0 ? (
          <div className="empty">這一天沒有記錄。</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr><th>日期時間</th><th>類型</th><th>會員</th><th>項目</th><th style={{ textAlign: 'right' }}>金額</th></tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.key}>
                    <td className="mono" style={{ whiteSpace: 'nowrap' }}>{hkDateTime(r.time)}</td>
                    <td><span className={`pill ${r.kind === 'recharge' ? '' : 'off'}`}>{r.kind === 'recharge' ? '增值' : '購買'}</span></td>
                    <td>{r.email}</td>
                    <td>{r.label}</td>
                    <td className="mono" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {r.kind === 'recharge' ? '+' : ''}{money(r.amount)} USDT
                      <div className="fx-hint" style={{ marginLeft: 0 }}>≈ {usdtToHkd(r.amount)} HKD</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
