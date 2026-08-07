create or replace function public.admin_adjust_balance(p_member_id uuid, p_amount numeric, p_note text default '管理员手动加值')
returns numeric
language plpgsql
security definer
as $$
declare
  v_new_balance numeric;
begin
  if not public.is_admin() then
    raise exception '无权限';
  end if;
  update public.profiles set balance = balance + p_amount where id = p_member_id
    returning balance into v_new_balance;
  insert into public.wallet_tx (member_id, amount, status) values (p_member_id, p_amount, 'success');
  return v_new_balance;
end;
$$;

alter table public.products add column if not exists images jsonb not null default '[]';
