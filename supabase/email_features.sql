-- supabase/email_features.sql
-- 續費提醒 + 群發電郵 所需的資料表。全部是「新增」，不會改動或刪除你現有的資料。
-- 在 Supabase → SQL Editor 貼上整份，按 Run 即可。重複執行也安全。

-- 0. 判斷某人是否為管理員的小函式（security definer：不受 profiles 的 RLS 影響）
--    名稱刻意跟你現有的 is_admin() 不同，避免互相覆蓋。
create or replace function public.email_is_admin(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = p_uid and role = 'admin');
$$;

-- 1. 會員是否已取消「群發推廣郵件」（預設 false = 仍會收到）
alter table public.profiles
  add column if not exists email_broadcast_optout boolean not null default false;

-- 2. 續費提醒紀錄：記錄「哪一筆權限、哪個到期日」已經提醒過，避免重複寄
create table if not exists public.renewal_reminder_log (
  permission_id uuid not null references public.permissions(id) on delete cascade,
  expires_at    date not null,
  sent_at       timestamptz not null default now(),
  primary key (permission_id, expires_at)
);
alter table public.renewal_reminder_log enable row level security;
-- 不建立任何 policy = 前端完全讀寫不到，只有後端 function（service role）可以用

-- 3. 群發紀錄：後台頁面用來顯示發送進度與歷史
create table if not exists public.broadcast_log (
  id          uuid primary key default gen_random_uuid(),
  subject     text not null,
  mode        text not null default 'send' check (mode in ('send','test')),
  status      text not null default 'sending' check (status in ('sending','done','partial','failed')),
  total       int  not null default 0,
  sent        int  not null default 0,
  failed      int  not null default 0,
  error       text,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  finished_at timestamptz
);
alter table public.broadcast_log enable row level security;

drop policy if exists "broadcast_log admin read" on public.broadcast_log;
create policy "broadcast_log admin read" on public.broadcast_log
  for select using (public.email_is_admin(auth.uid()));
-- 寫入只由後端 function（service role）進行，所以不開放前端寫入
