import { Navigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { useLang } from '../lib/LangContext';

// 注意：这只是「前端体验层」的保护（未授权直接导回首页），
// 真正的安全边界是 Supabase RLS（见 supabase/schema.sql），
// 就算有人绕过前端路由，没有 role='admin' 也读写不了管理资料。
export default function RequireAdmin({ children }) {
  const { loading, isAdmin, user } = useAuth();
  const { t } = useLang();
  if (loading) return <div className="loading-screen">{t('loading')}</div>;
  if (!user || !isAdmin) return <Navigate to="/" replace />;
  return children;
}
