import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { fetchArticlesByProduct } from '../lib/api';
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
  const [owned, setOwned] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      const { data: p } = await supabase.from('products').select('*').eq('id', id).single();
      if (!mounted) return;
      setProduct(p);
      const list = await fetchArticlesByProduct(id);
      if (mounted) setArticles(list);
      if (user) {
        const { data: perm } = await supabase
          .from('permissions').select('*').eq('member_id', user.id).eq('product_id', id).maybeSingle();
        const valid = perm && (!perm.expires_at || new Date(perm.expires_at) >= new Date(new Date().toDateString()));
        if (mounted) setOwned(!!valid);
      }
      setLoading(false);
    }
    load();
    return () => { mounted = false; };
  }, [id, user]);

  if (loading) return <div className="loading-screen">{t('loading')}</div>;
  if (!product) return <div className="empty">{t('product_not_found')}</div>;

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

      <div className="section-title"><h2>{t('all_articles')}</h2><span className="tag">{t('count_articles', articles.length)}</span></div>
      {articles.length === 0 && <div className="empty">{t('article_none')}</div>}
      <div className={owned ? '' : 'article-feed-locked'}>
        {articles.map((a) => (
          <div
            key={a.id}
            className="article-item"
            onClick={() => owned ? nav(`/article/${a.id}`) : showToast(t('locked_read_prompt'))}
          >
            <div>
              <div className="ti"><span className="art-date">{formatPublishedAt(a)}</span>{owned ? '' : '🔒 '}{a.title}</div>
              <div className="sm">{a.summary}</div>
            </div>
          </div>
        ))}
        {!owned && articles.length > 0 && (
          <div className="feed-lock-overlay">
            <div style={{ fontSize: 24 }}>🔒</div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{t('feed_lock_text')}</div>
          </div>
        )}
      </div>
    </div>
  );
}
