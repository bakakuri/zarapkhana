-- ზარაფხანა · 007 · admin tools, seasons, scheduled events, weekly rollover, the minute scheduler

create table if not exists public.eco (c int primary key, tot bigint not null, lk bigint not null, gr bigint not null, n int not null, at bigint not null default zi.ms());

/* ---------- grants ---------- */
create or replace function public.admin_grant(who uuid, amount bigint, note text default '') returns bigint language plpgsql security definer set search_path = public, zi as $$
declare b bigint;
begin
  perform zi.need_admin();
  if amount is null or amount = 0 then perform zi.err('bad_amount'); end if;
  select balance into b from public.profiles where id = who for update;
  if not found then perform zi.err('not_found'); end if;
  amount := greatest(amount, -b);
  if amount = 0 then return b; end if;
  b := zi.mv(who, 'admin', amount, 'a', jsonb_build_object('n', left(coalesce(note, ''), 80)));
  perform zi.note(who, 'a', amount, jsonb_build_object('n', left(coalesce(note, ''), 80)));
  return b;
end $$;
create or replace function public.admin_grant_all(amount bigint, note text default '') returns int language plpgsql security definer set search_path = public, zi as $$
declare r record; n int := 0;
begin
  perform zi.need_admin();
  if amount is null or amount < 1 then perform zi.err('bad_amount'); end if;
  for r in select id from public.profiles where not frozen loop
    perform zi.mv(r.id, 'admin', amount, 'a', jsonb_build_object('n', left(coalesce(note, ''), 80)));
    perform zi.note(r.id, 'a', amount, jsonb_build_object('n', left(coalesce(note, ''), 80)));
    n := n + 1;
  end loop;
  return n;
end $$;
-- lines: [{"who": "name, e-mail or id", "amount": 500, "note": "..."}]
create or replace function public.admin_bulk(lines jsonb) returns jsonb language plpgsql security definer set search_path = public, zi, auth as $$
declare l jsonb; who text; amt bigint; uid uuid; out_ jsonb := '[]'::jsonb; nm text;
begin
  perform zi.need_admin();
  if jsonb_typeof(lines) <> 'array' or jsonb_array_length(lines) > 500 then perform zi.err('bad_params'); end if;
  for l in select * from jsonb_array_elements(lines) loop
    who := trim(coalesce(l ->> 'who', '')); amt := nullif(l ->> 'amount', '')::bigint; uid := null;
    if who ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then select id into uid from public.profiles where id = who::uuid; end if;
    if uid is null then select id into uid from public.profiles where lower(name) = lower(who); end if;
    if uid is null and who like '%@%' then select p.id into uid from public.profiles p join auth.users au on au.id = p.id where lower(au.email) = lower(who); end if;
    if uid is null or amt is null or amt = 0 then
      out_ := out_ || jsonb_build_array(jsonb_build_object('who', who, 'ok', false, 'err', case when uid is null then 'not_found' else 'bad_amount' end));
      continue;
    end if;
    select name into nm from public.profiles where id = uid;
    perform public.admin_grant(uid, amt, coalesce(l ->> 'note', 'ჯგუფური დარიცხვა'));
    out_ := out_ || jsonb_build_array(jsonb_build_object('who', who, 'ok', true, 'id', uid, 'name', nm, 'amount', amt));
  end loop;
  return out_;
end $$;

/* ---------- config ---------- */
create or replace function public.admin_set_rates(r jsonb, bonus int) returns int language plpgsql security definer set search_path = public, zi as $$
declare nxt int := zi.cur() + 1; c jsonb; rr jsonb := '{}'::jsonb; k text;
begin
  perform zi.need_admin();
  foreach k in array array['g', 'l', 'm', 'h'] loop
    if (r ->> k) is null or (r ->> k)::numeric < 0 or (r ->> k)::numeric > 10000 then perform zi.err('bad_params'); end if;
    rr := rr || jsonb_build_object(k, floor((r ->> k)::numeric));
  end loop;
  c := zi.cfg();
  c := jsonb_set(c, '{rates}', coalesce((select jsonb_agg(e order by (e ->> 'from')::int) from (select e from jsonb_array_elements(c -> 'rates') e where (e ->> 'from')::int < nxt order by (e ->> 'from')::int desc limit 11) x), '[]'::jsonb)
                    || jsonb_build_array(jsonb_build_object('from', nxt, 'r', rr)));
  c := jsonb_set(c, '{bonus}', to_jsonb(greatest(0, coalesce(bonus, 0))));
  update public.config set data = c, at = zi.ms() where id = 1;
  return nxt;
end $$;
create or replace function public.admin_cfg(patch jsonb) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare c jsonb := zi.cfg(); k text;
begin
  perform zi.need_admin();
  for k in select jsonb_object_keys(patch) loop
    if k not in ('tour', 'tx', 'lot', 'clanPrize', 'clanWar', 'bank', 'ins', 'ref', 'tax', 'sched', 'theme', 'bingo', 'poker', 'auction', 'questMult', 'welcome', 'closeMin', 'maxBet') then
      perform zi.err('bad_key');
    end if;
    c := jsonb_set(c, array[k], patch -> k);
  end loop;
  update public.config set data = c, at = zi.ms() where id = 1;
  return c;
end $$;
create or replace function public.admin_ann(t text) returns void language plpgsql security definer set search_path = public, zi as $$
begin
  perform zi.need_admin();
  update public.config set data = jsonb_set(data, '{ann}', case when nullif(trim(coalesce(t, '')), '') is null then 'null'::jsonb
    else jsonb_build_object('t', left(trim(t), 200), 'at', zi.ms()) end), at = zi.ms() where id = 1;
end $$;
create or replace function public.admin_event(k text, hours numeric) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare evs jsonb;
begin
  perform zi.need_admin();
  if k not in ('xp2', 'bonus2', 'quest2', 'cash10') then perform zi.err('bad_params'); end if;
  select coalesce(jsonb_agg(e), '[]'::jsonb) into evs from jsonb_array_elements(coalesce(zi.cfg() -> 'evs', '[]'::jsonb)) e
  where e ->> 'k' <> k and (e ->> 'until')::bigint > zi.ms();
  if hours > 0 then evs := evs || jsonb_build_array(jsonb_build_object('k', k, 'until', zi.ms() + (hours * 3600000)::bigint, 'at', zi.ms())); end if;
  update public.config set data = jsonb_set(data, '{evs}', evs), at = zi.ms() where id = 1;
  return evs;
end $$;
create or replace function public.admin_user(who uuid, field text, val boolean) returns void language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.need_admin();
begin
  if field = 'is_admin' and who = u and not val then perform zi.err('bad_params'); end if;
  if field = 'frozen' and who = u then perform zi.err('bad_params'); end if;
  if field = 'muted' then update public.profiles set muted = val where id = who;
  elsif field = 'frozen' then update public.profiles set frozen = val where id = who;
  elsif field = 'pic_hidden' then update public.profiles set pic_hidden = val where id = who;
  elsif field = 'is_admin' then update public.profiles set is_admin = val where id = who;
  else perform zi.err('bad_params'); end if;
end $$;

/* ---------- seasons ---------- */
create or replace function public.admin_season(base bigint, reset boolean) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare c jsonb := zi.cfg(); sid int := coalesce((c -> 'season' ->> 'id')::int, 0); top jsonb; r record;
begin
  perform zi.need_admin();
  base := greatest(0, coalesce(base, 0));
  select coalesce(jsonb_agg(jsonb_build_object('p', id, 'w', w) order by w desc), '[]'::jsonb) into top from (
    select p.id, p.balance + p.locked + p.dep + p.lent + coalesce((select sum(h.n * zi.stock_price(h.t)) from public.holdings h where h.user_id = p.id), 0)::bigint w
    from public.profiles p order by 2 desc limit 5) x;
  c := jsonb_set(c, '{fame}', (select coalesce(jsonb_agg(e), '[]'::jsonb) from (select e from jsonb_array_elements(coalesce(c -> 'fame', '[]'::jsonb)) e) x)
                   || jsonb_build_array(jsonb_build_object('id', sid, 'at', zi.ms(), 'top', top)));
  c := jsonb_set(c, '{season}', jsonb_build_object('id', sid + 1, 'at', zi.ms(), 'base', base, 'reset', coalesce(reset, false)));
  update public.config set data = c, at = zi.ms() where id = 1;
  update public.profiles set sxp = 0, sea = sid + 1;
  if reset then
    update public.investments set ended = zi.cur(), res = 'x' where ended is null;
    update public.deposits set status = 'void' where status = 'active';
    delete from public.holdings;
    update public.stocks set held = 0;
    update public.loans set st = 'void' where st in ('open', 'active');
    update public.inventory set listed = false where id in (select inv_id from public.auctions where status = 'open');
    update public.auctions set status = 'cancel' where status = 'open';
    update public.duels set st = 'cancel' where st = 'open';
    delete from public.poker_seats;
    update public.poker_tables set stage = 'idle', turn = null, deadline = null, board = '{}';
    update public.profiles set locked = 0, dep = 0, lent = 0;
    for r in select id, balance from public.profiles loop
      if r.balance <> base then perform zi.mv(r.id, 'reset', base - r.balance, 'rs', null); end if;
    end loop;
  end if;
  return c -> 'season';
end $$;

/* ---------- admin views ---------- */
create or replace function public.admin_players() returns jsonb language plpgsql security definer set search_path = public, zi, auth as $$
begin
  perform zi.need_admin();
  return coalesce((select jsonb_agg(x order by x.balance + x.locked desc) from (
    select p.id, p.name, p.balance, p.locked, p.dep, p.lent, p.xp, p.frozen, p.muted, p.is_admin, p.pic_hidden, p.joined_at, p.seen_at, p.st,
           au.email, (select coalesce(sum(delta), 0) from public.ledger l where l.user_id = p.id and l.cat = 'admin') granted
    from public.profiles p left join auth.users au on au.id = p.id) x), '[]'::jsonb);
end $$;
create or replace function public.admin_flows(days int default null) returns jsonb language plpgsql security definer set search_path = public, zi as $$
begin
  perform zi.need_admin();
  return coalesce((select jsonb_object_agg(cat, s) from (select cat, sum(delta) s from public.ledger
                   where days is null or at > zi.ms() - days * 86400000::bigint group by cat) x), '{}'::jsonb);
end $$;
create or replace function public.admin_ledger(who uuid, lim int default 100) returns jsonb language plpgsql security definer set search_path = public, zi as $$
begin
  perform zi.need_admin();
  return coalesce((select jsonb_agg(to_jsonb(l) order by l.id desc) from (select * from public.ledger where user_id = who order by id desc limit least(lim, 500)) l), '[]'::jsonb);
end $$;
create or replace function public.admin_poker_table(name text, sb bigint, bb bigint, min_buy bigint, max_buy bigint, seats int default 6) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare t public.poker_tables;
begin
  perform zi.need_admin();
  if sb < 1 or bb < sb or min_buy < bb * 10 or max_buy < min_buy or seats not between 2 and 9 then perform zi.err('bad_params'); end if;
  insert into public.poker_tables (name, sb, bb, min_buy, max_buy, seats) values (left(name, 30), sb, bb, min_buy, max_buy, seats) returning * into t;
  return to_jsonb(t);
end $$;
create or replace function public.admin_poker_delete(tid int) returns void language plpgsql security definer set search_path = public, zi as $$
begin
  perform zi.need_admin();
  if exists (select 1 from public.poker_seats where table_id = tid) then perform zi.err('has_players'); end if;
  delete from public.poker_tables where id = tid;
end $$;

/* ---------- weekly rollover ---------- */
create or replace function zi.tour_pay(ww int) returns void language plpgsql security definer set search_path = public, zi as $$
declare c jsonb := zi.cfg() -> 'tour'; r record; i int := 0; pz bigint;
begin
  if not coalesce((c ->> 'on')::boolean, true) then return; end if;
  for r in select * from public.weekly where w = ww and n >= coalesce((c ->> 'min')::int, 10) and net > 0 order by net desc, vol desc limit 3 loop
    pz := coalesce((c -> 'prizes' ->> i)::bigint, 0);
    i := i + 1;
    if pz <= 0 then continue; end if;
    perform zi.mv(r.user_id, 'prize', pz, 'tw', jsonb_build_object('r', i, 'w', ww));
    perform zi.note(r.user_id, 'tw', pz, jsonb_build_object('r', i, 'w', ww));
    perform zi.feed(r.user_id, 'tw', pz, jsonb_build_object('r', i));
    perform zi.ach(r.user_id, 'tourney');
  end loop;
end $$;
create or replace function zi.tax_week(ww int) returns void language plpgsql security definer set search_path = public, zi as $$
declare c jsonb := zi.cfg() -> 'tax'; r record; t bigint; tot bigint := 0; th bigint; pct numeric;
begin
  if not coalesce((c ->> 'on')::boolean, false) then return; end if;
  th := coalesce((c ->> 'threshold')::bigint, 50000); pct := coalesce((c ->> 'pct')::numeric, 2);
  for r in select id, balance from public.profiles where balance > th for update loop
    t := floor((r.balance - th) * pct / 100);
    if t > 0 then
      perform zi.mv(r.id, 'tax', -t, 'tax', jsonb_build_object('w', ww));
      perform zi.note(r.id, 'tax', -t, jsonb_build_object('w', ww));
      tot := tot + t;
    end if;
  end loop;
  -- the collected tax goes to this week's lottery prize
  if tot > 0 then insert into public.lottery (w, bonus) values (ww, tot) on conflict (w) do update set bonus = lottery.bonus + excluded.bonus; end if;
end $$;
create or replace function zi.week_roll() returns void language plpgsql security definer set search_path = public, zi as $$
declare done_w int := coalesce((select (v #>> '{}')::int from zi.kv where k = 'week_done'), zi.curweek() - 7); cw int := zi.curweek(); w int;
begin
  w := done_w + 7;
  while w <= cw - 7 loop
    perform zi.tour_pay(w);
    perform zi.lot_draw(w);
    perform zi.clan_prize(w);
    perform zi.wars_resolve(w);
    insert into zi.kv (k, v) values ('week_done', to_jsonb(w)) on conflict (k) do update set v = excluded.v;
    w := w + 7;
  end loop;
  if not exists (select 1 from zi.kv where k = 'tax_' || cw) then
    perform zi.tax_week(cw);
    delete from zi.kv where k like 'tax\_%';
    insert into zi.kv (k, v) values ('tax_' || cw, 'true') on conflict do nothing;
  end if;
  perform zi.wars_pair(cw);
end $$;

/* ---------- scheduled events: [{"id": "...", "k": "xp2", "dow": 4 (0 = Monday, -1 = every day), "h": 20, "dur": 3}] ---------- */
create or replace function zi.sched_events() returns void language plpgsql security definer set search_path = public, zi as $$
declare e jsonb; loc timestamp := to_timestamp(zi.ms() / 1000.0) at time zone 'Asia/Tbilisi'; cand timestamp; st bigint; en bigint; evs jsonb; dw int;
begin
  for e in select * from jsonb_array_elements(coalesce(zi.cfg() -> 'sched', '[]'::jsonb)) loop
    if (e ->> 'k') not in ('xp2', 'bonus2', 'quest2', 'cash10') then continue; end if;
    dw := coalesce((e ->> 'dow')::int, -1);
    cand := date_trunc('day', loc) + make_interval(hours => coalesce((e ->> 'h')::int, 0));
    if dw >= 0 then cand := cand - make_interval(days => ((extract(isodow from loc)::int - 1 - dw + 7) % 7)); end if;
    if cand > loc then cand := cand - make_interval(days => case when dw >= 0 then 7 else 1 end); end if;
    st := (extract(epoch from (cand at time zone 'Asia/Tbilisi')) * 1000)::bigint;
    en := st + (coalesce((e ->> 'dur')::numeric, 1) * 3600000)::bigint;
    if zi.ms() >= st and zi.ms() < en then
      evs := coalesce(zi.cfg() -> 'evs', '[]'::jsonb);
      if not exists (select 1 from jsonb_array_elements(evs) x where x ->> 'k' = e ->> 'k' and (x ->> 'until')::bigint >= en) then
        select coalesce(jsonb_agg(x), '[]'::jsonb) into evs from jsonb_array_elements(evs) x where x ->> 'k' <> e ->> 'k' and (x ->> 'until')::bigint > zi.ms();
        evs := evs || jsonb_build_array(jsonb_build_object('k', e ->> 'k', 'until', en, 'at', st, 'auto', true));
        update public.config set data = jsonb_set(data, '{evs}', evs), at = zi.ms() where id = 1;
      end if;
    end if;
  end loop;
end $$;

/* ---------- the scheduler: pg_cron runs this every minute; clients may nudge it too ---------- */
create or replace function public.zar_tick() returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare last bigint; settled int; c int; cur int := zi.cur(); t record; did text[] := '{}'; errs text[] := '{}';
begin
  if not pg_try_advisory_xact_lock(hashtext('zar-tick')) then return jsonb_build_object('busy', true); end if;
  last := coalesce((select (v #>> '{}')::bigint from zi.kv where k = 'tick_at'), 0);
  if auth.uid() is not null and zi.ms() - last < 15000 then return jsonb_build_object('skip', true); end if;
  insert into zi.kv (k, v) values ('tick_at', to_jsonb(zi.ms())) on conflict (k) do update set v = excluded.v;
  -- finished investment rounds
  settled := coalesce((select (v #>> '{}')::int from zi.kv where k = 'settled'), cur - 1);
  c := settled + 1;
  while c <= cur - 1 and c <= settled + 30 loop
    begin
      perform zi.settle_cycle(c);
      insert into zi.kv (k, v) values ('settled', to_jsonb(c)) on conflict (k) do update set v = excluded.v;
      did := did || ('round ' || c);
    exception when others then errs := errs || ('round ' || c || ': ' || sqlerrm); exit;
    end;
    c := c + 1;
  end loop;
  begin perform zi.week_roll(); exception when others then errs := errs || ('week: ' || sqlerrm); end;
  begin perform zi.loans_tick(); exception when others then errs := errs || ('loans: ' || sqlerrm); end;
  begin perform zi.bank_mature(); exception when others then errs := errs || ('bank: ' || sqlerrm); end;
  begin perform zi.duels_tick(); exception when others then errs := errs || ('duels: ' || sqlerrm); end;
  begin
    for t in select id from public.auctions where status = 'open' and ends <= zi.ms() loop perform zi.auction_settle(t.id); end loop;
  exception when others then errs := errs || ('auctions: ' || sqlerrm); end;
  begin perform zi.stock_tick(); exception when others then errs := errs || ('stocks: ' || sqlerrm); end;
  begin perform zi.crash_tidy(); exception when others then errs := errs || ('crash: ' || sqlerrm); end;
  begin perform zi.live_step(); exception when others then errs := errs || ('live: ' || sqlerrm); end;
  begin perform zi.bingo_run(); exception when others then errs := errs || ('bingo: ' || sqlerrm); end;
  begin
    for t in select id from public.poker_tables where (stage <> 'idle' and deadline < zi.ms()) or stage = 'idle' loop perform zi.pk_poke(t.id); end loop;
  exception when others then errs := errs || ('poker: ' || sqlerrm); end;
  begin perform zi.sched_events(); exception when others then errs := errs || ('sched: ' || sqlerrm); end;
  begin
    if not exists (select 1 from public.eco where eco.c = cur) then
      insert into public.eco (c, tot, lk, gr, n)
      select cur, coalesce(sum(p.balance + p.locked + p.dep + p.lent), 0) + coalesce((select sum(h.n * zi.stock_price(h.t)) from public.holdings h), 0)::bigint,
             coalesce(sum(p.locked), 0), (select coalesce(sum(delta), 0) from public.ledger where cat = 'admin'), count(*)
      from public.profiles p on conflict do nothing;
    end if;
    perform zi.rich_check_all();
  exception when others then errs := errs || ('eco: ' || sqlerrm); end;
  begin
    delete from public.feed where id < (select coalesce(min(id), 0) from (select id from public.feed order by id desc limit 300) x);
    delete from public.notes where at < zi.ms() - 30 * 86400000::bigint;
    delete from public.messages where id < (select coalesce(min(id), 0) from (select id from public.messages order by id desc limit 3000) x);
    delete from public.live_rounds where n < (select coalesce(max(n), 0) - 300 from public.live_rounds);
    delete from zi.live_secret where n < (select coalesce(max(n), 0) - 300 from zi.live_secret);
    delete from public.games where status = 'done' and done < zi.ms() - 90 * 86400000::bigint;
    delete from zi.game_secret s where not exists (select 1 from public.games g where g.id = s.game_id and g.status = 'active') and s.game_id < (select coalesce(max(id), 0) - 5000 from public.games);
  exception when others then errs := errs || ('prune: ' || sqlerrm); end;
  if array_length(errs, 1) > 0 then
    insert into zi.kv (k, v) values ('tick_err', jsonb_build_object('at', zi.ms(), 'e', to_jsonb(errs))) on conflict (k) do update set v = excluded.v;
  end if;
  return jsonb_build_object('done', to_jsonb(did), 'errors', to_jsonb(errs));
end $$;
create or replace function public.admin_health() returns jsonb language plpgsql security definer set search_path = public, zi as $$
begin
  perform zi.need_admin();
  return jsonb_build_object('tick_at', (select v from zi.kv where k = 'tick_at'), 'settled', (select v from zi.kv where k = 'settled'),
    'week_done', (select v from zi.kv where k = 'week_done'), 'tick_err', (select v from zi.kv where k = 'tick_err'), 'now', zi.ms(), 'cur', zi.cur());
end $$;
