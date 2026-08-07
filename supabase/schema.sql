-- ============================================================
-- StockVIP 正式版资料库 Schema
-- 使用方式：Supabase Dashboard -> SQL Editor -> 贴上整份执行
-- ============================================================

-- ---------- 资料表 ----------

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  wm_code text unique not null,
  balance numeric(12,2) not null default 0,
  role text not null default 'member' check (role in ('member','admin')),
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null check (type in ('course','subscription','shared')),
  image text,
  price numeric(12,2) not null default 0,
  price_quarter numeric(12,2),
  price_year numeric(12,2),
  desc text,
  body text,
  status text not null default 'active' check (status in ('active','off')),
  stock int not null default 0,
  sold int not null default 0,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.articles (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  title text not null,
  summary text,
  blocks jsonb not null default '[]',
  published_at date not null default current_date
);

create table if not exists public.permissions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  expires_at date,
  unique (member_id, product_id)
);

create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  duration text,
  price numeric(12,2) not null,
  purchased_at timestamptz not null default now()
);

create table if not exists public.wallet_tx (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric(12,2) not null,
  status text not null default 'success',
  tx_hash text,
  created_at timestamptz not null default now()
);

-- ---------- 新会员注册后自动建立 profile ----------

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, wm_code)
  values (new.id, new.email, lpad((floor(random()*999999))::text, 6, '0'));
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------- 余额购买：原子操作（扣款 + 写入权限 + 写入购买纪录一次搞定） ----------
-- SECURITY DEFINER：以 function owner 权限执行，绕过呼叫者的 RLS 限制，
-- 但函式内部用 auth.uid() 严格限定只能操作自己的资料，安全性由函式逻辑本身保证。

create or replace function public.purchase_with_balance(
  p_product_id uuid,
  p_duration text,
  p_price numeric
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_member_id uuid := auth.uid();
  v_balance numeric;
  v_product record;
  v_days int;
  v_existing_expiry date;
  v_new_expiry date;
begin
  if v_member_id is null then
    raise exception '尚未登入';
  end if;

  select balance into v_balance from public.profiles where id = v_member_id for update;
  if v_balance < p_price then
    raise exception '余额不足';
  end if;

  select * into v_product from public.products where id = p_product_id for update;
  if v_product is null or v_product.status = 'off' then
    raise exception '商品不存在或已下架';
  end if;

  v_days := case p_duration when 'month' then 30 when 'quarter' then 90 when 'year' then 365 else null end;

  select expires_at into v_existing_expiry from public.permissions
    where member_id = v_member_id and product_id = p_product_id;

  if v_product.type = 'course' then
    v_new_expiry := null; -- 永久
  elsif v_days is null then
    v_new_expiry := null;
  else
    v_new_expiry := greatest(coalesce(v_existing_expiry, current_date), current_date) + v_days;
  end if;

  update public.profiles set balance = balance - p_price where id = v_member_id;

  insert into public.permissions (member_id, product_id, expires_at)
    values (v_member_id, p_product_id, v_new_expiry)
    on conflict (member_id, product_id) do update set expires_at = excluded.expires_at;

  insert into public.purchases (member_id, product_id, duration, price)
    values (v_member_id, p_product_id, p_duration, p_price);

  update public.products set sold = sold + 1, stock = greatest(stock - 1, 0) where id = p_product_id;

  return jsonb_build_object('ok', true, 'expires_at', v_new_expiry);
end;
$$;

-- ---------- Row Level Security ----------

alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.articles enable row level security;
alter table public.permissions enable row level security;
alter table public.purchases enable row level security;
alter table public.wallet_tx enable row level security;

-- profiles
create policy "profile self or admin read" on public.profiles for select using (
  id = auth.uid() or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
);
create policy "profile self update" on public.profiles for update using (id = auth.uid());
create policy "profile admin update" on public.profiles for update using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
);

-- products：所有人（含未登入）可读；只有 admin 可写
create policy "products readable by all" on public.products for select using (true);
create policy "products admin write" on public.products for insert with check (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
);
create policy "products admin update" on public.products for update using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
);
create policy "products admin delete" on public.products for delete using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
);

-- articles：metadata 所有人可读（前端依 permissions 决定是否显示内文），admin 可写
create policy "articles readable by all" on public.articles for select using (true);
create policy "articles admin insert" on public.articles for insert with check (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
);
create policy "articles admin update" on public.articles for update using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
);
create policy "articles admin delete" on public.articles for delete using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
);

-- permissions：会员只能看自己的；写入只能透过 admin 或上面的 purchase_with_balance 函式（security definer 绕过 RLS）
create policy "perm self or admin read" on public.permissions for select using (
  member_id = auth.uid() or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
);
create policy "perm admin write" on public.permissions for insert with check (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
);
create policy "perm admin update" on public.permissions for update using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
);
create policy "perm admin delete" on public.permissions for delete using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
);

-- purchases：会员只能看自己的
create policy "purchases self or admin read" on public.purchases for select using (
  member_id = auth.uid() or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
);

-- wallet_tx：会员只能看自己的；写入交给 admin（手动核实充值）或未来的 Edge Function（用 service_role 绕过 RLS）
create policy "wallet self or admin read" on public.wallet_tx for select using (
  member_id = auth.uid() or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
);
create policy "wallet admin write" on public.wallet_tx for insert with check (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
);

-- ---------- Storage：商品图片 bucket（请同时在 Dashboard -> Storage 建立一个 public bucket 叫 product-images） ----------
-- 这段留做参考：bucket 本身要在 Dashboard 手动建立（或用 supabase-js 的 storage.createBucket），
-- 这里只示范该 bucket 的存取政策，实际执行前请确认 bucket 名称一致。

-- insert into storage.buckets (id, name, public) values ('product-images','product-images', true)
--   on conflict (id) do nothing;

-- ---------- 把第一个管理员设起来 ----------
-- 先用一般注册流程注册一个帐号，登入后到 SQL Editor 执行下面这行（换成你的 email）：
-- update public.profiles set role = 'admin' where email = 'your-admin-email@example.com';
