create table if not exists public.telegram_sync_lock (
  id int primary key default 1,
  locked boolean not null default false,
  locked_at timestamptz,
  constraint telegram_sync_lock_singleton check (id = 1)
);
insert into public.telegram_sync_lock (id, locked) values (1, false) on conflict (id) do nothing;

alter table public.telegram_sync_lock enable row level security;
drop policy if exists "telegram_sync_lock service only" on public.telegram_sync_lock;
create policy "telegram_sync_lock service only" on public.telegram_sync_lock for all using (public.is_admin());
-- 注意：这张表实际上是被 service_role key 存取（Netlify Function 用），
-- service_role 本来就绕过所有 RLS，这条 policy 只是给你自己在後台用 admin 身份查看用。

-- 如果曾经卡在 locked=true 出不来（例如 Netlify Function 中途被杀掉没释放锁），
-- 手动执行这行强制解锁：
-- update public.telegram_sync_lock set locked = false where id = 1;
