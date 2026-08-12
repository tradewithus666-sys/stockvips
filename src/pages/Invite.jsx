import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchInvitePublic, redeemInviteLink } from '../lib/api';
import { useAuth } from '../lib/AuthContext';
import { useToast } from '../lib/ToastContext';

const PENDING_INVITE_KEY = 'stockvip_pending_invite';

export default function Invite() {
  const { code } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const showToast = useToast();
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchInvitePublic(code).then(setInfo).finally(() => setLoading(false));
    // 【重要】不管现在有没有登入，先把邀请码存进 localStorage。
    // 这是为了应付「需要信箱验证」那种情况：会员注册后要先去信箱点验证连结，
    // 验证连结导回来的网址是 Supabase 后台设定的固定网址，不会带着这次的邀请码，
    // 但 localStorage 是长期保存的，验证完回来登入时（见 App.jsx）还是抓得到这个待兑换的邀请码。
    localStorage.setItem(PENDING_INVITE_KEY, code);
  }, [code]);

  useEffect(() => {
    if (!loading && info?.status === 'ok' && user) {
      handleRedeem();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, info, user]);

  async function handleRedeem() {
    setBusy(true);
    try {
      const res = await redeemInviteLink(code);
      localStorage.removeItem(PENDING_INVITE_KEY);
      if (res.status === 'ok') { showToast('开通成功！'); nav('/member'); }
      else if (res.status === 'already_redeemed') { showToast('你已经使用过这个连结了'); nav('/member'); }
      else { showToast('连结已失效'); nav('/'); }
    } catch (err) {
      showToast(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="loading-screen">载入中…</div>;
  if (info?.status !== 'ok') return <div className="empty">邀请连结无效或已被兑换完</div>;

  return (
    <div className="auth-wrap">
      <div className="auth-card" style={{ textAlign: 'center' }}>
        <h1 className="display" style={{ fontSize: 20 }}>🎁 你收到一份邀请</h1>
        <p style={{ color: 'var(--muted)', margin: '14px 0' }}>
          兑换后可获得「<b>{info.product_name}</b>」{info.days ? `${info.days} 天` : '永久'}权限
        </p>
        {user ? (
          <button className="btn btn-amber btn-block" disabled={busy} onClick={handleRedeem}>{busy ? '处理中…' : '立即兑换'}</button>
        ) : (
          <>
            <button className="btn btn-amber btn-block" onClick={() => nav(`/register?redirect=/invite/${code}`)}>注册并兑换</button>
            <button className="btn btn-ghost btn-block" style={{ marginTop: 10 }} onClick={() => nav(`/login?redirect=/invite/${code}`)}>已有帐号，登入兑换</button>
          </>
        )}
      </div>
    </div>
  );
}

export { PENDING_INVITE_KEY };
