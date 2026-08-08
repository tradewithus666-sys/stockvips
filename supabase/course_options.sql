alter table public.products add column if not exists options jsonb not null default '[]';
alter table public.purchases add column if not exists variant text;

create or replace function public.purchase_with_balance(
  p_product_id uuid,
  p_duration text,
  p_price numeric,
  p_variant text default null
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

  insert into public.purchases (member_id, product_id, duration, price, variant)
    values (v_member_id, p_product_id, p_duration, p_price, p_variant);

  update public.products set sold = sold + 1, stock = greatest(stock - 1, 0) where id = p_product_id;

  return jsonb_build_object('ok', true, 'expires_at', v_new_expiry);
end;
$$;

