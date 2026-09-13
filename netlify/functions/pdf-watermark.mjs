// netlify/functions/pdf-watermark.mjs
//
// 会员在前端打开某篇文章的 PDF 时，浏览器带着自己的登入令牌（Authorization header）
// 呼叫这支 Function，不再是把一个「任何人都能连到」的公开网址交给 Google Docs Viewer
// 那种第三方服务去抓（那正是之前浮水印被绕过的破口）。
//
// 流程：验证登入身份 → 确认这位会员真的对这篇文章的商品有有效权限 →
// 用 service_role key 从私有 bucket 抓出原始 PDF → 疊上浮水印 → 回传。
//
// 浮水印是「点阵图片疊加」（不是 PDF 文字物件）：先用 Node 端的 canvas 画一张透明背景的
// 浮水印图片，再用 pdf-lib 的 drawImage 疊到每一页上。文字物件在 PDF 编辑软体（例如
// Adobe Acrobat）里可以直接选取、按删除键就移除；改成图片疊加后，对方要移除就不能只是
// 「选取文字、按删除」，而要用影像编辑的方式去修补底层内容，操作难度跟耗时大幅提高。
//
// 【重要】字型明确打包 + 註冊，不依赖执行环境本身有没有装系统字型——Netlify 的
// serverless 容器通常是最小化环境，不保证有任何系统字型，若用 'sans-serif' 这种
// 依赖系统字型查找的写法，字型找不到时 canvas 不会报错，而是「安静地不画出文字」，
// 导致浮水印图片变成完全透明的空白图，疊上去后完全看不到任何浮水印痕迹。

import { PDFDocument } from 'pdf-lib';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const funcDir = dirname(fileURLToPath(import.meta.url));
const FONT_FAMILY = 'WatermarkFont';
GlobalFonts.registerFromPath(join(funcDir, 'watermark-font.ttf'), FONT_FAMILY);

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
// 尺寸用相对比例（1000x1400，接近 A4 比例），之后疊到每一页时会依照该页实际尺寸缩放。
function buildWatermarkImage() {
  const W = 1000, H = 1400;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H); // 保持透明背景

  ctx.fillStyle = 'rgba(166,166,166,0.20)'; // 浅灰色
  ctx.font = `bold 34px ${FONT_FAMILY}`; // 明确指定我们自己注册的字型，不依赖环境系统字型
  ctx.textBaseline = 'middle';

  for (let y = -40; y < H + 80; y += 170) {
    for (let x = -120; x < W + 120; x += 340) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((-28 * Math.PI) / 180);
      ctx.fillText(WATERMARK_TEXT, 0, 0);
      ctx.restore();
    }
  }

  ctx.fillStyle = 'rgba(166,166,166,0.35)';
  ctx.font = `bold 17px ${FONT_FAMILY}`;
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

  const user = await getUserFromToken(accessToken);
  if (!user?.id) {
    return new Response('Unauthorized', { status: 401 });
  }

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

  const fileRes = await fetch(`${SUPABASE_URL}/storage/v1/object/private-pdfs/${path}`, {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  if (!fileRes.ok) return new Response('File not found', { status: 404 });
  const originalBytes = await fileRes.arrayBuffer();

  let watermarked;
  try {
    const pdfDoc = await PDFDocument.load(originalBytes);
    const pages = pdfDoc.getPages();

    const watermarkPngBytes = buildWatermarkImage();
    const watermarkImage = await pdfDoc.embedPng(watermarkPngBytes);

    for (const page of pages) {
      const { width, height } = page.getSize();
      page.drawImage(watermarkImage, { x: 0, y: 0, width, height });
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
