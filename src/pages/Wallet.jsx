import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { useAuth } from '../lib/AuthContext';
import { useToast } from '../lib/ToastContext';
import { useLang } from '../lib/LangContext';

const QUICK_AMOUNTS = [100, 500, 1000, 5000];

// 充值走「转帐后人工核实」流程：会员选好金额、转帐后透过 Telegram 通知客服，
// 由后台管理员在「会员与权限」页确认后手动加值。
// 注意：跟原型不一样 —— 原型 Demo 版是点一下「立即充值」就直接把余额加上去，
// 这里刻意不这样做，因为这是真的会扣款购买内容的正式系统，
// 允许使用者自己任意加余额会是严重的安全漏洞。
export default function Wallet() {
  const { user, profile } = useAuth();
  const nav = useNavigate();
  const showToast = useToast();
  const { t } = useLang();
  const [txs, setTxs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState('');

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

  function requestRecharge() {
    const val = Number(amount);
    if (!val || val < 5) { showToast(t('toast_recharge_min')); return; }
    window.open(import.meta.env.VITE_TELEGRAM_SUPPORT_URL, '_blank', 'noopener');
    showToast(t('toast_recharge_request', val));
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
          <div className="wbc-amount">{(profile?.balance ?? 0).toFixed(2)}</div>
          <div className="wbc-usd">≈ ${(profile?.balance ?? 0).toFixed(2)} USD</div>
        </div>
      </div>

      <div className="form-panel">
        <div style={{ fontWeight: 700, marginBottom: 14 }}>{t('recharge_wallet')}</div>
        <div className="field" style={{ marginBottom: 14 }}>
          <label>{t('usdt_address_label')}</label>
          <input readOnly value={import.meta.env.VITE_USDT_BEP20_ADDRESS} onClick={(e) => e.target.select()} />
        </div>
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
            onKeyDown={(e) => { if (e.key === 'Enter') requestRecharge(); }}
          />
        </div>
        <button className="btn btn-amber btn-block" style={{ marginTop: 12 }} onClick={requestRecharge}>
          {t('recharge_request_btn')}
        </button>
        <div style={{ textAlign: 'center', fontSize: 11.5, color: 'var(--muted)', marginTop: 10 }}>
          {t('network_note_manual')}
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
