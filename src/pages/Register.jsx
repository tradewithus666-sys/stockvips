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
  const { claimSession } = useAuth();
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

  if (sent) {
    return (
      <div className="auth-wrap">
        <div className="auth-logo"><div className="mark">M/C</div></div>
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
      <div className="auth-logo"><div className="mark">M/C</div></div>
      <div className="auth-title">
        <div className="hero-eyebrow">◆ {t('official_badge')}</div>
        <h1 className="display">{t('register_title')}</h1>
        <p>{t('register_subtitle')}</p>
      </div>
      <form className="auth-card" onSubmit={doRegister}>
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
