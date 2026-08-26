// netlify/functions/pdf-watermark.mjs
//
// 会员在前端打开某篇文章的 PDF 时，浏览器带着自己的登入令牌（Authorization header）
// 呼叫这支 Function，不再是把一个「任何人都能连到」的公开网址交给 Google Docs Viewer
// 那种第三方服务去抓（那正是之前浮水印被绕过的破口）。
//
// 流程：验证登入身份 → 确认这位会员真的对这篇文章的商品有有效权限 →
// 用 service_role key 从私有 bucket 抓出原始 PDF（一般人、甚至登入的会员都读不到这个 bucket）→
// 用 pdf-lib 把这位会员的 email 即时烧进 PDF 每一页 → 回传这份「专属这次请求」的浮水印版本。
//
// 因为每次都是即时产生、而且回应设成 no-store，不会有任何一份「乾净、共用」的檔案存在，
// 就算这次的回应被存下来外流，浮水印本身就直接指出是哪个帐号流出的。

import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';

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

  // 第三步：从私有 bucket 抓出原始 PDF（一般人、甚至登入的会员都没有权限直接读这个 bucket，
  // 只有这里用 service_role key 才能读到）
  const fileRes = await fetch(`${SUPABASE_URL}/storage/v1/object/private-pdfs/${path}`, {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  if (!fileRes.ok) return new Response('File not found', { status: 404 });
  const originalBytes = await fileRes.arrayBuffer();

  // 第四步：即时把这位会员的追蹤資訊烧进 PDF 每一页
  let watermarked;
  try {
    const pdfDoc = await PDFDocument.load(originalBytes);
    const pages = pdfDoc.getPages();
    const stamp = `${user.email} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
    const PROMO_TEXT = 'Tradewithus888.com (FREE TRIAL)'; // 【本次修改】改用纯英文，不用额外嵌入中文字型
    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);

    for (const page of pages) {
      const { width, height } = page.getSize();

      // 原本的密集斜纹会员追蹤浮水印，维持不变
      for (let y = -20; y < height + 40; y += 85) {
        for (let x = -60; x < width + 60; x += 210) {
          page.drawText(stamp, {
            x, y,
            size: 10,
            rotate: degrees(-28),
            color: rgb(0.85, 0.1, 0.5),
            opacity: 0.14,
          });
        }
      }

      // 【本次新增】四个角落各加一次固定宣传文字，字体稍大、角度水平，方便肉眼直接看清楚
      const margin = 14;
      const promoSize = 9;
      const promoWidth = helvetica.widthOfTextAtSize(PROMO_TEXT, promoSize); // 精准测量文字实际宽度，右侧对齐才不会跑掉
      const corners = [
        { x: margin, y: height - margin - promoSize },                 // 左上
        { x: width - margin - promoWidth, y: height - margin - promoSize }, // 右上
        { x: margin, y: margin },                                       // 左下
        { x: width - margin - promoWidth, y: margin },                  // 右下
      ];
      for (const { x, y } of corners) {
        page.drawText(PROMO_TEXT, {
          x, y,
          size: promoSize,
          font: helvetica,
          color: rgb(0.85, 0.1, 0.5),
          opacity: 0.35,
        });
      }
    }
    watermarked = await pdfDoc.save();
  } catch (err) {
    return new Response('Failed to process PDF: ' + err.message, { status: 500 });
  }

  return new Response(watermarked, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Cache-Control': 'no-store', // 每次都是即时产生的专属版本，不能被中间任何一层快取存下来共用
    },
  });
};