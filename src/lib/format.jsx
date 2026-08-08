// 文章只有「发布日期」栏位（date，没有时间），这里改用 created_at（写入时间，精确到分钟）组合显示，
// 格式："2026-08-07 16:00"。如果因为某些旧资料没有 created_at，就退回只显示日期。
export function formatPublishedAt(article) {
  if (!article?.created_at) return article?.published_at || '';
  const d = new Date(article.created_at);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
