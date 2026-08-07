import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../supabaseClient';
import { useToast } from '../lib/ToastContext';
import { useLang } from '../lib/LangContext';
import { LANGS, LANG_LABEL } from '../lib/i18n';

export default function Nav() {
  const nav = useNavigate();
  const { user, profile } = useAuth();
  const showToast = useToast();
  const { lang, setLang, t } = useLang();

  async function logout() {
    await supabase.auth.signOut();
    showToast(t('toast_logged_out'));
    nav('/');
  }

  return (
    <div className="nav">
      <div className="logo" onClick={() => nav('/')}>
        <div className="mark">M/C</div>
        <div>StockVIP<span className="sub">投资研究所 · TRADING LAB</span></div>
      </div>
      <div className="nav-right">
        <div className="lang-switch">
          {LANGS.map((l) => (
            <button key={l} className={`lang-btn ${lang === l ? 'active' : ''}`} onClick={() => setLang(l)}>
              {LANG_LABEL[l]}
            </button>
          ))}
        </div>
        {user ? (
          <>
            <span className="nav-user">{profile?.email ?? user.email}</span>
            <button className="btn btn-ghost" onClick={() => nav('/member')}>{t('nav_member')}</button>
            <button className="btn btn-ghost" onClick={logout}>{t('nav_logout')}</button>
          </>
        ) : (
          <button className="btn btn-ghost" onClick={() => nav('/login')}>{t('nav_login')}</button>
        )}
        {/* 管理后台入口已从导览列移除，仅能透过直接输入 /admin 网址进入；
            路由本身仍由 <RequireAdmin> 做 role='admin' 权限检查，未授权会被导回。 */}
      </div>
    </div>
  );
}
