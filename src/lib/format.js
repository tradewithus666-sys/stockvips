// 文章只有「发布日期」栏位（date，没有时间），这里改用 created_at（写入时间，精确到分钟）组合显示，
// 格式："2026-08-07 16:00"。如果因为某些旧资料没有 created_at，就退回只显示日期。
export function formatPublishedAt(article) {
  if (!article?.created_at) return article?.published_at || '';
  const d = new Date(article.created_at);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
