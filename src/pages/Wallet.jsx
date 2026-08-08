import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { createRechargeIntent } from '../lib/api';
import { useAuth } from '../lib/AuthContext';
import { useToast } from '../lib/ToastContext';
import { useLang } from '../lib/LangContext';
import { usdtToHkd } from '../lib/format';

const QUICK_AMOUNTS = [100, 500, 1000, 5000];

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
    if (!val || val < 5) { showToast(t('toast_recharge_min')); return; }
    setBusy(true);
    try {
      const intent = await createRechargeIntent({ amount: val, address: import.meta.env.VITE_USDT_BEP20_ADDRESS });
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
        <div className="quick-amt-grid">
          {QUICK_AMOUNTS.map((v) => (
            <button
              key={v}
              className={`quick-amt ${String(v) === amount ? 'selected' : ''} ${v === 500 ? 'hot' : ''}`}
              onClick={() => setAmount(String(v))}
            >
              {v}
              {v === 500 && <span className="hot-badge">HOT</span>}
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
          <div className="rate-hint">${amount} USDT ≈ ${usdtToHkd(amount)} HKD</div>
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
