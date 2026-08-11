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

  // 关掉浏览器自己的捲动还原机制，避免跟我们下面自己写的还原逻辑互相打架
  useEffect(() => {
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual';
    }
  }, []);

  // ---------- 记住捲动位置，切换 App 后被系统重新载入时自动恢复 ----------
  // 手机浏览器背景分页被系统回收内存后，切回来会整页重新载入（不是我们程式码的 bug，
  // 是浏览器本身的记忆体管理机制），重新载入后画面会回到最顶端。这里用 sessionStorage
  // 记住每个路径的捲动位置，重新载入后内容渲染完再自动帮你捲回原本的位置。
  useEffect(() => {
    let saveTimer = null;
    function saveScroll() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        sessionStorage.setItem(`scrollpos:${location.pathname}`, String(window.scrollY));
      }, 150); // 节流一下，不用每个 scroll 事件都写
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
    // 内容是非同步载入的（先转圈圈再渲染），要等实际内容够高了才能捲得到目标位置，
    // 用短暂延迟＋多试几次的方式，而不是只捲一次就放弃
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
