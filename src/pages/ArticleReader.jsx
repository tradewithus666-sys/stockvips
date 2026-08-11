import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { useAuth } from '../lib/AuthContext';
import { useLang } from '../lib/LangContext';
import { formatPublishedAt, linkify, toEmbedUrl } from '../lib/format';
import WatermarkedVideo from '../components/WatermarkedVideo';

export default function ArticleReader() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user, profile } = useAuth();
  const { t } = useLang();
  const [article, setArticle] = useState(null);
  const [productId, setProductId] = useState(null);
  const [owned, setOwned] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      const { data: a } = await supabase.from('articles').select('*').eq('id', id).single();
      if (!mounted || !a) { setLoading(false); return; }
      setArticle(a);
      setProductId(a.product_id);
      if (user) {
        const { data: perm } = await supabase
          .from('permissions').select('*').eq('member_id', user.id).eq('product_id', a.product_id).maybeSingle();
        const valid = perm && (!perm.expires_at || new Date(perm.expires_at) >= new Date(new Date().toDateString()));
        if (mounted) setOwned(!!valid);
      }
      setLoading(false);
    }
    load();
    return () => { mounted = false; };
  }, [id, user]);

  if (loading) return <div className="loading-screen">{t('loading')}</div>;
  if (!article) return <div className="empty">{t('product_not_found_short')}</div>;

  return (
    <div>
      <button className="btn btn-ghost" style={{ margin: '18px 0' }} onClick={() => nav(`/feed/${productId}`)}>{t('detail_back')}</button>
      <div className={`reader ${owned ? '' : 'locked'}`}>
        <h3 className="display">{article.title}</h3>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>{t('published_on')} {formatPublishedAt(article)}</div>
        <div className="article-flow">
          {(article.blocks || []).map((b, i) =>
            b.type === 'image'
              ? <img key={i} className="inline-img" src={b.value} alt="" loading="lazy" />
              : b.type === 'pdf'
              ? (
                <div key={i} className="pdf-wrap">
                  <iframe className="inline-pdf" src={`https://docs.google.com/viewer?url=${encodeURIComponent(b.value)}&embedded=true`} title={`pdf-${i}`} />
                  <div className="pdf-block-corner" />
                </div>
              )
              : b.type === 'video'
              ? (() => {
                  const embed = toEmbedUrl(b.value);
                  return embed
                    ? <WatermarkedVideo key={i} embedUrl={embed} watermarkText={profile?.email ?? user?.email ?? ''} index={i} />
                    : null;
                })()
              : <div key={i} className="body-text">{linkify(b.value)}</div>
          )}
        </div>
        {!owned && (
          <div className="lock-badge">
            <div className="icon">🔒</div>
            <div style={{ fontSize: 14, color: 'var(--text)', fontWeight: 600 }}>{t('not_yet_unlocked')}</div>
            <button className="btn btn-amber" onClick={() => nav('/')}>{t('go_purchase_unlock')}</button>
          </div>
        )}
        <div className="disclaimer-text">{t('channel_disclaimer')}</div>
      </div>
    </div>
  );
}
