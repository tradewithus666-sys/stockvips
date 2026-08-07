import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // 提早在 console 报错，避免后面一堆莫名其妙的 network error 让人猜半天
  // eslint-disable-next-line no-console
  console.error(
    '[supabaseClient] 缺少 VITE_SUPABASE_URL 或 VITE_SUPABASE_ANON_KEY，请检查 .env 是否已建立（可参考 .env.example）'
  );
}

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});
