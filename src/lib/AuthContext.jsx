import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../supabaseClient';

const AuthContext = createContext(null);
const SESSION_TOKEN_KEY = 'stockvip_session_token';
const OAUTH_PENDING_KEY = 'stockvip_oauth_pending';
const KICK_CHECK_INTERVAL_MS = 15000; // 每 15 秒检查一次是否被新装置登录挤下线

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null); // public.profiles 那一列（含 role / balance / wm_code）
  const [loading, setLoading] = useState(true);
  const [kicked, setKicked] = useState(false);
  const myTokenRef = useRef(null); // 本次登录写入 profiles.active_session_token 的那个 token

  const loadProfile = useCallback(async (userId) => {
    if (!userId) { setProfile(null); return null; }
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();
    if (error) {
      // eslint-disable-next-line no-console
      console.error('载入 profile 失败：', error.message);
      setProfile(null);
      return null;
    }
    setProfile(data);
    return data;
  }, []);

  // 写入一个新的单一装置登录 token。
  // 重要：只有「使用者真的按下登入按钮」这个明确动作才能呼叫这个函式，
  // 不可以挂在 onAuthStateChange 的 SIGNED_IN 事件上 ——
  // 因为浏览器刷新页面、开新分页时，Supabase 从本机储存恢复登入状态也常常会触发同一个事件，
  // 这样会误判成「又有人重新登入」，把自己既有的分页也一起挤下线。
  const claimSession = useCallback(async (userId) => {
    const token = crypto.randomUUID();
    const { error } = await supabase.from('profiles').update({ active_session_token: token }).eq('id', userId);
    if (!error) {
      myTokenRef.current = token;
      sessionStorage.setItem(SESSION_TOKEN_KEY, token);
    }
  }, []);

  // Google 登入：OAuth 会整页导去 Google、再导回来，跟输入帐密登入不是同一种流程，
  // 没办法像 claimSession(userId) 那样在按钮点击当下直接呼叫（这时候还没有 userId）。
  // 做法是先在 sessionStorage 留一个「即将透过 OAuth 登入」的标记，
  // 页面导回来、Supabase 侦测到网址上的授权码并换出 session 时会触发 SIGNED_IN 事件，
  // 这时如果看到标记存在，才视为一次「明确的登入动作」去抢占装置，然后把标记清掉。
  const loginWithGoogle = useCallback(async () => {
    sessionStorage.setItem(OAUTH_PENDING_KEY, '1');
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    if (error) sessionStorage.removeItem(OAUTH_PENDING_KEY);
    return { error };
  }, []);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      const userId = data.session?.user?.id;
      if (userId) {
        // 页面刷新、开新分页：沿用本分页原本记住的 token（可能是 null，代表这个分页还没参与过抢占判断，
        // 此时不主动抢占，也不参与踢除侦测，避免多分页互踢）
        myTokenRef.current = sessionStorage.getItem(SESSION_TOKEN_KEY);
        await loadProfile(userId);
      }
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      setSession(newSession);
      const userId = newSession?.user?.id;
      if (userId) {
        // Google OAuth 导回来会触发 SIGNED_IN，且 sessionStorage 留有 loginWithGoogle 设的标记，
        // 这才代表是一次真正的登入动作，要抢占装置；一般的 session 恢复不会有这个标记。
        if (event === 'SIGNED_IN' && sessionStorage.getItem(OAUTH_PENDING_KEY)) {
          sessionStorage.removeItem(OAUTH_PENDING_KEY);
          await claimSession(userId);
        }
        await loadProfile(userId);
      } else {
        setProfile(null);
        myTokenRef.current = null;
        sessionStorage.removeItem(SESSION_TOKEN_KEY);
      }
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile, claimSession]);

  // 定期检查：如果 profiles.active_session_token 跟本分页记住的不一致，代表已在别处重新登录，强制登出
  useEffect(() => {
    if (!session?.user?.id) return;
    const userId = session.user.id;
    const check = async () => {
      if (!myTokenRef.current) return; // 这个分页从未透过 claimSession 参与过抢占，不参与踢除判断
      const { data, error } = await supabase.from('profiles').select('active_session_token').eq('id', userId).single();
      if (error || !data) return;
      if (data.active_session_token && data.active_session_token !== myTokenRef.current) {
        setKicked(true);
        await supabase.auth.signOut();
      }
    };
    const timer = setInterval(check, KICK_CHECK_INTERVAL_MS);
    const onFocus = () => check();
    window.addEventListener('visibilitychange', onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('visibilitychange', onFocus);
    };
  }, [session?.user?.id]);

  const refreshProfile = useCallback(() => loadProfile(session?.user?.id), [loadProfile, session]);

  const value = {
    session,
    user: session?.user ?? null,
    profile,
    isAdmin: profile?.role === 'admin',
    loading,
    kicked,
    clearKicked: () => setKicked(false),
    claimSession, // 供 Login 页面在「使用者真的按下登入」那个当下明确呼叫
    loginWithGoogle,
    refreshProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth 必须在 <AuthProvider> 内使用');
  return ctx;
}
