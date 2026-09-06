// netlify/functions/pdf-watermark.mjs
//
// 不燒浮水印，PDF 內容維持原始檔案不做任何處理。
// 但仍然保留登入驗證 + 權限檢查這兩層——只有真正有效的會員才能看到內容，
// 也不會把「任何人都能連到」的公開網址交給第三方服務去抓（那正是之前浮水印被繞過的破口，
// 現在雖然不燒浮水印了，但這層「不暴露公開網址」的保護還是有意義，繼續保留）。
//
// 流程：验证登入身份 → 确认这位会员真的对这篇文章的商品有有效权限 →
// 用 service_role key 从私有 bucket 抓出原始 PDF，直接回传。

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function sbFetch(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`Supabase ${path} failed: ${res.status}`);
  return res.json();
}

async function getUserFromToken(accessToken) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  return res.json();
}

export default async (req) => {
  const url = new URL(req.url);
  const articleId = url.searchParams.get('article_id');
  const path = url.searchParams.get('path');
  const authHeader = req.headers.get('authorization') || '';
  const accessToken = authHeader.replace(/^Bearer\s+/i, '');

  if (!articleId || !path || !accessToken) {
    return new Response('Bad request', { status: 400 });
  }

  // 第一步：确认这个人真的有登入、令牌有效
  const user = await getUserFromToken(accessToken);
  if (!user?.id) {
    return new Response('Unauthorized', { status: 401 });
  }

  // 第二步：这篇文章属于哪个商品，确认这位会员对该商品有未过期的权限
  let productId;
  try {
    const articles = await sbFetch(`articles?id=eq.${articleId}&select=product_id`);
    productId = articles?.[0]?.product_id;
  } catch {
    return new Response('Not found', { status: 404 });
  }
  if (!productId) return new Response('Not found', { status: 404 });

  const today = new Date().toISOString().slice(0, 10);
  let hasValidPerm = false;
  try {
    const perms = await sbFetch(
      `permissions?member_id=eq.${user.id}&product_id=eq.${productId}&select=expires_at`
    );
    hasValidPerm = (perms || []).some((p) => !p.expires_at || p.expires_at >= today);
  } catch {
    hasValidPerm = false;
  }
  if (!hasValidPerm) {
    return new Response('Forbidden', { status: 403 });
  }

  // 第三步：从私有 bucket 抓出原始 PDF，直接回传，不做任何處理
  const fileRes = await fetch(`${SUPABASE_URL}/storage/v1/object/private-pdfs/${path}`, {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  if (!fileRes.ok) return new Response('File not found', { status: 404 });
  const originalBytes = await fileRes.arrayBuffer();

  return new Response(originalBytes, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Cache-Control': 'no-store',
    },
  });
};
