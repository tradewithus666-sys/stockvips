create table if not exists public.help_content (
  id int primary key default 1,
  body text not null default '',
  updated_at timestamptz not null default now(),
  constraint help_content_singleton check (id = 1)
);

insert into public.help_content (id, body) values (1, '') on conflict (id) do nothing;

alter table public.help_content enable row level security;

drop policy if exists "help_content readable by all" on public.help_content;
create policy "help_content readable by all" on public.help_content for select using (true);

drop policy if exists "help_content admin write" on public.help_content;
create policy "help_content admin write" on public.help_content for update using (public.is_admin());
