import { useEffect } from 'react';
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import Nav from './components/Nav';
import Watermark from './components/Watermark';
import RequireAdmin from './components/RequireAdmin';
import { useAuth } from './lib/AuthContext';
import { useToast } from './lib/ToastContext';
import { useLang } from './lib/LangContext';
import { redeemInviteLink } from './lib/api';

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
import Invite from './pages/Invite';

const WATERMARK_PATHS = ['/member', '/wallet'];
const PENDING_INVITE_KEY = 'stockvip_pending_invite';

export default function App() {
  const { profile, loading, kicked, clearKicked } = useAuth();
  const location = useLocation();
  const nav = useNavigate();
  const showToast = useToast();
  const { t } = useLang();

  useEffect(() => {
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual';
    }
  }, []);

  useEffect(() => {
    let saveTimer = null;
    function saveScroll() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        sessionStorage.setItem(`scrollpos:${location.pathname}`, String(window.scrollY));
      }, 150);
    }
    window.addEventListener('scroll', saveScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', saveScroll);
      clearTimeout(saveTimer);
    };
  }, [location.pathname]);

  useEffect(() => {
    const saved = sessionStorage.getItem(`scrollpos:${location.pathname}`);
    if (!saved) return;
    const y = Number(saved);
    if (!y) return;
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      window.scrollTo(0, y);
      if (document.body.scrollHeight > y + window.innerHeight || attempts > 10) {
        clearInterval(timer);
      }
    }, 100);
    return () => clearInterval(timer);
  }, [location.pathname]);

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

  useEffect(() => {
    if (kicked) {
      showToast(t('toast_kicked'));
      clearKicked();
      nav('/login');
    }
  }, [kicked, clearKicked, nav, showToast, t]);

  // ---------- 邀请连结备援机制 ----------
  // 应付「需要信箱验证」的注册流程：会员从邀请连结去注册，验证信里的连结会把他导回
  // Supabase 后台设定的固定网址（不会带着 /invite/xxx 这个路径），所以他验证完、正常登入进来后，
  // 这里侦测到 profile 载入成功、且 localStorage 里还留着一个「尚未兑换」的邀请码，
  // 就自动帮他补兑换一次，不用他自己再去找一次那条连结。
  useEffect(() => {
    if (!profile) return;
    const pendingCode = localStorage.getItem(PENDING_INVITE_KEY);
    if (!pendingCode) return;
    // 如果使用者现在人正在邀请连结页面本身，让 Invite.jsx 自己处理就好，这里不重複兑换
    if (location.pathname.startsWith('/invite/')) return;

    redeemInviteLink(pendingCode)
      .then((res) => {
        localStorage.removeItem(PENDING_INVITE_KEY);
        if (res.status === 'ok') {
          showToast('你的邀请奖励已自动开通！');
        }
      })
      .catch(() => {
        localStorage.removeItem(PENDING_INVITE_KEY);
      });
  }, [profile, location.pathname, showToast]);

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
          <Route path="/invite/:code" element={<Invite />} />
          {/* 管理后台入口已从导览列移除，仅能直接输入 /admin 网址进入，由 RequireAdmin 做权限保护 */}
          <Route path="/admin" element={<RequireAdmin><Admin /></RequireAdmin>} />
        </Routes>
      </div>
    </>
  );
}
