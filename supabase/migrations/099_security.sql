-- ზარაფხანა · 099 · security: signup trigger, row level security, grants, realtime, avatars, scheduler

/* ---------- new users get a profile ---------- */
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function zi.on_signup();

/* ---------- row level security: everything is read-only from the API; all changes go through functions ---------- */
do $$
declare t text;
begin
  foreach t in array array['config', 'profiles', 'profile_priv', 'ledger', 'feed', 'notes', 'achievements', 'weekly', 'investments', 'rounds',
    'quest_day', 'messages', 'lot_tickets', 'lottery', 'items', 'inventory', 'auctions', 'deposits', 'pass_claims', 'stocks', 'stock_hist',
    'stock_news', 'holdings', 'predictions', 'pred_bets', 'clans', 'clan_wars', 'loans', 'fair', 'fair_seeds', 'games', 'duels',
    'live_rounds', 'live_bets', 'poker_tables', 'poker_seats', 'poker_holes', 'bingo_games', 'bingo_cards', 'eco'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists zar_read on public.%I', t);
  end loop;
end $$;

-- readable by every signed-in player
do $$
declare t text;
begin
  foreach t in array array['profiles', 'feed', 'achievements', 'weekly', 'investments', 'rounds', 'lot_tickets', 'lottery', 'inventory',
    'auctions', 'stock_hist', 'stock_news', 'holdings', 'predictions', 'clans', 'clan_wars', 'duels', 'live_rounds', 'live_bets',
    'poker_tables', 'poker_seats', 'bingo_games', 'bingo_cards'] loop
    execute format('create policy zar_read on public.%I for select to authenticated using (true)', t);
  end loop;
end $$;
-- readable even before signing in (the login page shows the shop and the rates)
create policy zar_read on public.config for select to anon, authenticated using (true);
create policy zar_read on public.items for select to anon, authenticated using (true);
create policy zar_read on public.stocks for select to anon, authenticated using (true);
-- only your own rows
create policy zar_read on public.profile_priv for select to authenticated using (id = auth.uid());
create policy zar_read on public.notes for select to authenticated using (user_id = auth.uid());
create policy zar_read on public.quest_day for select to authenticated using (user_id = auth.uid());
create policy zar_read on public.deposits for select to authenticated using (user_id = auth.uid());
create policy zar_read on public.pass_claims for select to authenticated using (user_id = auth.uid());
create policy zar_read on public.fair for select to authenticated using (user_id = auth.uid());
create policy zar_read on public.fair_seeds for select to authenticated using (user_id = auth.uid());
create policy zar_read on public.games for select to authenticated using (user_id = auth.uid());
create policy zar_read on public.poker_holes for select to authenticated using (user_id = auth.uid());
create policy zar_read on public.pred_bets for select to authenticated using (user_id = auth.uid());
create policy zar_read on public.loans for select to authenticated using (lender = auth.uid() or borrower = auth.uid());
-- your own ledger; the admin sees everyone's
create policy zar_read on public.ledger for select to authenticated
  using (user_id = auth.uid() or coalesce((select p.is_admin from public.profiles p where p.id = auth.uid()), false));
create policy zar_read on public.eco for select to authenticated
  using (coalesce((select p.is_admin from public.profiles p where p.id = auth.uid()), false));
-- chat: public messages (muted players are hidden from others) and your clan's messages
create policy zar_read on public.messages for select to authenticated using (
  not deleted and (
    (clan_id is null and (user_id = auth.uid()
       or not coalesce((select p.muted from public.profiles p where p.id = messages.user_id), false)
       or coalesce((select p.is_admin from public.profiles p where p.id = auth.uid()), false)))
    or clan_id = (select p.clan_id from public.profiles p where p.id = auth.uid() and not p.clan_pending)
  ));

/* ---------- privileges ---------- */
revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;
revoke all on all tables in schema zi from public, anon, authenticated;
revoke all on all functions in schema zi from public, anon, authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
grant execute on function public.server_now() to anon;
-- the scheduler is for pg_cron and for signed-in clients only
revoke execute on function public.zar_tick() from anon;

/* ---------- realtime ---------- */
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then return; end if;
  foreach t in array array['config', 'profiles', 'feed', 'notes', 'achievements', 'investments', 'rounds', 'messages', 'lottery', 'lot_tickets',
    'inventory', 'auctions', 'stocks', 'stock_news', 'holdings', 'predictions', 'clans', 'clan_wars', 'loans', 'duels',
    'live_rounds', 'live_bets', 'poker_tables', 'poker_seats', 'bingo_games', 'weekly'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

/* ---------- avatars: public bucket, everyone writes only into their own folder ---------- */
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 524288, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update set public = true, file_size_limit = 524288, allowed_mime_types = array['image/webp', 'image/jpeg', 'image/png'];
drop policy if exists zar_avatar_ins on storage.objects;
drop policy if exists zar_avatar_upd on storage.objects;
drop policy if exists zar_avatar_del on storage.objects;
drop policy if exists zar_avatar_sel on storage.objects;
create policy zar_avatar_sel on storage.objects for select to public using (bucket_id = 'avatars');
create policy zar_avatar_ins on storage.objects for insert to authenticated with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy zar_avatar_upd on storage.objects for update to authenticated using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy zar_avatar_del on storage.objects for delete to authenticated using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

/* ---------- scheduler state and the minute job ---------- */
insert into zi.kv (k, v) values ('settled', to_jsonb(zi.cur() - 1)) on conflict do nothing;
insert into zi.kv (k, v) values ('week_done', to_jsonb(zi.curweek() - 7)) on conflict do nothing;
select zi.stock_tick();
select zi.bingo_ensure();
do $$
begin
  begin create extension if not exists pg_cron with schema pg_catalog; exception when others then raise notice 'pg_cron: %', sqlerrm; end;
  perform cron.schedule('zar-tick', '* * * * *', 'select public.zar_tick()');
exception when others then raise notice 'pg_cron is not enabled: %', sqlerrm;
end $$;
