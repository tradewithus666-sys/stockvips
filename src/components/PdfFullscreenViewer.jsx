import { useEffect, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';

/**
 * 全萤幕 PDF 检视器。不再用 Google Docs Viewer（那需要一个任何人都能连到的公开网址，
 * 这正是之前浮水印被绕过、原始檔案被直接下载走的破口）。
 * 改成：带着会员自己的登入令牌，去问专门的 Netlify Function 要「这次请求专属」的
 * 浮水印版本 PDF 位元组，抓到之后转成本机限定的 Blob URL，交给瀏覽器原生的 PDF 检视引擎显示。
 *
 * 【本次修改】原本用 pdfjs-dist 自己在 JS 里跑一整套 PDF 解析/渲染引擎，
 * 在部分較舊版本的 iOS WebKit 上有相容性问题（连 disableWorker 備援模式都可能救不回来，
 * 尤其手机没办法升级系统的会员，永远卡在同一个 bug）。改成完全交给瀏覽器自己內建的
 * PDF 检视能力（几乎所有瀏覽器、包括很舊的版本都支援这个最基本的功能），相容性好非常多。
 *
 * Blob URL 只存在于使用者自己瀏覽器的記憶體里，不是公開網址，複製這個網址給別人、
 * 別人的瀏覽器打開會是無效的，不會造成之前「公開網址被繞過浮水印直接下載」的破口。
 */
export default function PdfFullscreenViewer({ articleId, path, watermarkText, onClose }) {
  const [status, setStatus] = useState('loading'); // loading | error | ready
  const [blobUrl, setBlobUrl] = useState(null);
  const blobUrlRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setStatus('loading');
      try {
        // 改用 getSession() 前先确认/刷新一次，避免因为登入令牌恰好过期
        // 导致 Function 那边验证身份失败（401）。
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

        const blob = await res.blob();
        if (cancelled) return;

        const url = URL.createObjectURL(blob);
        blobUrlRef.current = url;
        setBlobUrl(url);
        setStatus('ready');
      } catch (err) {
        if (!cancelled) setStatus('error');
      }
    }

    load();
    return () => {
      cancelled = true;
      // 離開檢視器時釋放這個 Blob URL，避免記憶體累積
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
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
        {status === 'ready' && blobUrl && (
          <iframe className="pdf-native-iframe" src={blobUrl} title="pdf-viewer" />
        )}
      </div>
    </div>
  );
}
