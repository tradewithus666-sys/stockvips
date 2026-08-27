import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { useLang } from '../lib/LangContext';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const nav = useNavigate();
  const { t } = useLang();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    // 導回自己網站的 /reset-password，會員點信件連結會直接回到這裡輸入新密碼，
    // 不會被導去 Supabase 內建的畫面
    const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setBusy(false);
    // 不管信箱有没有真的存在都显示「已寄出」这个统一讯息，避免被用来试探哪些 email 有註冊过
    if (err) { setError(err.message); return; }
    setSent(true);
  }

  return (
    <div className="auth-wrap">
      <div className="auth-logo"><img className="mark" src="/logo.jpg" alt="StockVIP" /></div>
      <div className="auth-title">
        <h1 className="display">{t('forgot_password_title')}</h1>
        <p>{t('forgot_password_subtitle')}</p>
      </div>
      <div className="auth-card">
        {sent ? (
          <div>
            <div className="upload-hint" style={{ marginBottom: 16 }}>{t('forgot_password_sent_hint')}</div>
            <button className="btn btn-ghost btn-block" onClick={() => nav('/login')}>{t('back_to_login_btn')}</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="auth-field">
              <label>{t('email_label')}</label>
              <div className="input-wrap">
                <span className="icon">✉</span>
                <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required placeholder="you@example.com" />
              </div>
            </div>
            {error && <div className="err-text">{error}</div>}
            <button className="btn btn-amber btn-block" style={{ marginTop: 8 }} disabled={busy} type="submit">
              {busy ? t('processing') : t('send_reset_link_btn')}
            </button>
            <div className="auth-switch">
              <a onClick={() => nav('/login')}>{t('back_to_login_btn')}</a>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
