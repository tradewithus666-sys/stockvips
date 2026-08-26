import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { supabase } from '../supabaseClient';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

/**
 * 全萤幕 PDF 检视器。不再用 Google Docs Viewer（那需要一个任何人都能连到的公开网址，
 * 这正是之前浮水印被绕过、原始檔案被直接下载走的破口）。
 * 改成：带着会员自己的登入令牌，去问专门的 Netlify Function 要「这次请求专属」的
 * 浮水印版本 PDF 位元组，抓到之后完全在浏览器本地用 PDF.js 画出来，不假手任何第三方服务。
 *
 * 附带好处：改成把每一页画进独立的 canvas、疊在一个可以直接用手指自然捲动的容器里，
 * 不再是内嵌 iframe 跟外层文章页面抢触控，滑动体验也一併获得改善。
 */
export default function PdfFullscreenViewer({ articleId, path, watermarkText, onClose }) {
  const containerRef = useRef(null);
  const [status, setStatus] = useState('loading'); // loading | error | ready

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setStatus('loading');
      try {
        // 【本次修复】改用 getSession() 前先确认/刷新一次，避免因为登入令牌恰好过期
        // 导致 Function 那边验证身份失败（401）。Supabase 通常会自动在背景刷新令牌，
        // 但如果分页刚好从背景切回前景、或者剛好卡在快过期的那個瞬間，
        // 手上拿到的 access_token 有可能還是舊的、已经失效的那把。
        let { data: sessionData } = await supabase.auth.getSession();
        let accessToken = sessionData?.session?.access_token;
        const expiresAt = sessionData?.session?.expires_at; // unix 秒数
        const isExpiringSoon = expiresAt && expiresAt * 1000 < Date.now() + 30_000; // 30 秒内就要过期，视为不安全
        if (!accessToken || isExpiringSoon) {
          const { data: refreshed } = await supabase.auth.refreshSession();
          accessToken = refreshed?.session?.access_token ?? accessToken;
        }
        if (!accessToken) throw new Error('尚未登入');

        const fetchPdf = (token) => fetch(
          `/.netlify/functions/pdf-watermark?article_id=${encodeURIComponent(articleId)}&path=${encodeURIComponent(path)}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );

        let res = await fetchPdf(accessToken);
        // 如果还是遇到 401（例如上面的预先判断没抓到、令牌恰好在这个瞬间失效），
        // 保险起见强制刷新一次令牌、重试最后一次，而不是直接放弃
        if (res.status === 401) {
          const { data: refreshed } = await supabase.auth.refreshSession();
          if (refreshed?.session?.access_token) {
            res = await fetchPdf(refreshed.session.access_token);
          }
        }
        if (!res.ok) throw new Error(`载入失败（${res.status}）`);

        const bytes = await res.arrayBuffer();
        if (cancelled) return;

        const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
        if (cancelled) return;

        const container = containerRef.current;
        if (!container) return;
        container.innerHTML = '';

        // 依裝置寬度決定顯示大小，但實際渲染解析度要再乘上裝置像素密度（例如 Retina 荧幕是 2 或 3 倍），
        // 不然渲染出来的像素數只夠一般荧幕用，在高密度荧幕上被拉伸放大显示，就会看起来模糊。
        const targetWidth = Math.min(container.clientWidth || 900, 900);
        const pixelRatio = window.devicePixelRatio || 1;

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          if (cancelled) return;
          const page = await pdf.getPage(pageNum);
          const baseViewport = page.getViewport({ scale: 1 });
          const displayScale = targetWidth / baseViewport.width;
          const renderScale = displayScale * pixelRatio; // 实际渲染解析度：显示大小 × 装置像素密度
          const viewport = page.getViewport({ scale: renderScale });

          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          // 画布本身用高解析度渲染，但透过 CSS 显示尺寸压回原本要的大小，
          // 这样在高密度荧幕上，同样的显示大小塞进去的实际像素数更多，看起来才会锐利
          canvas.style.display = 'block';
          canvas.style.width = `${targetWidth}px`;
          canvas.style.height = `${viewport.height / pixelRatio}px`;
          canvas.style.marginBottom = '10px';
          container.appendChild(canvas);

          const ctx = canvas.getContext('2d');
          await page.render({ canvasContext: ctx, viewport }).promise;
        }

        if (!cancelled) setStatus('ready');
      } catch (err) {
        if (!cancelled) setStatus('error');
      }
    }

    load();
    return () => { cancelled = true; };
  }, [articleId, path]);

  return (
    <div className="pdf-fullscreen-overlay">
      <div className="pdf-fullscreen-header">
        <button className="pdf-fullscreen-close" onClick={onClose}>✕</button>
      </div>
      <div className="pdf-fullscreen-body">
        {status !== 'ready' && (
          <div className="pdf-fullscreen-status">
            {status === 'loading' ? '载入中…' : '载入失败，请稍后再试'}
          </div>
        )}
        {/* 【本次修复】这个 div 永远保持空白、不透过 JSX 渲染任何子节点，
            这样 React 认定它「没有子节点需要管」，之后 PDF.js 用 appendChild 手动塞进去的
            canvas 元素就不会跟 React 自己的 DOM 更新逻辑互相打架。
            之前把「载入中」文字跟 PDF.js 手动插入的 canvas 放在同一个 React 管理的容器里，
            React 重新渲染时想找回它以为存在的节点、却找不到（因为被我们手动清空过），
            导致 removeChild 报错、整个 App 崩溃变成黑屏。 */}
        <div ref={containerRef} className="pdf-pages-container" />
      </div>
      {/* 【本次修改】拿掉原本疊在这层最上面的 HTML 浮水印——PDF 檔案本身在伺服器端
          已经烧了会员专属浮水印（密集斜纹 email + 四角固定宣传文字），
          这层疊加的浮水印不再需要，避免看起来太密、影响阅读体验 */}
    </div>
  );
}
