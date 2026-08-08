import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { useToast } from '../lib/ToastContext';
import { useAuth } from '../lib/AuthContext';
import { useLang } from '../lib/LangContext';

// 注意：验证信是 Supabase Auth 内建寄送的（Authentication -> Email Templates 可以客制中文信件内容），
// 不需要像原型那样自己刻「发送验证码」的假流程。
export default function Register() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const nav = useNavigate();
  const showToast = useToast();
  const { claimSession, loginWithGoogle } = useAuth();
  const { t } = useLang();

  async function doRegister(e) {
    e.preventDefault();
    setError('');
    if (password.length < 6) { setError(t('err_password_short')); return; }
    if (password !== confirm) { setError(t('err_password_mismatch')); return; }
    setBusy(true);
    const { data, error: err } = await supabase.auth.signUp({ email, password });
    setBusy(false);
    if (err) { setError(err.message); return; }
    // 若后台关闭了「Confirm email」，注册后会直接拿到 session（等同直接登入），一并抢占单一装置 token
    if (data?.session && data?.user?.id) {
      await claimSession(data.user.id);
      showToast(t('toast_welcome_back', email));
      nav('/');
      return;
    }
    setSent(true);
  }

  async function handleGoogleLogin() {
    setError('');
    const { error: err } = await loginWithGoogle();
    if (err) setError(err.message);
  }

  if (sent) {
    return (
      <div className="auth-wrap">
        <div className="auth-logo"><img className="mark" src="/logo.jpg" alt="StockVIP" /></div>
        <div className="auth-card" style={{ textAlign: 'center' }}>
          <h1 className="display" style={{ fontSize: 20, marginBottom: 10 }}>{t('check_email_title')}</h1>
          <p style={{ color: 'var(--muted)', fontSize: 13.5 }}>
            {t('check_email_desc')} <b style={{ color: 'var(--text)' }}>{email}</b>，{t('check_email_hint')}
          </p>
          <button className="btn btn-ghost" style={{ marginTop: 18 }} onClick={() => nav('/login')}>{t('go_login_btn')}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-wrap">
      <div className="auth-logo"><img className="mark" src="/logo.jpg" alt="StockVIP" /></div>
      <div className="auth-title">
        <div className="hero-eyebrow">◆ {t('official_badge')}</div>
        <h1 className="display">{t('register_title')}</h1>
        <p>{t('register_subtitle')}</p>
      </div>
      <form className="auth-card" onSubmit={doRegister}>
        <button type="button" className="oauth-btn" onClick={handleGoogleLogin}>
          <svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84c-.21 1.13-.84 2.09-1.8 2.73v2.27h2.91c1.7-1.57 2.69-3.88 2.69-6.64z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.17l-2.91-2.27c-.81.54-1.84.86-3.05.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.33C2.44 15.98 5.48 18 9 18z"/><path fill="#FBBC05" d="M3.96 10.71c-.18-.54-.29-1.11-.29-1.71s.11-1.17.29-1.71V4.96H.96A8.99 8.99 0 0 0 0 9c0 1.45.35 2.83.96 4.04l3-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0 5.48 0 2.44 2.02.96 4.96l3 2.33C4.67 5.16 6.66 3.58 9 3.58z"/></svg>
          {t('google_login_btn')}
        </button>
        <div className="divider">{t('or_divider')}</div>
        <div className="auth-field">
          <label>{t('email_label')}</label>
          <div className="input-wrap">
            <span className="icon">✉</span>
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required placeholder="you@example.com" />
          </div>
        </div>
        <div className="auth-field">
          <label>{t('password_label')}</label>
          <div className="input-wrap">
            <span className="icon">🔒</span>
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" required placeholder="••••••••" />
          </div>
        </div>
        <div className="auth-field">
          <label>{t('confirm_password_label')}</label>
          <div className="input-wrap">
            <span className="icon">🔒</span>
            <input value={confirm} onChange={(e) => setConfirm(e.target.value)} type="password" required placeholder="••••••••" />
          </div>
        </div>
        {error && <div className="err-text">{error}</div>}
        <button className="btn btn-amber btn-block" style={{ marginTop: 8 }} disabled={busy} type="submit">
          {busy ? t('processing') : t('complete_register_btn')}
        </button>
        <div className="auth-switch">{t('have_account')} <a onClick={() => nav('/login')}>{t('go_login')}</a></div>
      </form>
    </div>
  );
}
