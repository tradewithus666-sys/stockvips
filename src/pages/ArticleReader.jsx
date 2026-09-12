import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { useAuth } from '../lib/AuthContext';
import { useLang } from '../lib/LangContext';
import { formatPublishedAt, linkify, toEmbedUrl } from '../lib/format';
import { markArticleRead, fetchFavoriteArticleIds, toggleFavoriteArticle } from '../lib/api';
import WatermarkedVideo from '../components/WatermarkedVideo';
import PdfFullscreenViewer from '../components/PdfFullscreenViewer';

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
  const [downloadingPdf, setDownloadingPdf] = useState(null); // 正在下载中的 PDF path（用来控制该颗按钮的 loading 状态）

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

  async function handleDownloadPdf(path) {
    if (downloadingPdf) return; // 避免重複点击
    setDownloadingPdf(path);
    try {
      // 跟全萤幕检视器一样，先确认/刷新一次令牌，避免恰好过期导致 401
      let { data: sessionData } = await supabase.auth.getSession();
      let accessToken = sessionData?.session?.access_token;
      const expiresAt = sessionData?.session?.expires_at;
      const isExpiringSoon = expiresAt && expiresAt * 1000 < Date.now() + 30_000;
      if (!accessToken || isExpiringSoon) {
        const { data: refreshed } = await supabase.auth.refreshSession();
        accessToken = refreshed?.session?.access_token ?? accessToken;
      }
      if (!accessToken) throw new Error('尚未登入');

      const fetchPdf = (token) => fetch(
        `/.netlify/functions/pdf-watermark?article_id=${encodeURIComponent(id)}&path=${encodeURIComponent(path)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      let res = await fetchPdf(accessToken);
      if (res.status === 401) {
        const { data: refreshed } = await supabase.auth.refreshSession();
        if (refreshed?.session?.access_token) {
          res = await fetchPdf(refreshed.session.access_token);
        }
      }
      if (!res.ok) throw new Error(`下载失败（${res.status}）`);

      const bytes = await res.arrayBuffer();
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const filename = path?.split('/').pop() || 'document.pdf';
      a.download = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err.message || '下载失败，请稍后再试');
    } finally {
      setDownloadingPdf(null);
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
                  {/* 独立的下载按钮，如果网页内嵌检视器打不开，可以直接下载到本机用自己装置的 PDF App 打开。
                      stopPropagation 避免点下载时，事件往外冒泡触发外层卡片的 onClick（打开全萤幕检视器） */}
                  <button
                    className="pdf-preview-download-btn"
                    disabled={!owned || downloadingPdf === b.value}
                    onClick={(e) => { e.stopPropagation(); owned && handleDownloadPdf(b.value); }}
                    title="下载到本机"
                  >
                    {downloadingPdf === b.value ? '⏳ 下載中' : '⬇ 下載'}
                  </button>
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
        <PdfFullscreenViewer
          articleId={id}
          path={openPdf.value}
          watermarkText={profile?.email ?? user?.email ?? ''}
          onClose={() => setOpenPdf(null)}
        />
      )}
    </div>
  );
}
