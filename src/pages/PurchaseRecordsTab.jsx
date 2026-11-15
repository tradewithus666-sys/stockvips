// src/pages/PurchaseRecordsTab.jsx
//
// 後台「購買記錄」分頁：由新到舊列出會員在網頁上自行
//   1. 購買（用餘額購買／續費，來自 purchases 表）
//   2. 增值（成功的充值，來自 wallet_tx 表）
// 管理員在後台直接開通權限不會出現在這裡。每次顯示最新 30 筆，按「載入更多」再往前看。

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { usdtToHkd } from '../lib/format';

const PAGE = 30;
const DUR_TEXT = { month: '月費', quarter: '季費', year: '年費', lifetime: '買斷' };

function hkDateTime(iso) {
  return new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Hong_Kong' }); // 2026-11-15 13:05:22
}
function money(n) {
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function PurchaseRecordsTab() {
  const [limit, setLimit] = useState(PAGE);
  const [rows, setRows] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [filter, setFilter] = useState('all'); // all | purchase | recharge
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async (n) => {
    setLoading(true);
    setError(null);
    try {
      const [puRes, txRes] = await Promise.all([
        supabase.from('purchases').select('*, products(name)')
          .order('purchased_at', { ascending: false }).limit(n),
        supabase.from('wallet_tx').select('*')
          .eq('status', 'success')
          .order('created_at', { ascending: false }).limit(n),
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
      // 兩個來源各取最新 n 筆，合併後最新的 n 筆一定都在裡面
      const merged = [...purchases, ...recharges].sort((a, b) => new Date(b.time) - new Date(a.time));
      setRows(merged.slice(0, n));
      setHasMore((puRes.data || []).length >= n || (txRes.data || []).length >= n);
    } catch (e) {
      setError(e.message || String(e));
      setRows([]);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(limit); }, [limit, load]);

  const shown = rows.filter((r) => filter === 'all' || r.kind === filter);

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        {[['all', '全部'], ['purchase', '只看購買'], ['recharge', '只看增值']].map(([k, label]) => (
          <button key={k} className={filter === k ? 'btn btn-amber btn-sm' : 'btn btn-ghost btn-sm'} onClick={() => setFilter(k)}>{label}</button>
        ))}
        <button className="btn btn-ghost btn-sm" disabled={loading} onClick={() => load(limit)}>{loading ? '載入中…' : '重新整理'}</button>
      </div>

      {error && (
        <div className="form-panel" style={{ color: 'var(--red)', marginBottom: 16 }}>
          讀取失敗：{error}
          <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 6 }}>
            如果是權限錯誤，請先在 Supabase 執行 purchase_records_admin_read.sql。
          </div>
        </div>
      )}

      <div className="form-panel">
        {!loading && shown.length === 0 && <div className="empty">目前沒有記錄。</div>}

        {shown.map((r) => (
          <div
            key={r.key}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, padding: '14px 0', borderBottom: '1px solid var(--line)' }}
          >
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span
                  className="pill"
                  style={r.kind === 'recharge'
                    ? { color: 'var(--green)', background: 'var(--green-tint)', whiteSpace: 'nowrap' }
                    : { color: 'var(--amber)', background: 'var(--amber-tint)', whiteSpace: 'nowrap' }}
                >
                  {r.kind === 'recharge' ? '增值' : '購買'}
                </span>
                <span className="mono" style={{ fontSize: 12.5, color: 'var(--muted)' }}>{hkDateTime(r.time)}</span>
              </div>
              <div style={{ fontWeight: 600, marginTop: 6, wordBreak: 'break-word' }}>{r.label}</div>
              <div style={{ color: 'var(--muted)', fontSize: 12.5, marginTop: 2, wordBreak: 'break-all' }}>{r.email}</div>
            </div>
            <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
              <div className="mono" style={{ fontWeight: 700, color: r.kind === 'recharge' ? 'var(--green)' : 'var(--text)' }}>
                {r.kind === 'recharge' ? '+' : ''}{money(r.amount)} USDT
              </div>
              <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 2 }}>≈ {usdtToHkd(r.amount)} HKD</div>
            </div>
          </div>
        ))}

        {hasMore && (
          <div style={{ textAlign: 'center', paddingTop: 16 }}>
            <button className="btn btn-ghost" disabled={loading} onClick={() => setLimit(limit + PAGE)}>
              {loading ? '載入中…' : '載入更多'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
