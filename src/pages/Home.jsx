import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchProducts, fetchMyPermissions } from '../lib/api';
import { useAuth } from '../lib/AuthContext';
import { useLang } from '../lib/LangContext';
import { usdtToHkd } from '../lib/format';

function isExpired(dateStr) {
  if (!dateStr) return false;
  return new Date(dateStr) < new Date(new Date().toDateString());
}

export default function Home() {
  const [products, setProducts] = useState([]);
  const [unlockedIds, setUnlockedIds] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const nav = useNavigate();
  const { user } = useAuth();
  const { t } = useLang();

  const TYPE_META = {
    course:       { label: t('type_course'),       icon: '🎓', color: 'var(--green)',  tint: 'var(--green-tint)' },
    subscription: { label: t('type_subscription'), icon: '📡', color: 'var(--amber)',  tint: 'var(--amber-tint)' },
    shared:       { label: t('type_shared'),        icon: '🔑', color: 'var(--purple)', tint: 'var(--purple-tint)' },
  };

  useEffect(() => {
    fetchProducts().then(setProducts).catch(console.error).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!user?.id) { setUnlockedIds(new Set()); return; }
    fetchMyPermissions(user.id)
      .then((perms) => {
        const ids = perms.filter((pm) => !isExpired(pm.expires_at)).map((pm) => pm.product_id);
        setUnlockedIds(new Set(ids));
      })
      .catch(console.error);
  }, [user?.id]);

  if (loading) return <div className="loading-screen">{t('loading')}</div>;

  return (
    <div>
      <div className="hero">
        <div className="hero-inner">
          <div className="hero-eyebrow">◆ {t('official_badge')}</div>
          <h1 className="display">{t('hero_title')}</h1>
          <p>{t('hero_desc')}</p>
          <a
            href="https://t.me/stocktrading666"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-amber"
            style={{ marginTop: 18, display: 'inline-flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}
          >
            💬 {t('join_telegram_group_btn')}
          </a>
        </div>
      </div>

      <div className="site-search-bar">
        <span className="site-search-icon">🔍</span>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('search_products_placeholder')}
        />
        {search && <button className="site-search-clear" onClick={() => setSearch('')}>✕</button>}
      </div>

      {['subscription', 'course', 'shared'].map((type) => {
        const list = products.filter((p) => p.type === type && (
          !search.trim() ||
          p.name?.toLowerCase().includes(search.trim().toLowerCase()) ||
          p.description?.toLowerCase().includes(search.trim().toLowerCase())
        ));
        const meta = TYPE_META[type];
        return (
          <div className="cat-section" key={type}>
            <div className="cat-head">
              <div className="cat-icon" style={{ background: meta.tint, color: meta.color }}>{meta.icon}</div>
              <div>
                <div className="cat-title">{meta.label}</div>
                <div className="cat-sub">{t('count_items', list.length)}</div>
              </div>
            </div>
            <div className="grid">
              {list.length === 0 && <div className="empty">{t('empty_none')}</div>}
              {list.map((p) => {
                const owned = unlockedIds.has(p.id);
                return (
                <div className="card" key={p.id} onClick={() => nav(`/product/${p.id}`)}>
                  <div className={`card-cover ${p.image ? 'has-img' : ''}`}>
                    {p.image
                      ? <img className="card-cover-img" src={p.image} alt="" />
                      : <div className="badge-icon">🏅</div>}
                    <div className="card-tag" style={{ background: meta.tint, color: meta.color }}>
                      {meta.icon} {meta.label}
                    </div>
                    {owned && p.status !== 'off' && <div className="card-unlocked">{t('card_unlocked')}</div>}
                  </div>
                  <div className="card-body">
                    <h3>{p.name}</h3>
                    <p>{p.description}</p>
                    {((p.base_sold ?? 0) + (p.sold ?? 0)) > 0 && (
                      <div className="card-meta">
                        <span>{t('card_sold')} <b>{(p.base_sold ?? 0) + (p.sold ?? 0)}</b></span>
                      </div>
                    )}
                    <div className="card-foot">
                      <div className="price">
                        ${p.price} USDT <span className="fx-hint">≈ {usdtToHkd(p.price)} HKD</span>
                        <span>{p.type === 'course' ? t('price_suffix_course') : t('price_suffix_month')}</span>
                      </div>
                      {p.status === 'off'
                        ? <span className="pill off">{t('card_off')}</span>
                        : <span className="pill">{owned ? t('card_view_detail') : t('card_click_view')}</span>}
                    </div>
                  </div>
                </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
