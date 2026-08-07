import { supabase } from '../supabaseClient';

// Supabase Storage 的 key 不接受空格、中文字元、括号等符号（原始档名直接拿来当路径常常会报
// "Invalid key" 错误）。这里一律换成「时间戳 + 随机码 + 原始副档名」，完全避开这个问题。
export async function uploadImage(file, folder = 'uploads') {
  const extMatch = /\.[a-zA-Z0-9]+$/.exec(file.name);
  const ext = extMatch ? extMatch[0].toLowerCase() : (file.type === 'image/png' ? '.png' : '.jpg');
  const safeName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
  const path = `${folder}/${safeName}`;

  const { error } = await supabase.storage.from('product-images').upload(path, file, {
    cacheControl: '3600',
    upsert: false,
  });
  if (error) throw error;

  const { data } = supabase.storage.from('product-images').getPublicUrl(path);
  return data.publicUrl;
}
