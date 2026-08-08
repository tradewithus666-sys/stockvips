-- ============================================================
-- 自动侦测改良版：eth_getLogs 在免费节点上常被限流（不是区块范围问题），
-- 这次改成「依序尝试好几个免费节点」，一个被限流就换下一个，加大自动侦测成功率。
-- ============================================================

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
  v_log jsonb;
  v_days int;
  v_existing_expiry date;
  v_new_expiry date;
  USDT_CONTRACT text := '0x55d398326f99059fF775485246999027B3197955';
  TRANSFER_TOPIC text := '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
  v_to_topic text;
  v_latest_hex text;
  v_latest_block bigint;
  v_from_block bigint;
  v_from_hex text;
  v_amount numeric;
  v_rpc text;
  v_rpc_list text[] := array[
    'https://bsc-dataseed.binance.org/',
    'https://bsc-dataseed1.defibit.io/',
    'https://bsc-dataseed1.ninicoin.io/',
    'https://bsc-dataseed2.defibit.io/',
    'https://rpc.ankr.com/bsc'
  ];
  v_got_logs boolean := false;
begin
  select * into v_intent from public.payment_intents where id = p_intent_id and member_id = auth.uid();
  if v_intent is null then return jsonb_build_object('status', 'not_found'); end if;
  if v_intent.status = 'paid' then return jsonb_build_object('status', 'paid'); end if;
  if v_intent.expires_at < now() then
    update public.payment_intents set status = 'expired' where id = p_intent_id;
    return jsonb_build_object('status', 'expired');
  end if;

  v_to_topic := '0x' || lpad(lower(regexp_replace(v_intent.address, '^0x', '')), 64, '0');

  -- 依序尝试每个免费节点，直到有一个成功回传（不是限流/错误）为止
  foreach v_rpc in array v_rpc_list loop
    begin
      select * into v_resp from extensions.http_post(
        v_rpc,
        '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}',
        'application/json'
      );
      v_latest_hex := (v_resp.content::jsonb)->>'result';
      if v_latest_hex is null then continue; end if;
      v_latest_block := ('x' || lpad(regexp_replace(v_latest_hex, '^0x', ''), 16, '0'))::bit(64)::bigint;
      v_from_block := greatest(v_latest_block - 300, 0); -- 约 15 分钟区块范围，涵盖订单 10 分钟有效期
      v_from_hex := '0x' || to_hex(v_from_block);

      select * into v_resp from extensions.http_post(
        v_rpc,
        jsonb_build_object(
          'jsonrpc', '2.0', 'id', 1, 'method', 'eth_getLogs',
          'params', jsonb_build_array(jsonb_build_object(
            'fromBlock', v_from_hex,
            'toBlock', 'latest',
            'address', USDT_CONTRACT,
            'topics', jsonb_build_array(TRANSFER_TOPIC, null, v_to_topic)
          ))
        )::text,
        'application/json'
      );
      v_body := v_resp.content::jsonb;

      if v_body ? 'error' then
        continue; -- 这个节点被限流／出错，换下一个
      end if;
      if v_body ? 'result' then
        v_got_logs := true;
        exit; -- 成功拿到资料，跳出迴圈
      end if;
    exception when others then
      continue; -- 这个节点连不上或格式异常，换下一个
    end;
  end loop;

  if not v_got_logs then
    -- 所有节点都失败了，先回传 pending，让前端继续轮询，等下一轮再试
    return jsonb_build_object('status', 'pending', 'note', 'all_rpc_failed');
  end if;

  for v_log in select * from jsonb_array_elements(coalesce(v_body->'result', '[]'::jsonb))
  loop
    v_amount := public.hex_to_numeric(v_log->>'data') / 1e18;
    if v_amount >= v_intent.amount * 0.99 then
      if v_intent.kind = 'recharge' then
        update public.profiles set balance = balance + v_intent.amount where id = v_intent.member_id;
        insert into public.wallet_tx (member_id, amount, status, tx_hash) values (v_intent.member_id, v_intent.amount, 'success', v_log->>'transactionHash');
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

      update public.payment_intents set status = 'paid', tx_hash = v_log->>'transactionHash' where id = p_intent_id;
      return jsonb_build_object('status', 'paid');
    end if;
  end loop;

  return jsonb_build_object('status', 'pending');
end;
$$;
