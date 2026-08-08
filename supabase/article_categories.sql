create table if not exists public.article_categories (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.articles add column if not exists category_id uuid references public.article_categories(id) on delete set null;

alter table public.article_categories enable row level security;

drop policy if exists "categories readable by all" on public.article_categories;
create policy "categories readable by all" on public.article_categories for select using (true);

drop policy if exists "categories admin write" on public.article_categories;
create policy "categories admin write" on public.article_categories for all using (public.is_admin());
