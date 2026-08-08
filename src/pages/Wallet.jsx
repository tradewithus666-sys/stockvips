import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { createRechargeIntent } from '../lib/api';
import { useAuth } from '../lib/AuthContext';
import { useToast } from '../lib/ToastContext';
import { useLang } from '../lib/LangContext';
import { usdtToHkd } from '../lib/format';

const QUICK_AMOUNTS = [100, 500, 1000, 5000];

// 限时充值优惠：只限 USDT 充值方式，活动到期后自动失效
const PROMO_DEADLINE = new Date('2026-09-08T00:00:00+08:00');
const PROMO_TIERS = { 100: 120, 300: 380, 500: 650, 1000: 1350 };
function getCreditAmount(payAmount) {
  const val = Number(payAmount);
  if (new Date() > PROMO_DEADLINE) return val;
  return PROMO_TIERS[val] ?? val;
}

export default function Wallet() {
  const { user, profile } = useAuth();
  const nav = useNavigate();
  const showToast = useToast();
  const { t } = useLang();
  const [txs, setTxs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) { nav('/login'); return; }
    supabase
      .from('wallet_tx')
      .select('*')
      .eq('member_id', user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => setTxs(data || []))
      .finally(() => setLoading(false));
  }, [user, nav]);

  if (loading) return <div className="loading-screen">{t('loading')}</div>;

  async function startRecharge() {
    const val = Number(amount);
    if (!val || val < 1) { showToast(t('toast_recharge_min')); return; }
    setBusy(true);
    try {
      const intent = await createRechargeIntent({
        amount: val,
        address: import.meta.env.VITE_USDT_BEP20_ADDRESS,
        creditAmount: getCreditAmount(val),
      });
      nav(`/pay/${intent.id}`);
    } catch (err) {
      showToast(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="breadcrumb">{t('wallet_breadcrumb')}</div>
      <button className="btn btn-ghost" style={{ margin: '18px 0' }} onClick={() => nav('/member')}>{t('detail_back')}</button>

      <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 24 }}>💰 {t('my_wallet')}</h2>

      <div className="wallet-balance-card">
        <div className="wbc-icon">💳</div>
        <div>
          <div className="wbc-label">{t('available_balance')}</div>
          <div className="wbc-amount">{(profile?.balance ?? 0).toFixed(2)} USDT</div>
          <div className="wbc-usd">≈ {usdtToHkd(profile?.balance ?? 0)} HKD</div>
        </div>
      </div>

      <div className="form-panel">
        <div style={{ fontWeight: 700, marginBottom: 14 }}>{t('recharge_wallet')}</div>

        {new Date() < PROMO_DEADLINE && (
          <div className="promo-box">
            <div className="promo-title">🎉 {t('promo_title')}</div>
            <div className="promo-item">🔹 {t('promo_pay')} $100 👉 {t('promo_get')} $120（{t('promo_earn')} $20！）</div>
            <div className="promo-item">🔹 {t('promo_pay')} $300 👉 {t('promo_get')} $380（{t('promo_earn')} $80！）</div>
            <div className="promo-item">🔹 {t('promo_pay')} $500 👉 {t('promo_get')} $650（{t('promo_earn')} $150！）</div>
            <div className="promo-item">🌟 {t('promo_pay')} $1000 👉 {t('promo_get')} $1350（{t('promo_earn_big')} $350！{t('promo_return')} 35%！）</div>
            <div className="promo-note">{t('promo_usdt_only')} · {t('promo_deadline')} 2026-09-08 00:00</div>
          </div>
        )}

        <div className="quick-amt-grid">
          {QUICK_AMOUNTS.map((v) => (
            <button
              key={v}
              className={`quick-amt ${String(v) === amount ? 'selected' : ''} ${v === 500 ? 'hot' : ''}`}
              onClick={() => setAmount(String(v))}
            >
              {v}
              {v === 500 && <span className="hot-badge">HOT</span>}
              {PROMO_TIERS[v] && new Date() < PROMO_DEADLINE && <span className="promo-badge">+{PROMO_TIERS[v] - v}</span>}
            </button>
          ))}
        </div>
        <div className="field" style={{ marginTop: 12 }}>
          <input
            type="number"
            placeholder={t('custom_amount_placeholder')}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') startRecharge(); }}
          />
        </div>
        {Number(amount) > 0 && (
          <div className="rate-hint">
            ${amount} USDT ≈ ${usdtToHkd(amount)} HKD
            {getCreditAmount(amount) > Number(amount) && (
              <span style={{ color: 'var(--amber)', fontWeight: 700 }}> · {t('promo_will_get')} ${getCreditAmount(amount)} USDT！</span>
            )}
          </div>
        )}
        <button className="btn btn-amber btn-block" style={{ marginTop: 12 }} disabled={busy} onClick={startRecharge}>
          {busy ? t('processing') : t('recharge_request_btn')}
        </button>
        <div style={{ textAlign: 'center', fontSize: 11.5, color: 'var(--muted)', marginTop: 10 }}>
          {t('network_note')}
        </div>
      </div>

      <div className="form-panel">
        <div style={{ fontWeight: 700, marginBottom: 14 }}>{t('tx_history')}</div>
        {txs.length === 0 && <div className="empty">{t('no_tx_yet')}</div>}
        {txs.map((tx) => (
          <div key={tx.id} className="wallet-tx-item">
            <div className="wtx-icon">✓</div>
            <div style={{ flex: 1 }}>
              <div className="wtx-amount">{t('recharge_label')} +{tx.amount} USDT</div>
              <div className="wtx-meta">{new Date(tx.created_at).toLocaleString()}</div>
            </div>
            <div className="wtx-status">{tx.status === 'success' ? t('tx_success') : tx.status}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
