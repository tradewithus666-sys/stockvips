import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchMyPermissions, fetchMyPurchases, fetchArticlesByProduct, purchaseWithBalance, fetchActiveAnnouncements, toggleEmailNotify, fetchMyFavoriteArticles, generateTelegramBindToken, fetchMyTelegramBinding, generateChannelInviteLink, fetchProductsWithTelegramChannel } from '../lib/api';
import { useAuth } from '../lib/AuthContext';
import { useToast } from '../lib/ToastContext';
import { useLang } from '../lib/LangContext';
import { formatPublishedDateOnly, usdtToHkd } from '../lib/format';
import { supabase } from '../supabaseClient';

function isExpired(dateStr) {
  if (!dateStr) return false;
  return new Date(dateStr) < new Date(new Date().toDateString());
}

function parseDevice(ua) {
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Firefox\//.test(ua) ? 'Firefox' : '浏览器';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'Mac' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : '';
  return os ? `${browser} · ${os}` : browser;
}

const DUR_MULT = { month: 1, quarter: 2.7, year: 9 };
function getDurationPrice(p, duration) {
  if (p.type === 'subscription') {
    if (duration === 'month') return p.price;
    if (duration === 'quarter') return p.price_quarter ?? Math.round(p.price * DUR_MULT.quarter);
    if (duration === 'year') return p.price_year ?? Math.round(p.price * DUR_MULT.year);
  }
  return Math.round(p.price * DUR_MULT[duration]);
}

export default function MemberCenter() {
  const { user, profile, refreshProfile } = useAuth();
  const nav = useNavigate();
  const showToast = useToast();
  const { t } = useLang();

  const DUR_LABEL = { month: t('dur_month'), quarter: t('dur_quarter'), year: t('dur_year') };
  const TYPE_META = {
    course:       { label: t('type_course'),       icon: '🎓', color: 'var(--green)',  tint: 'var(--green-tint)' },
    subscription: { label: t('type_subscription'), icon: '📡', color: 'var(--amber)',  tint: 'var(--amber-tint)' },
    shared:       { label: t('type_shared'),        icon: '🔑', color: 'var(--purple)', tint: 'var(--purple-tint)' },
  };

  async function logout() {
    await supabase.auth.signOut();
    showToast(t('toast_logged_out'));
    nav('/');
  }

  async function handleBindTelegram() {
    setBindingBusy(true);
    try {
      const token = await generateTelegramBindToken();
      window.open(`https://t.me/Stockvip_noti_bot?start=${token}`, '_blank', 'noopener');
      showToast(t('telegram_bind_opened_toast'));
    } catch (err) {
      showToast(err.message);
    } finally {
      setBindingBusy(false);
    }
  }


  async function handleGetInviteLink(productId) {
    try {
      const result = await generateChannelInviteLink(productId);
      if (result.status === 'ok') {
        window.open(result.invite_link, '_blank', 'noopener');
      } else if (result.status === 'telegram_not_bound') {
        showToast(t('invite_need_bind_first_toast'));
      } else if (result.status === 'channel_not_configured') {
        showToast(t('invite_channel_not_configured_toast'));
      } else {
        showToast(t('invite_link_failed_toast'));
      }
    } catch (err) {
      showToast(err.message);
    }
  }


  const [perms, setPerms] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [recentArticles, setRecentArticles] = useState({}); // productId -> articles[]
  const [announcements, setAnnouncements] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [telegramBinding, setTelegramBinding] = useState(null);
  const [bindingBusy, setBindingBusy] = useState(false);
  const [telegramProductIds, setTelegramProductIds] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [renewingId, setRenewingId] = useState(null);
  const [renewDuration, setRenewDuration] = useState('month');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) { nav('/login'); return; }
    fetchActiveAnnouncements().then(setAnnouncements).catch(() => {});
    fetchMyFavoriteArticles(user.id).then(setFavorites).catch(() => {});
    fetchMyTelegramBinding().then(setTelegramBinding).catch(() => {});
    fetchProductsWithTelegramChannel().then((ids) => setTelegramProductIds(new Set(ids))).catch(() => {});
    Promise.all([fetchMyPermissions(user.id), fetchMyPurchases(user.id)])
      .then(async ([p, pu]) => {
        setPerms(p);
        setPurchases(pu);
        const subs = p.filter((pm) => pm.products?.type === 'subscription' && !isExpired(pm.expires_at));
        const entries = await Promise.all(subs.map(async (pm) => {
          const list = await fetchArticlesByProduct(pm.product_id);
          return [pm.product_id, list.slice(0, 3)];
        }));
        setRecentArticles(Object.fromEntries(entries));
      })
      .finally(() => setLoading(false));
  }, [user, nav]);

  if (loading) return <div className="loading-screen">{t('loading')}</div>;

  const subPerms = perms.filter((p) => p.products?.type === 'subscription');
  const sharedPerms = perms.filter((p) => p.products?.type === 'shared');
  // 【本次修复】改用 permissions（权限）当资料来源，不是只看 purchases（购买记录）表。
  // 原因：管理员在后台直接授予权限的课程，只会写进 permissions，不会有对应的 purchases 记录，
  // 之前只看 purchases 会导致这种「管理员开通、非自行购买」的课程完全不会显示出来。
  const coursePerms = perms.filter((p) => p.products?.type === 'course');
  const device = user ? parseDevice(navigator.userAgent) : '—';
  const loginAt = user?.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString() : '';

  async function confirmRenew(pm) {
    const p = pm.products;
    const price = getDurationPrice(p, renewDuration);
    if ((profile?.balance ?? 0) < price) { showToast(t('balance_insufficient')); return; }
    setBusy(true);
    try {
      await purchaseWithBalance({ productId: p.id, duration: renewDuration, price });
      showToast(t('toast_renew_success', p.name));
      await refreshProfile();
      const fresh = await fetchMyPermissions(user.id);
      setPerms(fresh);
      setRenewingId(null);
    } catch (err) {
      showToast(err.message || t('toast_renew_failed'));
    } finally {
      setBusy(false);
    }
  }

  // 权限的到期日为「永久」（expires_at 为 null）时不应该出现续费按钮/面板，
  // 因为已经没有到期这回事，续费在这种情况下没有意义。
  function permRow(pm) {
    const expired = isExpired(pm.expires_at);
    const isSub = pm.products?.type === 'subscription';
    const isPermanent = !pm.expires_at;
    const articles = recentArticles[pm.product_id] || [];
    return (
      <div className="perm-row" key={pm.id} style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {pm.products?.image
              ? <img src={pm.products.image} alt="" style={{ width: 44, height: 44, borderRadius: 10, objectFit: 'cover', flexShrink: 0 }} />
              : <div className="badge-icon" style={{ width: 44, height: 44, fontSize: 18, flexShrink: 0 }}>🏅</div>}
            <div>
              <div style={{ fontWeight: 700, fontSize: 14.5 }}>{pm.products?.name}</div>
              <div className={`expiry-big ${expired ? 'bad' : ''}`}>{t('expires_label')}{pm.expires_at ?? t('permanent_valid')}</div>
              {isSub && (
                <label className="notify-toggle">
                  <input
                    type="checkbox"
                    checked={pm.notify_email !== false}
                    onChange={async (e) => {
                      const checked = e.target.checked;
                      try {
                        await toggleEmailNotify({ memberId: user.id, productId: pm.product_id, enabled: checked });
                        setPerms((prev) => prev.map((x) => x.id === pm.id ? { ...x, notify_email: checked } : x));
                      } catch (err) {
                        showToast(err.message);
                      }
                    }}
                  />
                  {t('email_notify_label')}
                </label>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div className={`status ${expired ? 'expired' : 'valid'}`}>{expired ? t('status_expired') : t('status_valid')}</div>
            {!isPermanent && (
              <button className="btn btn-amber btn-sm" onClick={() => { setRenewingId(renewingId === pm.id ? null : pm.id); setRenewDuration('month'); }}>{t('renew_btn')}</button>
            )}
            {isSub && !expired && (
              <button className="btn btn-outline-amber btn-sm" onClick={() => nav(`/feed/${pm.product_id}`)}>{t('view_all_articles_btn')}</button>
            )}
            {isSub && !expired && telegramProductIds.has(pm.product_id) && (
              <button className="btn btn-ghost btn-sm" onClick={() => handleGetInviteLink(pm.product_id)}>🔵 {t('enter_channel_btn')}</button>
            )}
            {!isSub && !expired && (
              <button className="btn btn-outline-amber btn-sm" onClick={() => nav(`/product/${pm.product_id}`)}>{t('view_content_btn')}</button>
            )}
          </div>
        </div>

        {!isPermanent && renewingId === pm.id && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
            <div className="dur-grid">
              {['month', 'quarter', 'year'].map((d) => (
                <div key={d} className={`dur-opt ${d === 'year' ? 'wide' : ''} ${renewDuration === d ? 'active' : ''}`} onClick={() => setRenewDuration(d)}>
                  {DUR_LABEL[d]} <small>${getDurationPrice(pm.products, d)} USDT <span className="fx-hint">≈{usdtToHkd(getDurationPrice(pm.products, d))}</span></small>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
              <div className="price" style={{ fontSize: 20 }}>${getDurationPrice(pm.products, renewDuration)}.00 USDT <span className="fx-hint">≈{usdtToHkd(getDurationPrice(pm.products, renewDuration))} HKD</span></div>
              <button className="btn btn-amber btn-sm" disabled={busy} onClick={() => confirmRenew(pm)}>{t('confirm_renew_btn')}</button>
            </div>
          </div>
        )}

        {isSub && !expired && (
          <div style={{ marginTop: 12, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
            {articles.length ? articles.map((a) => (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', cursor: 'pointer' }} onClick={() => nav(`/article/${a.id}`)}>
                <span className="art-date">{formatPublishedDateOnly(a)}</span>
                <span style={{ fontSize: 13, color: 'var(--text)' }}>{a.title}</span>
              </div>
            )) : <div style={{ fontSize: 12, color: 'var(--muted)', padding: '4px 0' }}>{t('no_articles_for_product')}</div>}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginTop: 32 }} className="section-title">
        <h2>{t('member_center_title')}</h2>
        <button className="btn btn-ghost btn-sm" onClick={logout}>{t('nav_logout')}</button>
      </div>
      <div className="info-card">
        <div className="who"><b>{profile?.email}</b><span>{t('joined_label')}{profile?.created_at?.slice(0, 10)}</span></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn btn-amber btn-sm" onClick={() => nav('/wallet')}>
            💰 {t('my_wallet')} <span style={{ opacity: 0.8, fontWeight: 600 }}>· {(profile?.balance ?? 0).toFixed(2)} USDT</span>
          </button>
          <div className="session-box">
            <span className="dotlive"></span>
            <div className="meta">{t('current_device')}<br /><b>{device}</b>{loginAt ? ` · ${loginAt}` : ''}</div>
          </div>
          {telegramBinding?.bound ? (
            <div className="session-box">
              <span className="dotlive"></span>
              <div className="meta">{t('telegram_bound_label')}<br /><b>@{telegramBinding.telegram_username || t('telegram_bound_no_username')}</b></div>
            </div>
          ) : (
            <button className="btn btn-ghost btn-sm" disabled={bindingBusy} onClick={handleBindTelegram}>
              🔵 {bindingBusy ? t('processing') : t('bind_telegram_btn')}
            </button>
          )}
        </div>
      </div>

      {announcements.length > 0 && (
        <div className="announcement-box">
          <div className="announcement-title">📢 {t('announcement_title')}</div>
          {announcements.map((a) => (
            <div key={a.id} className="announcement-item">{a.content}</div>
          ))}
        </div>
      )}

      <div className="section-title" style={{ marginTop: 30 }}><h2 style={{ fontSize: 18 }}>📡 {t('my_subscriptions')}</h2></div>
      {subPerms.length ? subPerms.map(permRow) : <div className="empty">{t('no_permission_yet')}</div>}

      <div className="section-title" style={{ marginTop: 30 }}>
        <h2 style={{ fontSize: 18 }}>{t('purchased_courses')}</h2><span className="tag">{t('count_orders', coursePerms.length)}</span>
      </div>
      {coursePerms.length ? coursePerms.map((pm) => {
        const meta = pm.products ? TYPE_META[pm.products.type] : null;
        // 有实际购买记录的话（真的用余额/USDT买的），显示价格跟购买日期；
        // 没有的话（管理员直接授权开通），显示「已开通」，不硬凑一个不存在的价格
        const matchedPurchase = purchases.find((pu) => pu.product_id === pm.product_id);
        return (
          <div className="purchase-row" key={pm.id} onClick={() => nav(`/product/${pm.product_id}`)}>
            <div>
              <div className="pname">
                {meta && <span className="type-chip" style={{ background: meta.tint, color: meta.color }}>{meta.icon} {meta.label}</span>}
                {pm.products?.name}
              </div>
              <div className="pmeta">
                {matchedPurchase ? t('purchase_meta', matchedPurchase.price, matchedPurchase.purchased_at?.slice(0, 10)) : t('course_granted_label')}
              </div>
            </div>
          </div>
        );
      }) : <div className="empty">{t('no_purchase_record')}</div>}

      <div className="section-title" style={{ marginTop: 30 }}><h2 style={{ fontSize: 18 }}>🔑 {t('my_shared_accounts')}</h2></div>
      {sharedPerms.length ? sharedPerms.map(permRow) : <div className="empty">{t('no_shared_yet')}</div>}

      <div className="section-title" style={{ marginTop: 30 }}>
        <h2 style={{ fontSize: 18 }}>❤️ {t('my_favorites')}</h2><span className="tag">{t('count_articles', favorites.length)}</span>
      </div>
      {favorites.length ? favorites.map((a) => (
        <div key={a.id} className="article-item" onClick={() => nav(`/article/${a.id}`)}>
          <div>
            <div className="ti">
              <span className="art-date">{formatPublishedDateOnly(a)}</span>
              {a.products?.name ? `[${a.products.name}] ` : ''}{a.title}
            </div>
          </div>
        </div>
      )) : <div className="empty">{t('no_favorites_yet')}</div>}
    </div>
  );
}
