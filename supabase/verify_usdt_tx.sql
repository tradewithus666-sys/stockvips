-- ============================================================
-- 改用「验证单一交易雜湊」取代不稳定的 eth_getLogs 扫描。
-- eth_getTransactionReceipt 比 eth_getLogs 稳定很多（免费节点常对 getLogs 限流/超时）。
-- ============================================================

create or replace function public.verify_usdt_tx(p_intent_id uuid, p_tx_hash text)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_intent public.payment_intents;
  v_product record;
  v_resp extensions.http_response;
  v_result jsonb;
  v_log jsonb;
  v_amount numeric;
  v_days int;
  v_existing_expiry date;
  v_new_expiry date;
  USDT_CONTRACT text := '0x55d398326f99059fF775485246999027B3197955';
  TRANSFER_TOPIC text := '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
  RPC_URL text := 'https://bsc-dataseed.binance.org/';
  v_to_topic text;
begin
  select * into v_intent from public.payment_intents where id = p_intent_id and member_id = auth.uid();
  if v_intent is null then return jsonb_build_object('status', 'not_found'); end if;
  if v_intent.status = 'paid' then return jsonb_build_object('status', 'paid'); end if;
  if v_intent.expires_at < now() then
    update public.payment_intents set status = 'expired' where id = p_intent_id;
    return jsonb_build_object('status', 'expired');
  end if;
  if p_tx_hash !~ '^0x[0-9a-fA-F]{64}$' then
    return jsonb_build_object('status', 'invalid_hash');
  end if;

  select * into v_resp from extensions.http_post(
    RPC_URL,
    jsonb_build_object('jsonrpc','2.0','id',1,'method','eth_getTransactionReceipt','params', jsonb_build_array(p_tx_hash))::text,
    'application/json'
  );
  v_result := (v_resp.content::jsonb)->'result';
  if v_result is null or v_result = 'null'::jsonb then
    return jsonb_build_object('status', 'tx_not_found');
  end if;
  if (v_result->>'status') != '0x1' then
    return jsonb_build_object('status', 'tx_failed');
  end if;

  v_to_topic := '0x' || lpad(lower(regexp_replace(v_intent.address, '^0x', '')), 64, '0');

  for v_log in select * from jsonb_array_elements(coalesce(v_result->'logs', '[]'::jsonb))
  loop
    if lower(v_log->>'address') = lower(USDT_CONTRACT)
       and (v_log->'topics'->>0) = TRANSFER_TOPIC
       and lower(v_log->'topics'->>2) = v_to_topic
    then
      v_amount := public.hex_to_numeric(v_log->>'data') / 1e18;
      if v_amount >= v_intent.amount * 0.99 then
        if v_intent.kind = 'recharge' then
          update public.profiles set balance = balance + v_intent.amount where id = v_intent.member_id;
          insert into public.wallet_tx (member_id, amount, status, tx_hash) values (v_intent.member_id, v_intent.amount, 'success', p_tx_hash);
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
        update public.payment_intents set status = 'paid', tx_hash = p_tx_hash where id = p_intent_id;
        return jsonb_build_object('status', 'paid');
      else
        return jsonb_build_object('status', 'amount_mismatch', 'found', v_amount, 'expected', v_intent.amount);
      end if;
    end if;
  end loop;

  return jsonb_build_object('status', 'no_matching_transfer');
end;
$$;
