import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { fetchArticlesByProduct, fetchCategoriesByProduct, fetchReadArticleIds, fetchFavoriteArticleIds, toggleFavoriteArticle } from '../lib/api';
import { useAuth } from '../lib/AuthContext';
import { useToast } from '../lib/ToastContext';
import { useLang } from '../lib/LangContext';
import { formatPublishedAt } from '../lib/format';

export default function ProductFeed() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const showToast = useToast();
  const { t } = useLang();
  const [product, setProduct] = useState(null);
  const [articles, setArticles] = useState([]);
  const [categories, setCategories] = useState([]);
  const [activeCat, setActiveCat] = useState('all');
  const [search, setSearch] = useState('');
  const [readIds, setReadIds] = useState(new Set());
  const [favoriteIds, setFavoriteIds] = useState(new Set());
  const [owned, setOwned] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      const { data: p } = await supabase.from('products').select('*').eq('id', id).single();
      if (!mounted) return;
      setProduct(p);
      const [list, cats] = await Promise.all([fetchArticlesByProduct(id), fetchCategoriesByProduct(id)]);
      if (mounted) { setArticles(list); setCategories(cats); }
      if (user) {
        const { data: perm } = await supabase
          .from('permissions').select('*').eq('member_id', user.id).eq('product_id', id).maybeSingle();
        const valid = perm && (!perm.expires_at || new Date(perm.expires_at) >= new Date(new Date().toDateString()));
        if (mounted) setOwned(!!valid);
        const [reads, favs] = await Promise.all([fetchReadArticleIds(user.id), fetchFavoriteArticleIds(user.id)]);
        if (mounted) { setReadIds(new Set(reads)); setFavoriteIds(new Set(favs)); }
      }
      setLoading(false);
    }
    load();
    return () => { mounted = false; };
  }, [id, user]);

  async function handleToggleFavorite(e, articleId) {
    e.stopPropagation();
    if (!user) { showToast(t('toast_login_first')); nav('/login'); return; }
    const isFav = favoriteIds.has(articleId);
    const next = new Set(favoriteIds);
    isFav ? next.delete(articleId) : next.add(articleId);
    setFavoriteIds(next); // 先乐观更新画面，避免使用者点了没反应的感觉
    try {
      await toggleFavoriteArticle({ memberId: user.id, articleId, isFavorite: !isFav });
    } catch (err) {
      setFavoriteIds(favoriteIds); // 失败就退回原本状态
      showToast(err.message);
    }
  }

  if (loading) return <div className="loading-screen">{t('loading')}</div>;
  if (!product) return <div className="empty">{t('product_not_found')}</div>;

  const filteredArticles = articles
    .filter((a) => activeCat === 'all' || a.category_id === activeCat)
    .filter((a) => !search.trim() || a.title?.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <div>
      <div className="breadcrumb">{t('breadcrumb_home')} » <b>{product.name}</b></div>
      <button className="btn btn-ghost" style={{ margin: '18px 0' }} onClick={() => nav(`/product/${product.id}`)}>{t('detail_back')}</button>

      <div className="hero" style={{ padding: '40px 44px', marginBottom: 32 }}>
        <div className="hero-inner">
          <div className="hero-eyebrow">📡 {t('latest_articles')}</div>
          <h1 className="display" style={{ fontSize: 30 }}>{product.name}</h1>
          <p>{product.description}</p>
          {!owned && <button className="btn btn-amber" style={{ marginTop: 20 }} onClick={() => nav(`/product/${product.id}`)}>{t('subscribe_unlock')}</button>}
        </div>
      </div>

      <div className="site-search-bar">
        <span className="site-search-icon">🔍</span>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('search_articles_placeholder')} />
        {search && <button className="site-search-clear" onClick={() => setSearch('')}>✕</button>}
      </div>

      {categories.length > 0 && (
        <div className="filter-chip-row">
          <button className={`filter-chip ${activeCat === 'all' ? 'active' : ''}`} onClick={() => setActiveCat('all')}>{t('category_all')}</button>
          {categories.map((c) => (
            <button key={c.id} className={`filter-chip ${activeCat === c.id ? 'active' : ''}`} onClick={() => setActiveCat(c.id)}>{c.name}</button>
          ))}
        </div>
      )}

      <div className="section-title"><h2>{t('all_articles')}</h2><span className="tag">{t('count_articles', filteredArticles.length)}</span></div>
      {filteredArticles.length === 0 && <div className="empty">{t('article_none')}</div>}
      <div className={owned ? '' : 'article-feed-locked'}>
        {filteredArticles.map((a) => (
          <div
            key={a.id}
            className="article-item"
            onClick={() => owned ? nav(`/article/${a.id}`) : showToast(t('locked_read_prompt'))}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {user && !readIds.has(a.id) && <span className="unread-dot" title={t('unread_label')} />}
              <div className="ti">
                <span className="art-date">{formatPublishedAt(a)}</span>
                {owned ? '' : '🔒 '}{a.title}
              </div>
            </div>
            {user && (
              <button className={`favorite-btn ${favoriteIds.has(a.id) ? 'active' : ''}`} onClick={(e) => handleToggleFavorite(e, a.id)} title={t('favorite_toggle_label')}>
                {favoriteIds.has(a.id) ? '❤️' : '🤍'}
              </button>
            )}
          </div>
        ))}
        {!owned && filteredArticles.length > 0 && (
          <div className="feed-lock-overlay">
            <div style={{ fontSize: 24 }}>🔒</div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{t('feed_lock_text')}</div>
          </div>
        )}
      </div>
    </div>
  );
}
