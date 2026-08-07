import { useEffect } from 'react';
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import Nav from './components/Nav';
import Watermark from './components/Watermark';
import RequireAdmin from './components/RequireAdmin';
import { useAuth } from './lib/AuthContext';
import { useToast } from './lib/ToastContext';
import { useLang } from './lib/LangContext';

import Home from './pages/Home';
import Login from './pages/Login';
import Register from './pages/Register';
import ProductDetail from './pages/ProductDetail';
import ProductFeed from './pages/ProductFeed';
import ArticleReader from './pages/ArticleReader';
import MemberCenter from './pages/MemberCenter';
import Wallet from './pages/Wallet';
import Help from './pages/Help';
import PayUsdt from './pages/PayUsdt';
import Admin from './pages/Admin';

const WATERMARK_PATHS = ['/member', '/wallet'];

export default function App() {
  const { profile, loading, kicked, clearKicked } = useAuth();
  const location = useLocation();
  const nav = useNavigate();
  const showToast = useToast();
  const { t } = useLang();

  // ---------- 内容防护：非管理后台页面禁用右键菜单／拖拽／复制 ----------
  useEffect(() => {
    const isAdminRoute = location.pathname.startsWith('/admin');
    document.body.classList.toggle('protected-mode', !isAdminRoute);

    function onContextMenu(e) { if (!isAdminRoute) e.preventDefault(); }
    function onDragStart(e) { if (!isAdminRoute) e.preventDefault(); }
    function onCopy(e) {
      const isContentPage = location.pathname.startsWith('/article/') || location.pathname.startsWith('/product/');
      if (isContentPage) {
        e.preventDefault();
        showToast(t('toast_copy_blocked'));
      }
    }
    document.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('dragstart', onDragStart);
    document.addEventListener('copy', onCopy);
    return () => {
      document.removeEventListener('contextmenu', onContextMenu);
      document.removeEventListener('dragstart', onDragStart);
      document.removeEventListener('copy', onCopy);
    };
  }, [location.pathname, showToast, t]);

  // ---------- 单一装置登录：侦测到被新装置挤下线时提示并导回登录页 ----------
  useEffect(() => {
    if (kicked) {
      showToast(t('toast_kicked'));
      clearKicked();
      nav('/login');
    }
  }, [kicked, clearKicked, nav, showToast, t]);

  // ---------- App 切到背景时模糊画面 ----------
  // 重要提醒：网页没有任何 API 能侦测或阻挡「使用者按下截图」这个 OS 层级的动作，
  // 这段做的是退而求其次的防护——侦测「App 被切到背景」（滑上去看多工预览、切到别的 App），
  // 在这个瞬间把画面模糊，减少内容出现在系统多工预览缩图里的机会。对真正的截图没有帮助。
  useEffect(() => {
    function blurOn() { document.body.classList.add('privacy-blur'); }
    function blurOff() { document.body.classList.remove('privacy-blur'); }
    function onVisibility() { if (document.hidden) blurOn(); else blurOff(); }
    window.addEventListener('blur', blurOn);
    window.addEventListener('focus', blurOff);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('blur', blurOn);
      window.removeEventListener('focus', blurOff);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  if (loading) return <div className="loading-screen">{t('loading')}</div>;

  const showWatermark = !!profile && (
    WATERMARK_PATHS.some((p) => location.pathname.startsWith(p)) ||
    location.pathname.startsWith('/product/') ||
    location.pathname.startsWith('/feed/') ||
    location.pathname.startsWith('/article/')
  );

  return (
    <>
      <Watermark text={profile?.email} active={showWatermark} />
      <Nav />
      <div className="page">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/product/:id" element={<ProductDetail />} />
          <Route path="/feed/:id" element={<ProductFeed />} />
          <Route path="/article/:id" element={<ArticleReader />} />
          <Route path="/member" element={<MemberCenter />} />
          <Route path="/wallet" element={<Wallet />} />
          <Route path="/help" element={<Help />} />
          <Route path="/pay/:id" element={<PayUsdt />} />
          {/* 管理后台入口已从导览列移除，仅能直接输入 /admin 网址进入，由 RequireAdmin 做权限保护 */}
          <Route path="/admin" element={<RequireAdmin><Admin /></RequireAdmin>} />
        </Routes>
      </div>
    </>
  );
}
