import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { useToast } from '../lib/ToastContext';
import { useAuth } from '../lib/AuthContext';
import { useLang } from '../lib/LangContext';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const showToast = useToast();
  const { claimSession, loginWithGoogle } = useAuth();
  const { t } = useLang();

  async function doLogin(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    const { data, error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) { setBusy(false); setError(err.message); return; }
    // 明确的登入动作：抢占单一装置登入 token，把该帐号其他装置踢下线
    if (data?.user?.id) await claimSession(data.user.id);
    setBusy(false);
    showToast(t('toast_welcome_back', email));
    // 【本次新增】如果是从邀请连结导来登入的（网址带 ?redirect=/invite/xxx），登入完导回原本那个连结，
    // 不是傻傻导去首页——不然会员登入完还要自己再找一次邀请连结才能兑换
    nav(searchParams.get('redirect') || '/');
  }

  async function handleGoogleLogin() {
    setError('');
    const { error: err } = await loginWithGoogle();
    // 正常情况下这行不会执行到——signInWithOAuth 会直接把整个页面导去 Google，
    // 只有在「连呼叫都失败」时（例如 Google provider 还没在 Supabase 开启）才会走到这里。
    if (err) setError(err.message);
  }

  return (
    <div className="auth-wrap">
      <div className="auth-logo"><img className="mark" src="/logo.jpg" alt="StockVIP" /></div>
      <div className="auth-title">
        <div className="hero-eyebrow">◆ {t('official_badge')}</div>
        <h1 className="display">{t('login_title')}</h1>
        <p>{t('login_subtitle')}</p>
      </div>
      <div className="auth-card">
        <button type="button" className="oauth-btn" onClick={handleGoogleLogin}>
          <svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84c-.21 1.13-.84 2.09-1.8 2.73v2.27h2.91c1.7-1.57 2.69-3.88 2.69-6.64z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.17l-2.91-2.27c-.81.54-1.84.86-3.05.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.33C2.44 15.98 5.48 18 9 18z"/><path fill="#FBBC05" d="M3.96 10.71c-.18-.54-.29-1.11-.29-1.71s.11-1.17.29-1.71V4.96H.96A8.99 8.99 0 0 0 0 9c0 1.45.35 2.83.96 4.04l3-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0 5.48 0 2.44 2.02.96 4.96l3 2.33C4.67 5.16 6.66 3.58 9 3.58z"/></svg>
          {t('google_login_btn')}
        </button>
        <div className="divider">{t('or_divider')}</div>
        <form onSubmit={doLogin}>
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
          {error && <div className="err-text">{error}</div>}
          <button className="btn btn-amber btn-block" style={{ marginTop: 8 }} disabled={busy} type="submit">
            {busy ? t('logging_in') : t('login_btn')}
          </button>
          <div className="auth-switch">{t('no_account_yet')} <a onClick={() => nav(`/register${searchParams.get('redirect') ? `?redirect=${encodeURIComponent(searchParams.get('redirect'))}` : ''}`)}>{t('register_now')}</a></div>
        </form>
      </div>
    </div>
  );
}
