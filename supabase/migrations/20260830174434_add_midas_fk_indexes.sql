-- Cover every MIDAS foreign key reported by the Supabase performance advisor.
create index midas_transactions_category_id_idx on public.midas_transactions(category_id);
create index midas_transactions_debt_id_idx on public.midas_transactions(debt_id);
create index midas_spreadsheet_sync_logs_source_id_idx on public.midas_spreadsheet_sync_logs(source_id);
create index midas_activity_logs_user_id_idx on public.midas_activity_logs(user_id);
create index midas_activity_logs_target_user_id_idx on public.midas_activity_logs(target_user_id);
create index midas_system_settings_updated_by_idx on public.midas_system_settings(updated_by);
