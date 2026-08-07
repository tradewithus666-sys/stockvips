import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { fetchPaymentIntent, checkPaymentIntent } from '../lib/api';
import { useToast } from '../lib/ToastContext';

export default function PayUsdt() {
  const { id } = useParams();
  const nav = useNavigate();
  const showToast = useToast();
  const [intent, setIntent] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(600);
  const [status, setStatus] = useState('pending');
  const pollRef = useRef(null);

  useEffect(() => {
    fetchPaymentIntent(id).then((data) => {
      setIntent(data);
      const left = Math.max(0, Math.floor((new Date(data.expires_at) - new Date()) / 1000));
      setSecondsLeft(left);
      if (data.status === 'paid') setStatus('paid');
    });
  }, [id]);

  useEffect(() => {
    if (status !== 'pending') return;
    pollRef.current = setInterval(async () => {
      try {
        const result = await checkPaymentIntent(id);
        if (result.status === 'paid') {
          setStatus('paid');
          clearInterval(pollRef.current);
        } else if (result.status === 'expired') {
          setStatus('expired');
          clearInterval(pollRef.current);
        }
      } catch (err) {
        // ignore transient errors, keep polling
      }
    }, 10000);
    return () => clearInterval(pollRef.current);
  }, [id, status]);

  useEffect(() => {
    if (status !== 'pending') return;
    const timer = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) { setStatus('expired'); return 0; }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [status]);

  function copyAddress() {
    navigator.clipboard.writeText(intent.address);
    showToast('已复制地址');
  }

  if (!intent) return <div className="loading-screen">载入中…</div>;

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, '0');
  const ss = String(secondsLeft % 60).padStart(2, '0');
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(intent.address)}`;

  if (status === 'paid') {
    return (
      <div className="form-panel" style={{ textAlign: 'center', maxWidth: 420, margin: '60px auto' }}>
        <div style={{ fontSize: 48 }}>✅</div>
        <h2 style={{ margin: '14px 0' }}>支付成功</h2>
        <p style={{ color: 'var(--muted)', marginBottom: 20 }}>
          {intent.kind === 'recharge' ? `余额已到帐 +${intent.amount} HKD` : `${intent.products?.name} 权限已开通`}
        </p>
        <button className="btn btn-amber" onClick={() => nav(intent.kind === 'recharge' ? '/wallet' : '/member')}>
          {intent.kind === 'recharge' ? '返回钱包' : '前往会员中心'}
        </button>
      </div>
    );
  }

  if (status === 'expired') {
    return (
      <div className="form-panel" style={{ textAlign: 'center', maxWidth: 420, margin: '60px auto' }}>
        <div style={{ fontSize: 48 }}>⏰</div>
        <h2 style={{ margin: '14px 0' }}>订单已过期</h2>
        <button className="btn btn-ghost" onClick={() => nav(-1)}>返回重新下单</button>
      </div>
    );
  }

  return (
    <div className="form-panel" style={{ textAlign: 'center', maxWidth: 420, margin: '40px auto' }}>
      <h2 style={{ marginBottom: 6 }}>USDT-BEP20 转账</h2>
      <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 18 }}>请在 {mm}:{ss} 内完成转账，系统会自动识别到账</p>
      <img src={qrUrl} alt="QR" style={{ borderRadius: 12, marginBottom: 14 }} />
      <div className="price" style={{ fontSize: 26, marginBottom: 10 }}>${intent.amount} USDT</div>
      <div className="field" style={{ marginBottom: 14 }}>
        <label>收款地址</label>
        <input readOnly value={intent.address} onClick={copyAddress} />
      </div>
      <button className="btn btn-amber btn-block" onClick={copyAddress}>复制地址</button>
      <p style={{ color: 'var(--muted)', fontSize: 11.5, marginTop: 14 }}>转账后系统每 10 秒自动检查一次链上到账，无需手动确认</p>
    </div>
  );
}
