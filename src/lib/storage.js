import { supabase } from '../supabaseClient';

// 【本次优化】上传前先在浏览器端把图片压缩、限制最大尺寸，大幅降低儲存体积跟之后
// 会员浏览时消耗的流量（Supabase 的 Cached Egress 额度主要就是被这些图片读取吃掉的）。
// 手机拍的照片动辄 3-8MB，压缩后通常能降到几百 KB，画质在网页显示上几乎看不出差异。
const MAX_DIMENSION = 1600;   // 最长边超过这个像素就等比例缩小，一般网页显示绰绰有余
const JPEG_QUALITY = 0.82;    // 压缩品质，0.8~0.85 是画质与档案大小的甜蜜点

async function compressImage(file) {
  // 非图片档案（理论上不会发生，但保险起见）或浏览器不支援时，直接跳过压缩、原图上传
  if (!file.type.startsWith('image/')) return file;

  try {
    const bitmap = await createImageBitmap(file);
    let { width, height } = bitmap;

    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
      const scale = MAX_DIMENSION / Math.max(width, height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, width, height);

    // GIF 保留原档（避免破坏动画），其他一律压缩转成 JPEG（去背需求的 PNG 例外保留透明度）
    const keepPng = file.type === 'image/png';
    const mimeType = keepPng ? 'image/png' : 'image/jpeg';
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, mimeType, JPEG_QUALITY));

    if (!blob || blob.size >= file.size) return file; // 压缩后反而更大就用回原档
    return new File([blob], file.name, { type: mimeType });
  } catch {
    // 压缩过程任何异常（例如 GIF 动图、不支援的格式）都不要卡住上传，直接用原档
    return file;
  }
}

// Supabase Storage 的 key 不接受空格、中文字元、括号等符号（原始档名直接拿来当路径常常会报
// "Invalid key" 错误）。这里一律换成「时间戳 + 随机码 + 原始副档名」，完全避开这个问题。
export async function uploadImage(file, folder = 'uploads') {
  const compressed = file.type === 'image/gif' ? file : await compressImage(file);

  const extMatch = /\.[a-zA-Z0-9]+$/.exec(compressed.name);
  const ext = compressed.type === 'image/jpeg' ? '.jpg'
    : (extMatch ? extMatch[0].toLowerCase() : (compressed.type === 'image/png' ? '.png' : '.jpg'));
  const safeName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
  const path = `${folder}/${safeName}`;

  const { error } = await supabase.storage.from('product-images').upload(path, compressed, {
    cacheControl: '3600',
    upsert: false,
  });
  if (error) throw error;

  const { data } = supabase.storage.from('product-images').getPublicUrl(path);
  return data.publicUrl;
}

// 【本次新增】PDF 专用上传：存进私有的 private-pdfs bucket，不用 getPublicUrl
// （这个 bucket 没有开放任何公开读取，任何人（含未登入者）直接打这个网址都读不到东西，
// 只有我们自己的 Netlify Function 用 service_role key 才能读，确保原始檔案不会被绕过浮水印直接下载）。
// 回传的是「storage 内部路径」，不是网址——真正显示时要透过 pdf-watermark 这个 Function 即时处理。
export async function uploadPdf(file, folder = 'articles') {
  const safeName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.pdf`;
  const path = `${folder}/${safeName}`;

  const { error } = await supabase.storage.from('private-pdfs').upload(path, file, {
    cacheControl: '3600',
    upsert: false,
  });
  if (error) throw error;

  return path; // 注意：这里回传的是路径，不是可以直接打开的网址
}