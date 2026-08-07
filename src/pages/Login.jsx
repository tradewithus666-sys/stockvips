import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
  const showToast = useToast();
  const { claimSession } = useAuth();
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
    nav('/');
  }

  return (
    <div className="auth-wrap">
      <div className="auth-logo"><div className="mark">M/C</div></div>
      <div className="auth-title">
        <div className="hero-eyebrow">◆ {t('official_badge')}</div>
        <h1 className="display">{t('login_title')}</h1>
        <p>{t('login_subtitle')}</p>
      </div>
      <form className="auth-card" onSubmit={doLogin}>
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
        <div className="auth-switch">{t('no_account_yet')} <a onClick={() => nav('/register')}>{t('register_now')}</a></div>
      </form>
    </div>
  );
}
