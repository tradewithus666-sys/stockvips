alter table public.payment_intents alter column product_id drop not null;
alter table public.payment_intents add column if not exists kind text not null default 'purchase' check (kind in ('purchase','recharge'));

create or replace function public.create_recharge_intent(p_amount numeric, p_address text)
returns public.payment_intents
language plpgsql
security definer
as $$
declare
  v_row public.payment_intents;
begin
  insert into public.payment_intents (member_id, product_id, duration, amount, address, kind)
  values (auth.uid(), null, 'recharge', p_amount, p_address, 'recharge')
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.check_and_complete_usdt_payment(p_intent_id uuid)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_intent public.payment_intents;
  v_product record;
  v_resp extensions.http_response;
  v_body jsonb;
  v_tx jsonb;
  v_days int;
  v_existing_expiry date;
  v_new_expiry date;
  BSCSCAN_API_KEY text := '9XC2KC5Q9KIFNTQ5IA2SJ8NVHR6TSNTQAZ';
  USDT_CONTRACT text := '0x55d398326f99059fF775485246999027B3197955';
begin
  select * into v_intent from public.payment_intents where id = p_intent_id and member_id = auth.uid();
  if v_intent is null then return jsonb_build_object('status', 'not_found'); end if;
  if v_intent.status = 'paid' then return jsonb_build_object('status', 'paid'); end if;
  if v_intent.expires_at < now() then
    update public.payment_intents set status = 'expired' where id = p_intent_id;
    return jsonb_build_object('status', 'expired');
  end if;

  select * into v_resp from extensions.http_get(
    format('https://api.etherscan.io/v2/api?chainid=56&module=account&action=tokentx&contractaddress=%s&address=%s&sort=desc&apikey=%s',
      USDT_CONTRACT, v_intent.address, BSCSCAN_API_KEY)
  );
  v_body := v_resp.content::jsonb;

  for v_tx in select * from jsonb_array_elements(coalesce(v_body->'result', '[]'::jsonb))
  loop
    if lower(v_tx->>'to') = lower(v_intent.address)
       and (v_tx->>'value')::numeric / 1e18 >= v_intent.amount * 0.99
       and to_timestamp((v_tx->>'timeStamp')::bigint) >= v_intent.created_at
    then
      if v_intent.kind = 'recharge' then
        update public.profiles set balance = balance + v_intent.amount where id = v_intent.member_id;
        insert into public.wallet_tx (member_id, amount, status, tx_hash) values (v_intent.member_id, v_intent.amount, 'success', v_tx->>'hash');
      else
        select * into v_product from public.products where id = v_intent.product_id;
        v_days := case v_intent.duration when 'month' then 30 when 'quarter' then 90 when 'year' then 365 else null end;
        select expires_at into v_existing_expiry from public.permissions
          where member_id = v_intent.member_id and product_id = v_intent.product_id;
        if v_product.type = 'course' or v_days is null then
          v_new_expiry := null;
        else
          v_new_expiry := greatest(coalesce(v_existing_expiry, current_date), current_date) + v_days;
        end if;

        insert into public.permissions (member_id, product_id, expires_at)
          values (v_intent.member_id, v_intent.product_id, v_new_expiry)
          on conflict (member_id, product_id) do update set expires_at = excluded.expires_at;
        insert into public.purchases (member_id, product_id, duration, price)
          values (v_intent.member_id, v_intent.product_id, v_intent.duration, v_intent.amount);
        update public.products set sold = sold + 1 where id = v_intent.product_id;
      end if;

      update public.payment_intents set status = 'paid', tx_hash = v_tx->>'hash' where id = p_intent_id;
      return jsonb_build_object('status', 'paid');
    end if;
  end loop;

  return jsonb_build_object('status', 'pending');
end;
$$;
