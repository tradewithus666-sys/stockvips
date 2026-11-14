-- supabase/protect_profiles.sql
--
-- 【強烈建議執行】修補一個權限漏洞。
--
-- 問題：你的 profiles 表有一條 policy「profile self update」，寫法是
--         for update using (id = auth.uid())
--       它沒有限制「可以改哪些欄位」。意思是任何已登入的會員，只要用瀏覽器開發者工具
--       （或直接呼叫 Supabase API），就能把自己的 role 改成 'admin'、或把 balance（餘額）改成任意數字。
--       新增「群發電郵」後，admin 能寄信給全體會員，這個漏洞的後果會更嚴重。
--
-- 修法：加一個 trigger。只要是「會員本人從前端直接更新」，就不准動 role 和 balance；
--       管理員、後端 function（service role）、以及 Supabase 裡的 security definer 函式
--       （例如餘額購買 purchase_with_balance 之類的 RPC）都不受影響。
--
-- 前提：請先執行 email_features.sql（它會建立下面用到的 email_is_admin 函式）。
--
-- 重要：請先在 SQL Editor 跑最下面「檢查」那段，確認你線上資料庫目前的狀況；
--       執行後請測一次「用餘額購買」和「管理員調整餘額」確認正常。
--       如果有東西壞掉，執行最底下的「還原」那一行即可。

create or replace function public.protect_profile_privileged_cols()
returns trigger
language plpgsql
-- 注意：刻意「不」用 security definer，這樣 current_user 才能分辨呼叫來源：
--   前端直接更新  → current_user = 'authenticated'
--   security definer RPC / 後端 service role / SQL Editor → 不是 authenticated，直接放行
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.role is distinct from old.role
       or new.balance is distinct from old.balance then
      if not public.email_is_admin(auth.uid()) then
        raise exception '不允許修改 role 或 balance';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_profile_privileged_cols on public.profiles;
create trigger protect_profile_privileged_cols
  before update on public.profiles
  for each row execute function public.protect_profile_privileged_cols();

-- ---------------- 檢查（可選，先單獨執行這段看看） ----------------
-- 看看 profiles 目前有哪些 update policy 與 trigger：
-- select policyname, cmd, qual, with_check from pg_policies where tablename = 'profiles';
-- select tgname from pg_trigger where tgrelid = 'public.profiles'::regclass and not tgisinternal;

-- ---------------- 還原（如果執行後有功能壞掉） ----------------
-- drop trigger if exists protect_profile_privileged_cols on public.profiles;
