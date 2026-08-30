-- MIDAS shares the TERRAN Supabase project. Every object created here is
-- explicitly namespaced so this migration cannot change TERRAN tables, grants,
-- policies, functions, or data.

create schema if not exists midas_private;
revoke all on schema midas_private from public, anon;

create table public.midas_users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text,
  role text not null default 'user' check (role in ('admin', 'user')),
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  last_login_at timestamptz not null default now()
);

create table public.midas_financial_months (
  id text primary key,
  user_id uuid not null references public.midas_users(id) on delete cascade,
  month_key text not null check (month_key ~ '^\d{4}-\d{2}$'),
  income double precision not null default 0 check (income >= 0),
  savings_target double precision not null default 0 check (savings_target >= 0),
  status text not null default 'open',
  created_at timestamptz not null default now(),
  constraint midas_financial_month_user_unique unique (user_id, month_key)
);

create table public.midas_categories (
  id text primary key,
  user_id uuid not null references public.midas_users(id) on delete cascade,
  name text not null,
  group_name text not null,
  budget double precision not null default 0 check (budget >= 0),
  color text not null default '#CBA65B' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  kind text not null default 'variable' check (kind in ('fixed', 'variable', 'discretionary')),
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
create index midas_categories_user_idx on public.midas_categories(user_id);

create table public.midas_debts (
  id text primary key,
  user_id uuid not null references public.midas_users(id) on delete cascade,
  name text not null,
  entity text not null default '',
  original_amount double precision not null check (original_amount >= 0),
  current_balance double precision not null check (current_balance >= 0),
  annual_rate double precision not null default 0 check (annual_rate >= 0),
  minimum_payment double precision not null default 0 check (minimum_payment >= 0),
  planned_payment double precision not null default 0 check (planned_payment >= 0),
  due_day integer not null default 1 check (due_day between 1 and 31),
  acquired_at date not null,
  status text not null default 'active',
  created_at timestamptz not null default now()
);
create index midas_debts_user_idx on public.midas_debts(user_id);

create table public.midas_transactions (
  id text primary key,
  user_id uuid not null references public.midas_users(id) on delete cascade,
  date date not null,
  description text not null,
  amount double precision not null check (amount > 0),
  category_id text references public.midas_categories(id) on delete set null,
  subcategory text,
  debt_id text references public.midas_debts(id) on delete set null,
  type text not null default 'expense' check (type in ('expense', 'income', 'debt_payment')),
  account text not null default 'Efectivo',
  payment_method text,
  notes text,
  source_type text not null default 'manual' check (source_type in ('manual', 'spreadsheet')),
  source_id text,
  source_name text,
  source_imported_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index midas_transaction_source_unique_idx on public.midas_transactions(user_id, source_type, source_id);
create index midas_transaction_user_date_idx on public.midas_transactions(user_id, date);

create table public.midas_spreadsheet_sources (
  id text primary key,
  user_id uuid not null unique references public.midas_users(id) on delete cascade,
  source_name text not null,
  source_url text not null,
  column_mapping text not null,
  last_sync_at timestamptz,
  last_sync_status text not null default 'configured',
  last_rows_detected integer not null default 0,
  last_rows_inserted integer not null default 0,
  last_rows_ignored integer not null default 0,
  last_rows_failed integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.midas_spreadsheet_sync_logs (
  id text primary key,
  source_id text not null references public.midas_spreadsheet_sources(id) on delete cascade,
  user_id uuid not null references public.midas_users(id) on delete cascade,
  sync_started_at timestamptz not null,
  sync_completed_at timestamptz not null,
  rows_detected integer not null default 0,
  rows_inserted integer not null default 0,
  rows_ignored integer not null default 0,
  rows_failed integer not null default 0,
  status text not null,
  errors text not null default '[]',
  created_at timestamptz not null default now()
);
create index midas_spreadsheet_logs_user_idx on public.midas_spreadsheet_sync_logs(user_id, created_at);

create table public.midas_activity_logs (
  id text primary key,
  user_id uuid not null references public.midas_users(id) on delete cascade,
  target_user_id uuid references public.midas_users(id) on delete set null,
  action text not null,
  status text not null default 'success',
  metadata text not null default '{}',
  created_at timestamptz not null default now()
);
create index midas_activity_logs_created_idx on public.midas_activity_logs(created_at);

create table public.midas_system_settings (
  key text primary key,
  value text not null,
  updated_by uuid not null references public.midas_users(id),
  updated_at timestamptz not null default now()
);

create or replace function midas_private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.midas_users
    where id = (select auth.uid()) and role = 'admin' and status = 'active'
  );
$$;
revoke all on function midas_private.is_admin() from public, anon;
grant usage on schema midas_private to authenticated;
grant execute on function midas_private.is_admin() to authenticated;

alter table public.midas_users enable row level security;
alter table public.midas_financial_months enable row level security;
alter table public.midas_categories enable row level security;
alter table public.midas_debts enable row level security;
alter table public.midas_transactions enable row level security;
alter table public.midas_spreadsheet_sources enable row level security;
alter table public.midas_spreadsheet_sync_logs enable row level security;
alter table public.midas_activity_logs enable row level security;
alter table public.midas_system_settings enable row level security;

-- Scope grants only to MIDAS objects. Never change privileges on the rest of
-- public because TERRAN is hosted in this same database.
revoke all on table
  public.midas_users,
  public.midas_financial_months,
  public.midas_categories,
  public.midas_debts,
  public.midas_transactions,
  public.midas_spreadsheet_sources,
  public.midas_spreadsheet_sync_logs,
  public.midas_activity_logs,
  public.midas_system_settings
from anon, authenticated;

grant select on public.midas_users to authenticated;
grant select, insert, update, delete on
  public.midas_financial_months,
  public.midas_categories,
  public.midas_debts,
  public.midas_transactions,
  public.midas_spreadsheet_sources
to authenticated;
grant select, insert on public.midas_spreadsheet_sync_logs, public.midas_activity_logs to authenticated;
grant select, insert, update on public.midas_system_settings to authenticated;

create policy "midas_users_select" on public.midas_users for select to authenticated
using (id = (select auth.uid()) or (select midas_private.is_admin()));
create policy "midas_users_update_admin" on public.midas_users for update to authenticated
using ((select midas_private.is_admin())) with check ((select midas_private.is_admin()));

create policy "midas_months_select" on public.midas_financial_months for select to authenticated using (user_id = (select auth.uid()));
create policy "midas_months_insert" on public.midas_financial_months for insert to authenticated with check (user_id = (select auth.uid()));
create policy "midas_months_update" on public.midas_financial_months for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "midas_months_delete" on public.midas_financial_months for delete to authenticated using (user_id = (select auth.uid()));

create policy "midas_categories_select" on public.midas_categories for select to authenticated using (user_id = (select auth.uid()));
create policy "midas_categories_insert" on public.midas_categories for insert to authenticated with check (user_id = (select auth.uid()));
create policy "midas_categories_update" on public.midas_categories for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "midas_categories_delete" on public.midas_categories for delete to authenticated using (user_id = (select auth.uid()));

create policy "midas_debts_select" on public.midas_debts for select to authenticated using (user_id = (select auth.uid()));
create policy "midas_debts_insert" on public.midas_debts for insert to authenticated with check (user_id = (select auth.uid()));
create policy "midas_debts_update" on public.midas_debts for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "midas_debts_delete" on public.midas_debts for delete to authenticated using (user_id = (select auth.uid()));

create policy "midas_transactions_select" on public.midas_transactions for select to authenticated using (user_id = (select auth.uid()));
create policy "midas_transactions_insert" on public.midas_transactions for insert to authenticated with check (user_id = (select auth.uid()));
create policy "midas_transactions_update" on public.midas_transactions for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "midas_transactions_delete" on public.midas_transactions for delete to authenticated using (user_id = (select auth.uid()));

create policy "midas_sources_select" on public.midas_spreadsheet_sources for select to authenticated using (user_id = (select auth.uid()) or (select midas_private.is_admin()));
create policy "midas_sources_insert" on public.midas_spreadsheet_sources for insert to authenticated with check (user_id = (select auth.uid()));
create policy "midas_sources_update" on public.midas_spreadsheet_sources for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "midas_sources_delete" on public.midas_spreadsheet_sources for delete to authenticated using (user_id = (select auth.uid()));

create policy "midas_sync_logs_select" on public.midas_spreadsheet_sync_logs for select to authenticated using (user_id = (select auth.uid()) or (select midas_private.is_admin()));
create policy "midas_sync_logs_insert" on public.midas_spreadsheet_sync_logs for insert to authenticated with check (user_id = (select auth.uid()));

create policy "midas_activity_select" on public.midas_activity_logs for select to authenticated using (user_id = (select auth.uid()) or (select midas_private.is_admin()));
create policy "midas_activity_insert" on public.midas_activity_logs for insert to authenticated with check (user_id = (select auth.uid()));

create policy "midas_settings_select" on public.midas_system_settings for select to authenticated using (true);
create policy "midas_settings_insert_admin" on public.midas_system_settings for insert to authenticated with check ((select midas_private.is_admin()));
create policy "midas_settings_update_admin" on public.midas_system_settings for update to authenticated using ((select midas_private.is_admin())) with check ((select midas_private.is_admin()));
