// netlify/functions/pdf-watermark.mjs
//
// 会员在前端打开某篇文章的 PDF 时，浏览器带着自己的登入令牌（Authorization header）
// 呼叫这支 Function，不再是把一个「任何人都能连到」的公开网址交给 Google Docs Viewer
// 那种第三方服务去抓（那正是之前浮水印被绕过的破口）。
//
// 流程：验证登入身份 → 确认这位会员真的对这篇文章的商品有有效权限 →
// 用 service_role key 从私有 bucket 抓出原始 PDF → 疊上浮水印 → 回传。
//
// 【本次修改】浮水印从「PDF 文字物件」改成「点阵图片疊加」：先用 Node 端的 canvas
// 画一张透明背景的浮水印图片，再用 pdf-lib 的 drawImage 疊到每一页上。
// 目的：文字物件在 PDF 编辑软体（例如 Adobe Acrobat）里可以直接选取、按删除键就移除，
// 操作跟删除文件里任何一段文字一样简单；改成图片疊加后，对方要移除就不能只是
// 「选取文字、按删除」，而要用影像编辑的方式去修补底层内容，操作难度跟耗时大幅提高。

import { PDFDocument } from 'pdf-lib';
import { createCanvas } from '@napi-rs/canvas';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WATERMARK_TEXT = 'Tradewithus888.com';

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

// 用 canvas 画一张透明背景的浮水印图片：中間密集斜紋文字 + 四个角落文字，
// 尺寸用相对比例（1000x1400，接近 A4 比例），之后疊到每一页时会依照该页实际尺寸缩放，
// 不用为每一页个别产生一张图（省运算），缩放不会影响清晰度太多，因为浮水印本身线条粗、不需要精细。
function buildWatermarkImage() {
  const W = 1000, H = 1400;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H); // 保持透明背景

  ctx.fillStyle = 'rgba(166,166,166,0.20)'; // 浅灰色，跟之前文字版本颜色/透明度一致
  ctx.font = 'bold 34px sans-serif';
  ctx.textBaseline = 'middle';

  // 中間密集斜紋，跟之前文字版本的间距逻辑对应换算成这张图片的比例尺
  for (let y = -40; y < H + 80; y += 170) {
    for (let x = -120; x < W + 120; x += 340) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((-28 * Math.PI) / 180);
      ctx.fillText(WATERMARK_TEXT, 0, 0);
      ctx.restore();
    }
  }

  // 四个角落文字，颜色更深一点、方便肉眼直接看清楚
  ctx.fillStyle = 'rgba(166,166,166,0.35)';
  ctx.font = 'bold 17px sans-serif';
  const margin = 26;
  const textWidth = ctx.measureText(WATERMARK_TEXT).width;
  ctx.fillText(WATERMARK_TEXT, margin, margin); // 左上
  ctx.fillText(WATERMARK_TEXT, W - margin - textWidth, margin); // 右上
  ctx.fillText(WATERMARK_TEXT, margin, H - margin); // 左下
  ctx.fillText(WATERMARK_TEXT, W - margin - textWidth, H - margin); // 右下

  return canvas.toBuffer('image/png');
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

  // 第三步：从私有 bucket 抓出原始 PDF
  const fileRes = await fetch(`${SUPABASE_URL}/storage/v1/object/private-pdfs/${path}`, {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  if (!fileRes.ok) return new Response('File not found', { status: 404 });
  const originalBytes = await fileRes.arrayBuffer();

  // 第四步：疊上点阵图片浮水印
  let watermarked;
  try {
    const pdfDoc = await PDFDocument.load(originalBytes);
    const pages = pdfDoc.getPages();

    const watermarkPngBytes = buildWatermarkImage();
    const watermarkImage = await pdfDoc.embedPng(watermarkPngBytes);

    for (const page of pages) {
      const { width, height } = page.getSize();
      // 图片本身是透明背景的 PNG，直接拉伸铺满整页即可，不用重複绘制多次
      page.drawImage(watermarkImage, {
        x: 0,
        y: 0,
        width,
        height,
      });
    }
    watermarked = await pdfDoc.save();
  } catch (err) {
    return new Response('Failed to process PDF: ' + err.message, { status: 500 });
  }

  return new Response(watermarked, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Cache-Control': 'no-store',
    },
  });
};
