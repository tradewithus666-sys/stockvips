import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { supabase } from '../supabaseClient';
import Watermark from './Watermark';

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
        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData?.session?.access_token;
        if (!accessToken) throw new Error('尚未登入');

        const res = await fetch(
          `/.netlify/functions/pdf-watermark?article_id=${encodeURIComponent(articleId)}&path=${encodeURIComponent(path)}`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (!res.ok) throw new Error(`载入失败（${res.status}）`);

        const bytes = await res.arrayBuffer();
        if (cancelled) return;

        const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
        if (cancelled) return;

        const container = containerRef.current;
        if (!container) return;
        container.innerHTML = '';

        // 依裝置寬度決定縮放比例，避免手機上文字小到看不清楚
        const targetWidth = Math.min(container.clientWidth || 900, 900);

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          if (cancelled) return;
          const page = await pdf.getPage(pageNum);
          const baseViewport = page.getViewport({ scale: 1 });
          const scale = targetWidth / baseViewport.width;
          const viewport = page.getViewport({ scale });

          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.display = 'block';
          canvas.style.width = '100%';
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
      <div className="pdf-fullscreen-body" ref={containerRef}>
        {status === 'loading' && <div className="pdf-fullscreen-status">载入中…</div>}
        {status === 'error' && <div className="pdf-fullscreen-status">载入失败，请稍后再试</div>}
      </div>
      {/* 全萤幕检视时，原本页面外层那份浮水印的 z-index 比这个疊层低、会被盖住，
          这里另外重新渲染一份、给更高的 z-index，确保浮水印保护强度不因为看 PDF 而消失。
          （PDF 內容本身也已经在伺服器端烧了专属浮水印，这层是双重保护） */}
      <Watermark text={watermarkText} active={true} zIndex={10000} />
    </div>
  );
}
