-- ============================================================
-- 已读标记 + 收藏功能
-- ============================================================

create table if not exists public.article_reads (
  member_id uuid not null references public.profiles(id) on delete cascade,
  article_id uuid not null references public.articles(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (member_id, article_id)
);
alter table public.article_reads enable row level security;
drop policy if exists "article_reads self" on public.article_reads;
create policy "article_reads self" on public.article_reads for all using (member_id = auth.uid());

create table if not exists public.article_favorites (
  member_id uuid not null references public.profiles(id) on delete cascade,
  article_id uuid not null references public.articles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (member_id, article_id)
);
alter table public.article_favorites enable row level security;
drop policy if exists "article_favorites self" on public.article_favorites;
create policy "article_favorites self" on public.article_favorites for all using (member_id = auth.uid());
