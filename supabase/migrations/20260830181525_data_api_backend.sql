create or replace function public.midas_register_current_user(p_display_name text default null)
returns setof public.midas_users
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  assigned_role text;
begin
  if current_user_id is null or current_email = '' then
    raise exception 'Authentication required';
  end if;

  perform pg_advisory_xact_lock(hashtext('midas_register_current_user'));
  select case when exists (select 1 from public.midas_users) then 'user' else 'admin' end
  into assigned_role;

  insert into public.midas_users (id, email, display_name, role, status, last_login_at)
  values (current_user_id, current_email, nullif(btrim(p_display_name), ''), assigned_role, 'active', now())
  on conflict (id) do update
    set display_name = coalesce(nullif(btrim(excluded.display_name), ''), public.midas_users.display_name);

  if not exists (
    select 1 from public.midas_activity_logs
    where user_id = current_user_id and action = 'user_created'
  ) then
    insert into public.midas_activity_logs (id, user_id, target_user_id, action, status, metadata)
    values (
      'act_' || gen_random_uuid()::text,
      current_user_id,
      current_user_id,
      'user_created',
      'success',
      json_build_object('role', assigned_role)::text
    );
  end if;

  return query select * from public.midas_users where id = current_user_id;
end;
$$;

revoke all on function public.midas_register_current_user(text) from public, anon;
grant execute on function public.midas_register_current_user(text) to authenticated;

create or replace function public.midas_record_debt_payment(
  p_transaction_id text,
  p_debt_id text,
  p_date date,
  p_description text,
  p_amount double precision,
  p_account text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_amount <= 0 then raise exception 'Amount must be positive'; end if;

  update public.midas_debts
  set current_balance = greatest(0, current_balance - p_amount)
  where id = p_debt_id and user_id = auth.uid();
  if not found then raise exception 'Debt not found'; end if;

  insert into public.midas_transactions (
    id, user_id, date, description, amount, debt_id, type, account, source_type
  ) values (
    p_transaction_id, auth.uid(), p_date, p_description, p_amount,
    p_debt_id, 'debt_payment', p_account, 'manual'
  );
end;
$$;

revoke all on function public.midas_record_debt_payment(text, text, date, text, double precision, text) from public, anon;
grant execute on function public.midas_record_debt_payment(text, text, date, text, double precision, text) to authenticated;

create or replace function public.midas_delete_transaction(p_transaction_id text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  transaction_row public.midas_transactions%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select * into transaction_row
  from public.midas_transactions
  where id = p_transaction_id and user_id = auth.uid()
  for update;

  if not found then return; end if;
  if transaction_row.type = 'debt_payment' and transaction_row.debt_id is not null then
    update public.midas_debts
    set current_balance = current_balance + transaction_row.amount
    where id = transaction_row.debt_id and user_id = auth.uid();
  end if;

  delete from public.midas_transactions
  where id = p_transaction_id and user_id = auth.uid();
end;
$$;

revoke all on function public.midas_delete_transaction(text) from public, anon;
grant execute on function public.midas_delete_transaction(text) to authenticated;
