import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { useLang } from '../lib/LangContext';

export default function ResetPassword() {
  const [ready, setReady] = useState(false); // Supabase 有没有成功从信件连结换出一个可以重设密码的临时 session
  const [expired, setExpired] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const nav = useNavigate();
  const { t } = useLang();

  useEffect(() => {
    let mounted = true;
    // Supabase 侦测到网址上带的重设密码令牌时，会自动换出一个临时 session 并丢出
    // PASSWORD_RECOVERY 这个事件；同时也主动检查一次目前 session，避免事件在监听器
    // 挂上之前就已经触发、错过的边缘情况
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setReady(true);
    });
    supabase.auth.getSession().then(({ data }) => {
      if (mounted && data.session) setReady(true);
    });
    // 给个合理的等待时间，超过还没侦测到有效令牌，代表连结无效或已过期
    const timer = setTimeout(() => {
      if (mounted) setReady((r) => { if (!r) setExpired(true); return r; });
    }, 4000);
    return () => { mounted = false; sub.subscription.unsubscribe(); clearTimeout(timer); };
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (password.length < 6) { setError(t('reset_password_too_short')); return; }
    if (password !== confirm) { setError(t('reset_password_mismatch')); return; }

    setBusy(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (err) { setError(err.message); return; }

    setDone(true);
    // 重设成功后，为了安全起见（这个连结可能是在共用装置上点开的），主动登出，
    // 让会员回到登入页用新密码重新登入，而不是留着一个隐性已登入状态
    await supabase.auth.signOut();
    setTimeout(() => nav('/login'), 2000);
  }

  return (
    <div className="auth-wrap">
      <div className="auth-logo"><img className="mark" src="/logo.jpg" alt="StockVIP" /></div>
      <div className="auth-title">
        <h1 className="display">{t('reset_password_title')}</h1>
      </div>
      <div className="auth-card">
        {expired ? (
          <div>
            <div className="err-text" style={{ marginBottom: 16 }}>{t('reset_link_expired_hint')}</div>
            <button className="btn btn-amber btn-block" onClick={() => nav('/forgot-password')}>{t('resend_reset_link_btn')}</button>
          </div>
        ) : done ? (
          <div className="upload-hint">{t('reset_password_done_hint')}</div>
        ) : !ready ? (
          <div className="loading-screen" style={{ minHeight: 120 }}>{t('loading')}</div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="auth-field">
              <label>{t('new_password_label')}</label>
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
              {busy ? t('processing') : t('reset_password_submit_btn')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
