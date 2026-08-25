import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { useAuth } from '../lib/AuthContext';
import { useLang } from '../lib/LangContext';
import { formatPublishedAt, linkify, toEmbedUrl } from '../lib/format';
import { markArticleRead, fetchFavoriteArticleIds, toggleFavoriteArticle } from '../lib/api';
import WatermarkedVideo from '../components/WatermarkedVideo';
import Watermark from '../components/Watermark';

export default function ArticleReader() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user, profile } = useAuth();
  const { t } = useLang();
  const [article, setArticle] = useState(null);
  const [productId, setProductId] = useState(null);
  const [owned, setOwned] = useState(false);
  const [isFavorite, setIsFavorite] = useState(false);
  const [loading, setLoading] = useState(true);
  const [openPdf, setOpenPdf] = useState(null); // { value } | null —— 全萤幕检视中的 PDF

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
        if (valid) {
          markArticleRead(user.id, a.id).catch(() => {}); // 已读标记失败不影响阅读体验，静默处理
        }
        const favIds = await fetchFavoriteArticleIds(user.id);
        if (mounted) setIsFavorite(favIds.includes(a.id));
      }
      setLoading(false);
    }
    load();
    return () => { mounted = false; };
  }, [id, user]);

  // 全萤幕检视 PDF 时，锁住背景页面不能捲动，避免手指滑 PDF 时不小心带动外层页面一起动
  useEffect(() => {
    document.body.style.overflow = openPdf ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [openPdf]);

  async function handleToggleFavorite() {
    if (!user) { nav('/login'); return; }
    const next = !isFavorite;
    setIsFavorite(next);
    try {
      await toggleFavoriteArticle({ memberId: user.id, articleId: id, isFavorite: next });
    } catch (err) {
      setIsFavorite(!next);
    }
  }

  if (loading) return <div className="loading-screen">{t('loading')}</div>;
  if (!article) return <div className="empty">{t('product_not_found_short')}</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '18px 0' }}>
        <button className="btn btn-ghost" onClick={() => nav(`/feed/${productId}`)}>{t('detail_back')}</button>
        {user && (
          <button className={`favorite-btn ${isFavorite ? 'active' : ''}`} onClick={handleToggleFavorite} title={t('favorite_toggle_label')}>
            {isFavorite ? '❤️' : '🤍'} {t('favorite_toggle_label')}
          </button>
        )}
      </div>
      <div className={`reader ${owned ? '' : 'locked'}`}>
        <h3 className="display">{article.title}</h3>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>{t('published_on')} {formatPublishedAt(article)}</div>
        <div className="article-flow">
          {(article.blocks || []).map((b, i) =>
            b.type === 'image'
              ? <img key={i} className="inline-img" src={b.value} alt="" loading="lazy" />
              : b.type === 'pdf'
              ? (
                <div
                  key={i}
                  className="pdf-preview-card"
                  onClick={() => owned && setOpenPdf({ value: b.value })}
                >
                  <div className="pdf-preview-icon">📄</div>
                  <div className="pdf-preview-text">
                    <div className="pdf-preview-title">{t('pdf_preview_title')}</div>
                    <div className="pdf-preview-hint">{t('pdf_preview_hint')}</div>
                  </div>
                  <div className="pdf-preview-arrow">→</div>
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

      {openPdf && (
        <div className="pdf-fullscreen-overlay">
          <div className="pdf-fullscreen-header">
            <button className="pdf-fullscreen-close" onClick={() => setOpenPdf(null)}>✕</button>
          </div>
          <div className="pdf-fullscreen-body">
            <iframe
              className="pdf-fullscreen-iframe"
              src={`https://docs.google.com/viewer?url=${encodeURIComponent(openPdf.value)}&embedded=true`}
              title="pdf-fullscreen"
            />
            {/* Google 內嵌檢視器右上角自己有個「在新分頁開啟」按鈕，沒辦法直接移除跨網域 iframe
                裡的元素，疊一層透明遮擋層盖住那個位置，點了沒反應但畫面上還是看得到。 */}
            <div className="pdf-fullscreen-block-corner" />
          </div>
          {/* 全萤幕检视时，原本外层那份浮水印的 z-index 比这个疊层低、会被盖住，
              这里另外重新渲染一份、给更高的 z-index，确保浮水印保护强度不因为看 PDF 而消失 */}
          <Watermark text={profile?.email ?? user?.email ?? ''} active={true} zIndex={10000} />
        </div>
      )}
    </div>
  );
}
