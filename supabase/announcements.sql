create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  content text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.announcements enable row level security;

drop policy if exists "announcements readable by all" on public.announcements;
create policy "announcements readable by all" on public.announcements for select using (true);

drop policy if exists "announcements admin write" on public.announcements;
create policy "announcements admin write" on public.announcements for all using (public.is_admin());
