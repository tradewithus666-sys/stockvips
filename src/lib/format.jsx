// 文章只有「发布日期」栏位（date，没有时间），这里改用 created_at（写入时间，精确到分钟）组合显示，
// 格式："2026-08-07 16:00"。如果因为某些旧资料没有 created_at，就退回只显示日期。
export function formatPublishedAt(article) {
  if (!article?.created_at) return article?.published_at || '';
  const d = new Date(article.created_at);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 只要日期，不要时间（会员中心用）
export function formatPublishedDateOnly(article) {
  if (!article?.created_at) return article?.published_at || '';
  const d = new Date(article.created_at);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// 把 YouTube／Vimeo／Google Drive 网址转成可以内嵌播放的网址
export function toEmbedUrl(url) {
  if (!url) return null;
  const u = url.trim();
  const yt = u.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{6,})/);
  // playsinline=1：告诉 iOS Safari 影片播放时留在网页画面内，不要自动跳出去用系统原生播放器
  // （iOS 一旦接管播放，我们叠在上面的浮水印/遮挡层就完全失效，因为已经不在网页 DOM 范围内了）
  if (yt) return `https://www.youtube.com/embed/${yt[1]}?playsinline=1&rel=0`;
  const vimeo = u.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}?playsinline=1`;
  // Google Drive：支援 /file/d/FILE_ID/view 或 open?id=FILE_ID 这两种常见网址格式，
  // 转成 Drive 官方的内嵌预览网址（会跑出 Drive 自己的播放器，直接在页面里播放）。
  // 注意：这个档案要先在 Drive 里设成「知道连结的任何人」都能查看，不然会员打开会看到「无权限」。
  const driveFile = u.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (driveFile) return `https://drive.google.com/file/d/${driveFile[1]}/preview`;
  const driveOpen = u.match(/drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/);
  if (driveOpen) return `https://drive.google.com/file/d/${driveOpen[1]}/preview`;
  return null;
}

// 把纯文字里的网址自动转成可点击连结，新分页打开
const URL_SPLIT_RE = /(https?:\/\/[^\s]+)/g;
export function linkify(text) {
  if (!text) return text;
  const parts = String(text).split(URL_SPLIT_RE);
  return parts.map((part, i) =>
    /^https?:\/\//i.test(part)
      ? <a key={i} href={part} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--amber)', textDecoration: 'underline', wordBreak: 'break-all' }}>{part}</a>
      : part
  );
}

// USDT 兑 HKD 的固定汇率提示（USDT 约等于 1 美元，联系汇率下约 7.8 港币），
// 只是给会员付款当下的参考，不是即时汇率，如需更精确可以之后接汇率 API。
export const USDT_TO_HKD_RATE = 7.8;
export function usdtToHkd(amount) {
  return (Number(amount) * USDT_TO_HKD_RATE).toFixed(0);
}

// 富文本编辑器存的是 HTML 字串，会员直接在里面打纯文字网址（没有用「插入连结」功能）
// 时不会自动变成 <a> 标签。这里在渲染前扫过 HTML，把还是纯文字型态的网址转成可点击连结，
// 用 DOMParser 走过所有文字节点处理，不会误伤本来就是 <a>/<img> 标签属性里的网址。
const PLAIN_URL_RE = /(https?:\/\/[^\s<]+)/g;
export function linkifyHtml(html) {
  if (!html) return html;
  if (typeof window === 'undefined' || !window.DOMParser) return html;
  try {
    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
    const root = doc.body.firstChild;
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const targets = [];
    let node;
    while ((node = walker.nextNode())) {
      if (node.parentElement && node.parentElement.closest('a')) continue; // 已经在连结里面就跳过
      if (PLAIN_URL_RE.test(node.nodeValue)) targets.push(node);
      PLAIN_URL_RE.lastIndex = 0;
    }
    targets.forEach((textNode) => {
      const parts = textNode.nodeValue.split(PLAIN_URL_RE);
      const frag = doc.createDocumentFragment();
      parts.forEach((part) => {
        if (/^https?:\/\//i.test(part)) {
          const a = doc.createElement('a');
          a.href = part;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.textContent = part;
          frag.appendChild(a);
        } else if (part) {
          frag.appendChild(doc.createTextNode(part));
        }
      });
      textNode.parentNode.replaceChild(frag, textNode);
    });
    return root.innerHTML;
  } catch (err) {
    return html; // 万一解析失败，退回原本内容，不要让页面整个坏掉
  }
}
