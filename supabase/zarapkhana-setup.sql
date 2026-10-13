-- ზარაფხანა · Supabase-ის სრული დაყენება (ერთი ფაილი)
-- Supabase → SQL Editor → New query → ჩასვი მთელი ფაილი → Run.
-- ფაილი უსაფრთხოა ხელახლა გასაშვებად: არსებულ მონაცემებს არ შლის.

-- ===== 001_base.sql =====
-- ზარაფხანა · 001 · base: time, config, profiles, ledger, notifications, helpers
create extension if not exists pgcrypto with schema extensions;
create schema if not exists zi;
revoke all on schema zi from public;
revoke all on schema zi from anon, authenticated;

/* ---------- time (all times are epoch milliseconds) ---------- */
create or replace function zi.ms() returns bigint language sql volatile as $$ select (extract(epoch from clock_timestamp()) * 1000)::bigint $$;
-- a "cycle" is one 24 h investment round ending at 00:00 Tbilisi (20:00 UTC)
create or replace function zi.cyc(t bigint) returns int language sql immutable as $$ select floor((t - 72000000)::numeric / 86400000)::int $$;
create or replace function zi.cyc_start(c int) returns bigint language sql immutable as $$ select c::bigint * 86400000 + 72000000 $$;
create or replace function zi.cyc_end(c int) returns bigint language sql immutable as $$ select (c::bigint + 1) * 86400000 + 72000000 $$;
create or replace function zi.cur() returns int language sql volatile as $$ select zi.cyc(zi.ms()) $$;
-- weeks start on Monday 00:00 Tbilisi; a week is identified by its first cycle
create or replace function zi.week(c int) returns int language sql immutable as $$ select c - ((c + 4) % 7) $$;
create or replace function zi.curweek() returns int language sql volatile as $$ select zi.week(zi.cur()) $$;

/* ---------- small key/value state for the scheduler ---------- */
create table if not exists zi.kv (k text primary key, v jsonb);

/* ---------- config (single row, readable by everyone) ---------- */
create table if not exists public.config (
  id int primary key default 1 check (id = 1),
  data jsonb not null,
  at bigint not null default zi.ms()
);
insert into public.config (id, data) values (1, jsonb_build_object(
  'rates', jsonb_build_array(jsonb_build_object('from', 0, 'r', jsonb_build_object('g', 3, 'l', 40, 'm', 110, 'h', 320))),
  'bonus', 50, 'welcome', 500, 'closeMin', 60, 'tx', true,
  'tour', jsonb_build_object('on', true, 'prizes', jsonb_build_array(1000, 500, 250), 'min', 10),
  'lot', jsonb_build_object('on', true, 'price', 20, 'cut', 10),
  'questMult', 1, 'season', jsonb_build_object('id', 0, 'at', zi.ms(), 'base', 1000, 'reset', false),
  'ann', null, 'fame', '[]'::jsonb, 'evs', '[]'::jsonb, 'sched', '[]'::jsonb,
  'clanPrize', 200, 'clanWar', jsonb_build_object('on', true, 'prize', 1000),
  'bank', jsonb_build_object('3', 8, '7', 22, '30', 110, 'pen', 5),
  'ins', jsonb_build_object('l', 15, 'm', 30, 'h', 45, 'back', 50),
  'ref', jsonb_build_object('on', true, 'amt', 300, 'xp', 2000),
  'tax', jsonb_build_object('on', false, 'threshold', 50000, 'pct', 2),
  'bingo', jsonb_build_object('on', true, 'price', 25, 'seed', 100, 'every', 20),
  'poker', jsonb_build_object('on', true, 'rake', 2),
  'auction', jsonb_build_object('fee', 5),
  'theme', null
)) on conflict (id) do nothing;

create or replace function zi.cfg() returns jsonb language sql stable as $$ select data from public.config where id = 1 $$;
create or replace function zi.cfgn(path text[], dflt numeric) returns numeric language sql stable as $$
  select coalesce((zi.cfg() #>> path)::numeric, dflt)
$$;
create or replace function zi.cfgb(path text[], dflt boolean) returns boolean language sql stable as $$
  select coalesce((zi.cfg() #>> path)::boolean, dflt)
$$;
create or replace function zi.ev_on(k text) returns boolean language sql stable as $$
  select exists (select 1 from jsonb_array_elements(coalesce(zi.cfg() -> 'evs', '[]'::jsonb)) e
                 where e ->> 'k' = k and (e ->> 'until')::bigint > zi.ms())
$$;
create or replace function zi.rates_for(c int) returns jsonb language sql stable as $$
  select coalesce((select e -> 'r' from jsonb_array_elements(zi.cfg() -> 'rates') e
                   where (e ->> 'from')::int <= c order by (e ->> 'from')::int desc limit 1),
                  '{"g":3,"l":40,"m":110,"h":320}'::jsonb)
$$;

/* ---------- profiles (public) and private settings ---------- */
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null,
  pic text,
  pic_hidden boolean not null default false,
  is_admin boolean not null default false,
  frozen boolean not null default false,
  muted boolean not null default false,
  balance bigint not null default 0 check (balance >= 0),
  locked bigint not null default 0,
  dep bigint not null default 0,
  lent bigint not null default 0,
  xp bigint not null default 0,
  sxp bigint not null default 0,
  sea int not null default 0,
  st jsonb not null default '{}'::jsonb,
  eq jsonb not null default '{}'::jsonb,
  clan_id uuid,
  clan_pending boolean not null default false,
  login jsonb not null default '{}'::jsonb,
  ref_code text not null unique,
  ref_by uuid,
  ref_paid boolean not null default false,
  joined_at bigint not null default zi.ms(),
  seen_at bigint
);
create unique index if not exists profiles_name_ci on public.profiles (lower(name));

create table if not exists public.profile_priv (
  id uuid primary key references public.profiles (id) on delete cascade,
  lim jsonb not null default '{}'::jsonb,
  day jsonb not null default '{}'::jsonb,
  tok jsonb not null default '{}'::jsonb
);

/* ---------- ledger: every coin that moves is written here ---------- */
create table if not exists public.ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  cat text not null,
  delta bigint not null,
  bal bigint not null,
  k text,
  meta jsonb,
  at bigint not null default zi.ms()
);
create index if not exists ledger_user on public.ledger (user_id, id desc);
create index if not exists ledger_cat on public.ledger (cat, at);

/* ---------- public activity feed, personal notifications, achievements, weekly stats ---------- */
create table if not exists public.feed (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  k text not null, d bigint not null default 0, meta jsonb, at bigint not null default zi.ms()
);
create index if not exists feed_at on public.feed (id desc);
create table if not exists public.notes (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  k text not null, d bigint, meta jsonb, at bigint not null default zi.ms(), seen boolean not null default false
);
create index if not exists notes_user on public.notes (user_id, id desc);
create table if not exists public.achievements (
  user_id uuid not null references public.profiles (id) on delete cascade,
  k text not null, at bigint not null default zi.ms(),
  primary key (user_id, k)
);
create table if not exists public.weekly (
  user_id uuid not null references public.profiles (id) on delete cascade,
  w int not null, net bigint not null default 0, vol bigint not null default 0, n int not null default 0,
  xp bigint not null default 0, inv bigint not null default 0,
  primary key (user_id, w)
);
create index if not exists weekly_w on public.weekly (w);

/* ---------- helpers ---------- */
create or replace function zi.is_admin() returns boolean language sql stable security definer set search_path = public, zi as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false)
$$;
create or replace function zi.err(code text) returns void language plpgsql as $$ begin raise exception 'ZAR:%', code; end $$;
-- the caller: signed in, has a profile, not frozen
create or replace function zi.me() returns uuid language plpgsql volatile security definer set search_path = public, zi as $$
declare u uuid := auth.uid(); f boolean;
begin
  if u is null then perform zi.err('auth'); end if;
  select frozen into f from public.profiles where id = u;
  if not found then perform zi.err('noprofile'); end if;
  if f then perform zi.err('frozen'); end if;
  return u;
end $$;
create or replace function zi.need_admin() returns uuid language plpgsql volatile security definer set search_path = public, zi as $$
declare u uuid := zi.me();
begin
  if not zi.is_admin() then perform zi.err('admin'); end if;
  return u;
end $$;

-- move coins: the only way balances change
create or replace function zi.mv(u uuid, cat text, delta bigint, k text default null, meta jsonb default null) returns bigint
language plpgsql security definer set search_path = public, zi as $$
declare b bigint;
begin
  if delta = 0 and k is null then return (select balance from public.profiles where id = u); end if;
  update public.profiles set balance = balance + delta where id = u and balance + delta >= 0 returning balance into b;
  if not found then perform zi.err('insufficient'); end if;
  insert into public.ledger (user_id, cat, delta, bal, k, meta) values (u, cat, delta, b, k, meta);
  return b;
end $$;

create or replace function zi.vip_i(xp bigint) returns int language sql immutable as $$
  select case when xp >= 100000 then 4 when xp >= 30000 then 3 when xp >= 7500 then 2 when xp >= 1500 then 1 else 0 end
$$;
create or replace function zi.vip_mult(xp bigint) returns numeric language sql immutable as $$
  select (array[1, 1.25, 1.5, 2, 3])[zi.vip_i(xp) + 1]::numeric
$$;
create or replace function zi.note(u uuid, k text, d bigint default null, meta jsonb default null) returns void language sql security definer set search_path = public, zi as $$
  insert into public.notes (user_id, k, d, meta) values (u, k, d, meta)
$$;
create or replace function zi.feed(u uuid, k text, d bigint, meta jsonb default null) returns void language sql security definer set search_path = public, zi as $$
  insert into public.feed (user_id, k, d, meta) values (u, k, d, meta)
$$;
create or replace function zi.ach(u uuid, k text) returns boolean language plpgsql security definer set search_path = public, zi as $$
begin
  insert into public.achievements (user_id, k) values (u, k) on conflict do nothing;
  if found then perform zi.note(u, 'ach', null, jsonb_build_object('a', k)); return true; end if;
  return false;
end $$;
create or replace function zi.st_add(u uuid, key text, inc numeric) returns numeric language plpgsql security definer set search_path = public, zi as $$
declare v numeric;
begin
  update public.profiles set st = jsonb_set(st, array[key], to_jsonb(coalesce((st ->> key)::numeric, 0) + inc)) where id = u
  returning (st ->> key)::numeric into v;
  return v;
end $$;
create or replace function zi.st_max(u uuid, key text, val numeric) returns void language sql security definer set search_path = public, zi as $$
  update public.profiles set st = jsonb_set(st, array[key], to_jsonb(greatest(coalesce((st ->> key)::numeric, 0), val))) where id = u
$$;
create or replace function zi.st_set(u uuid, key text, val jsonb) returns void language sql security definer set search_path = public, zi as $$
  update public.profiles set st = jsonb_set(st, array[key], val) where id = u
$$;
create or replace function zi.weekly_add(u uuid, net bigint, vol bigint, n int, xp bigint, inv bigint) returns void language sql security definer set search_path = public, zi as $$
  insert into public.weekly (user_id, w, net, vol, n, xp, inv) values (u, zi.curweek(), net, vol, n, xp, inv)
  on conflict (user_id, w) do update set net = weekly.net + excluded.net, vol = weekly.vol + excluded.vol, n = weekly.n + excluded.n,
    xp = weekly.xp + excluded.xp, inv = weekly.inv + excluded.inv
$$;

/* ---------- signup: profile, private row, welcome coins, first user becomes admin ---------- */
create or replace function zi.on_signup() returns trigger language plpgsql security definer set search_path = public, zi, extensions as $$
declare nm text; base text; i int := 0; code text; ref uuid; first boolean; w bigint; pic text;
begin
  nm := coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
                 split_part(coalesce(new.email, 'player'), '@', 1));
  nm := left(regexp_replace(nm, '\s+', ' ', 'g'), 24);
  if char_length(nm) < 2 then nm := 'მოთამაშე'; end if;
  base := nm;
  while exists (select 1 from public.profiles where lower(name) = lower(nm)) loop
    i := i + 1; nm := left(base, 20) || ' ' || i;
  end loop;
  loop
    code := upper(substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 8));
    exit when not exists (select 1 from public.profiles where ref_code = code);
  end loop;
  select id into ref from public.profiles where ref_code = upper(nullif(trim(new.raw_user_meta_data ->> 'ref'), ''));
  first := not exists (select 1 from public.profiles where is_admin);
  pic := nullif(new.raw_user_meta_data ->> 'avatar_url', '');
  insert into public.profiles (id, name, ref_code, ref_by, is_admin, sea, pic)
  values (new.id, nm, code, ref, first, coalesce((zi.cfg() -> 'season' ->> 'id')::int, 0), pic);
  insert into public.profile_priv (id) values (new.id);
  perform zi.fair_init(new.id);
  w := coalesce((zi.cfg() ->> 'welcome')::bigint, 0);
  if w > 0 then perform zi.mv(new.id, 'admin', w, 'a', jsonb_build_object('n', 'მისასალმებელი დარიცხვა')); end if;
  return new;
end $$;

/* ---------- my profile actions ---------- */
create or replace function public.server_now() returns bigint language sql volatile security definer set search_path = public, zi as $$ select zi.ms() $$;

create or replace function public.set_name(n text) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me();
begin
  n := left(trim(regexp_replace(coalesce(n, ''), '\s+', ' ', 'g')), 24);
  if char_length(n) < 2 then perform zi.err('name_short'); end if;
  if exists (select 1 from public.profiles where lower(name) = lower(n) and id <> u) then perform zi.err('name_taken'); end if;
  update public.profiles set name = n where id = u;
  return jsonb_build_object('name', n);
end $$;

create or replace function public.set_pic(url text) returns void language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me();
begin
  if url is not null and url not like '%/avatars/' || u::text || '/%' then perform zi.err('bad_pic'); end if;
  update public.profiles set pic = url where id = u;
end $$;

create or replace function public.notes_seen() returns void language sql security definer set search_path = public, zi as $$
  update public.notes set seen = true where user_id = zi.me() and not seen
$$;

create or replace function public.touch() returns bigint language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me();
begin
  update public.profiles set seen_at = zi.ms() where id = u;
  return zi.ms();
end $$;

-- ===== 002_rounds.sql =====
-- ზარაფხანა · 002 · investment rounds (4 risk tiers, auto-continue, compounding, insurance)
create table if not exists public.investments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  t char(1) not null check (t in ('g', 'l', 'm', 'h')),
  a bigint not null check (a > 0),          -- amount first put in
  sc int not null,                           -- first round it plays in
  sa int,                                    -- stop after this round (null = auto-continue)
  cp boolean not null default false,         -- reinvest profit
  ins boolean not null default false,        -- insurance switched on
  ins_c int,                                 -- round the premium was paid for
  cur int not null,                          -- round the stake currently plays in
  ls bigint not null,                        -- current stake
  lc int,                                    -- last settled round
  ended int, res char(1),                    -- w = finished with a win, l = lost, r = refunded, x = cancelled
  at bigint not null default zi.ms()
);
create index if not exists inv_user on public.investments (user_id, at desc);
create index if not exists inv_open on public.investments (cur) where ended is null;

create table if not exists public.rounds (
  c int primary key,
  r jsonb not null,
  e jsonb not null default '[]'::jsonb,
  at bigint not null default zi.ms()
);

create or replace function zi.tier_lose(t text) returns int language sql immutable as $$
  select case t when 'g' then 0 when 'l' then 25 when 'm' then 50 when 'h' then 75 end
$$;
create or replace function zi.enroll_cycle() returns int language sql volatile as $$
  select case when zi.ms() < zi.cyc_end(zi.cur()) - zi.cfgn('{closeMin}', 60)::bigint * 60000 then zi.cur() else zi.cur() + 1 end
$$;
create or replace function zi.ins_pct(t text) returns numeric language sql stable as $$
  select case when t = 'g' then 0 else zi.cfgn(array['ins', t], case t when 'l' then 15 when 'm' then 30 else 45 end) end
$$;

-- self-exclusion (pause) blocks all betting, investments included
create or replace function zi.not_paused(u uuid) returns void language plpgsql security definer set search_path = public, zi as $$
declare p bigint;
begin
  select (lim ->> 'pause')::bigint into p from public.profile_priv where id = u;
  if p is not null and p > zi.ms() then perform zi.err('paused'); end if;
end $$;

create or replace function public.invest(t text, amount bigint, auto boolean default true, comp boolean default false, insure boolean default false)
returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); ec int; prem bigint := 0; r public.investments;
begin
  perform zi.not_paused(u);
  if t not in ('g', 'l', 'm', 'h') then perform zi.err('bad_tier'); end if;
  if amount is null or amount < 1 then perform zi.err('bad_amount'); end if;
  ec := zi.enroll_cycle();
  perform zi.mv(u, 'inv', -amount, 'ib', jsonb_build_object('t', t));
  insure := coalesce(insure, false) and t <> 'g';
  if insure then
    prem := ceil(amount * zi.ins_pct(t) / 100.0);
    if prem > 0 then perform zi.mv(u, 'ins', -prem, 'insp', jsonb_build_object('t', t, 'c', ec)); end if;
  end if;
  insert into public.investments (user_id, t, a, sc, sa, cp, ins, ins_c, cur, ls)
  values (u, t, amount, ec, case when auto then null else ec end, auto and coalesce(comp, false), insure, case when insure then ec end, ec, amount)
  returning * into r;
  update public.profiles set locked = locked + amount where id = u;
  perform zi.st_add(u, 'invN', 1);
  perform zi.add_xp(u, amount);
  perform zi.q_add(u, 'inv', jsonb_build_object('t', t, 'a', amount));
  perform zi.ach(u, 'first_inv');
  return to_jsonb(r);
end $$;

create or replace function public.inv_set(id uuid, auto boolean default null, comp boolean default null, insure boolean default null)
returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); v public.investments; c int := zi.cur(); prem bigint; open_now boolean;
begin
  select * into v from public.investments i where i.id = inv_set.id and i.user_id = u for update;
  if not found or v.ended is not null then perform zi.err('not_found'); end if;
  if auto is not null then
    if auto then v.sa := null; else v.sa := greatest(c, v.sc); v.cp := false; end if;
  end if;
  if comp is not null then
    if v.sa is not null and comp then perform zi.err('need_auto'); end if;
    v.cp := comp;
  end if;
  if insure is not null and v.t <> 'g' then
    v.ins := insure;
    -- turning insurance on also covers the current round while it still accepts entries
    open_now := v.cur > c or (v.cur = c and zi.ms() < zi.cyc_end(c) - zi.cfgn('{closeMin}', 60)::bigint * 60000);
    if insure and open_now and coalesce(v.ins_c, -1) <> v.cur then
      prem := ceil(v.ls * zi.ins_pct(v.t) / 100.0);
      if prem > 0 then perform zi.mv(u, 'ins', -prem, 'insp', jsonb_build_object('t', v.t, 'c', v.cur)); end if;
      v.ins_c := v.cur;
    end if;
  end if;
  update public.investments i set sa = v.sa, cp = v.cp, ins = v.ins, ins_c = v.ins_c where i.id = v.id;
  return to_jsonb(v);
end $$;

-- settle one finished round: in each tier exactly lose% of participants lose (randomly), the rest earn the tier rate
create or replace function zi.settle_cycle(cc int) returns int language plpgsql security definer set search_path = public, zi as $$
declare
  rates jsonb := zi.rates_for(cc); tk text; n int; k int; exact numeric; i int;
  v record; e jsonb := '[]'::jsonb; d bigint; last boolean; prem bigint; back bigint;
  backpct numeric := zi.cfgn('{ins,back}', 50); cnt int := 0; s record;
begin
  if exists (select 1 from public.rounds where c = cc) then return 0; end if;
  -- anything stuck in an older round is refunded
  for v in select * from public.investments where ended is null and cur < cc for update loop
    perform zi.mv(v.user_id, 'inv', v.ls, 'ir', jsonb_build_object('t', v.t));
    update public.profiles set locked = greatest(0, locked - v.ls) where id = v.user_id;
    update public.investments set ended = cc, res = 'r' where id = v.id;
  end loop;
  foreach tk in array array['g', 'l', 'm', 'h'] loop
    select count(*) into n from public.investments where ended is null and cur = cc and t = tk;
    if n = 0 then continue; end if;
    exact := n * zi.tier_lose(tk) / 100.0;
    k := floor(exact);
    if random() < exact - k then k := k + 1; end if;
    i := 0;
    for v in select * from public.investments where ended is null and cur = cc and t = tk order by random() for update loop
      i := i + 1; cnt := cnt + 1;
      if i <= k then
        -- lost
        e := e || jsonb_build_array(jsonb_build_object('p', v.user_id, 'i', v.id, 't', v.t, 's', v.ls, 'w', 0, 'd', -v.ls));
        update public.investments set ended = cc, res = 'l', lc = cc where id = v.id;
        update public.profiles set locked = greatest(0, locked - v.ls) where id = v.user_id;
        perform zi.mv(v.user_id, 'inv', 0, 'il', jsonb_build_object('t', v.t, 'c', cc, 'd', -v.ls));
        perform zi.st_add(v.user_id, 'inv', -v.ls);
        perform zi.st_set(v.user_id, 'streak', '0');
        perform zi.weekly_add(v.user_id, 0, 0, 0, 0, -v.ls);
        if v.ins and v.ins_c = cc then
          back := floor(v.ls * backpct / 100.0);
          if back > 0 then
            perform zi.mv(v.user_id, 'ins', back, 'insb', jsonb_build_object('t', v.t, 'c', cc));
            perform zi.ach(v.user_id, 'insured');
          end if;
        end if;
      else
        d := floor(v.ls * (rates ->> tk)::numeric / 100.0);
        e := e || jsonb_build_array(jsonb_build_object('p', v.user_id, 'i', v.id, 't', v.t, 's', v.ls, 'w', 1, 'd', d));
        last := v.sa is not null and v.sa <= cc;
        if last then
          perform zi.mv(v.user_id, 'inv', v.ls + d, 'iw', jsonb_build_object('t', v.t, 'c', cc, 'd', d));
          update public.investments set ended = cc, res = 'w', lc = cc where id = v.id;
          update public.profiles set locked = greatest(0, locked - v.ls) where id = v.user_id;
        elsif v.cp then
          perform zi.mv(v.user_id, 'inv', 0, 'iw', jsonb_build_object('t', v.t, 'c', cc, 'd', d, 'cp', true));
          update public.investments set ls = ls + d, lc = cc, cur = cc + 1 where id = v.id;
          update public.profiles set locked = locked + d where id = v.user_id;
        else
          perform zi.mv(v.user_id, 'inv', d, 'iw', jsonb_build_object('t', v.t, 'c', cc, 'd', d));
          update public.investments set lc = cc, cur = cc + 1 where id = v.id;
        end if;
        perform zi.st_add(v.user_id, 'inv', d);
        perform zi.st_add(v.user_id, 'invWins', 1);
        perform zi.st_max(v.user_id, 'maxStreak', zi.st_add(v.user_id, 'streak', 1));
        perform zi.weekly_add(v.user_id, 0, 0, 0, 0, d);
        if v.t = 'h' then perform zi.st_add(v.user_id, 'highWins', 1); end if;
        -- insurance for the next round of a continuing investment
        if not last and v.ins then
          prem := ceil((v.ls + case when v.cp then d else 0 end) * zi.ins_pct(v.t) / 100.0);
          begin
            if prem > 0 then perform zi.mv(v.user_id, 'ins', -prem, 'insp', jsonb_build_object('t', v.t, 'c', cc + 1)); end if;
            update public.investments set ins_c = cc + 1 where id = v.id;
          exception when others then
            update public.investments set ins = false where id = v.id;
            perform zi.note(v.user_id, 'insoff', null, jsonb_build_object('t', v.t));
          end;
        end if;
      end if;
    end loop;
  end loop;
  insert into public.rounds (c, r, e) values (cc, rates, e);
  -- one notification per player, a few public feed entries, achievements
  for s in select (x ->> 'p')::uuid p, sum((x ->> 'd')::bigint)::bigint d, bool_or((x ->> 'w')::int = 1 and x ->> 't' = 'h') hw
           from jsonb_array_elements(e) x group by 1 loop
    perform zi.note(s.p, 'round', s.d, jsonb_build_object('c', cc));
    if (select (st ->> 'invWins')::int from public.profiles where id = s.p) >= 1 then perform zi.ach(s.p, 'inv_win'); end if;
    if (select (st ->> 'maxStreak')::int from public.profiles where id = s.p) >= 3 then perform zi.ach(s.p, 'streak3'); end if;
    if (select (st ->> 'maxStreak')::int from public.profiles where id = s.p) >= 7 then perform zi.ach(s.p, 'streak7'); end if;
    if s.hw then perform zi.ach(s.p, 'high_win'); end if;
    if (select (st ->> 'highWins')::int from public.profiles where id = s.p) >= 3 then perform zi.ach(s.p, 'high3'); end if;
  end loop;
  for s in select (x ->> 'p')::uuid p, sum((x ->> 'd')::bigint)::bigint d from jsonb_array_elements(e) x group by 1 order by abs(sum((x ->> 'd')::bigint)) desc limit 4 loop
    if s.d <> 0 then perform zi.feed(s.p, case when s.d > 0 then 'iw' else 'il' end, s.d, jsonb_build_object('c', cc)); end if;
  end loop;
  perform zi.rich_check_all();
  return cnt;
end $$;

-- ===== 003_social.sql =====
-- ზარაფხანა · 003 · XP & VIP, quests, daily calendar, transfers, chat, lottery, shop, boxes, auctions, bank, season pass, referrals, holiday tokens

/* ---------- XP, VIP, referrals ---------- */
create or replace function zi.ref_check(u uuid, nx bigint) returns void language plpgsql security definer set search_path = public, zi as $$
declare rb uuid; amt bigint;
begin
  if not zi.cfgb('{ref,on}', true) or nx < zi.cfgn('{ref,xp}', 2000) then return; end if;
  update public.profiles set ref_paid = true where id = u and ref_by is not null and not ref_paid returning ref_by into rb;
  if rb is null then return; end if;
  amt := zi.cfgn('{ref,amt}', 300)::bigint;
  if amt > 0 then
    perform zi.mv(u, 'ref', amt, 'ref', jsonb_build_object('p', rb));
    perform zi.mv(rb, 'ref', amt, 'refb', jsonb_build_object('p', u));
    perform zi.note(u, 'ref', amt, jsonb_build_object('p', rb));
    perform zi.note(rb, 'refb', amt, jsonb_build_object('p', u));
  end if;
  perform zi.ach(rb, 'referral');
end $$;

create or replace function zi.add_xp(u uuid, amount bigint) returns bigint language plpgsql security definer set search_path = public, zi as $$
declare x bigint; nx bigint; mult numeric := 1; b jsonb;
begin
  if amount is null or amount <= 0 then return 0; end if;
  if zi.ev_on('xp2') then mult := mult * 2; end if;
  select c.buffs into b from public.profiles p join public.clans c on c.id = p.clan_id where p.id = u and not p.clan_pending;
  if coalesce((b ->> 'xp10')::bigint, 0) > zi.ms() then mult := mult * 1.1; end if;
  x := floor(amount * mult);
  update public.profiles set xp = xp + x, sxp = sxp + x where id = u returning xp into nx;
  perform zi.weekly_add(u, 0, 0, 0, x, 0);
  if zi.vip_i(nx) > zi.vip_i(nx - x) then perform zi.note(u, 'lvl', null, jsonb_build_object('i', zi.vip_i(nx))); end if;
  if nx >= 7500 then perform zi.ach(u, 'vip_gold'); end if;
  perform zi.ref_check(u, nx);
  return x;
end $$;

create or replace function zi.rich_check_all() returns void language plpgsql security definer set search_path = public, zi as $$
declare r record;
begin
  for r in select p.id, p.balance + p.locked + p.dep + p.lent + coalesce((select sum(h.n * zi.stock_price(h.t)) from public.holdings h where h.user_id = p.id), 0) w
           from public.profiles p where p.balance + p.locked + p.dep + p.lent > 3000 loop
    if r.w >= 10000 then perform zi.ach(r.id, 'rich10k'); end if;
    if r.w >= 100000 then perform zi.ach(r.id, 'rich100k'); end if;
  end loop;
end $$;

/* ---------- daily quests: 3 per day, chosen per player ---------- */
create table if not exists public.quest_day (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day int not null, qs text[] not null, p jsonb not null default '{}'::jsonb, cl text[] not null default '{}',
  primary key (user_id, day)
);
create or replace function zi.quest_defs() returns table (k text, goal int, rew int) language sql immutable as $$
  values ('play5', 5, 60), ('play15', 15, 150), ('win3', 3, 80), ('crash2', 1, 70), ('wager', 500, 120), ('inv1', 1, 60),
         ('invmh', 1, 100), ('chat', 1, 40), ('duel', 1, 100), ('ticket', 1, 50), ('bj3', 3, 70), ('plinko10', 10, 70),
         ('bonus', 1, 30), ('tx', 1, 50), ('poker3', 3, 90), ('bingo1', 1, 50), ('stock1', 1, 60), ('box1', 1, 60), ('bank1', 1, 60)
$$;
create or replace function zi.quest_row(u uuid) returns void language sql security definer set search_path = public, zi as $$
  insert into public.quest_day (user_id, day, qs)
  select u, zi.cur(), array(select q.k from zi.quest_defs() q order by md5(q.k || ':' || zi.cur() || ':' || u::text) limit 3)
  on conflict do nothing
$$;
create or replace function zi.q_add(u uuid, ev text, data jsonb default '{}'::jsonb) returns void language plpgsql security definer set search_path = public, zi as $$
declare d int := zi.cur(); qr public.quest_day; q text; inc bigint; g text := data ->> 'g'; bet bigint := coalesce((data ->> 'bet')::bigint, 0);
        win bigint := coalesce((data ->> 'win')::bigint, 0); goal int; changed boolean := false;
begin
  perform zi.quest_row(u);
  select * into qr from public.quest_day where user_id = u and day = d for update;
  foreach q in array qr.qs loop
    inc := case q
      when 'play5' then (ev = 'game')::int when 'play15' then (ev = 'game')::int
      when 'win3' then (ev = 'game' and win > bet)::int
      when 'crash2' then (ev = 'game' and g in ('crash', 'live') and win >= 2 * bet and bet > 0)::int
      when 'wager' then case when ev = 'game' then bet else 0 end
      when 'inv1' then (ev = 'inv')::int
      when 'invmh' then (ev = 'inv' and data ->> 't' in ('m', 'h'))::int
      when 'chat' then (ev = 'chat')::int when 'duel' then (ev = 'duel')::int
      when 'ticket' then case when ev = 'ticket' then coalesce((data ->> 'n')::int, 1) else 0 end
      when 'bj3' then (ev = 'game' and g = 'bj')::int when 'plinko10' then (ev = 'game' and g = 'plinko')::int
      when 'bonus' then (ev = 'bonus')::int when 'tx' then (ev = 'tx')::int
      when 'poker3' then (ev = 'poker')::int
      when 'bingo1' then case when ev = 'bingo' then coalesce((data ->> 'n')::int, 1) else 0 end
      when 'stock1' then (ev = 'stock')::int when 'box1' then (ev = 'box')::int when 'bank1' then (ev = 'bank')::int
      else 0 end;
    if inc > 0 then
      select qd.goal into goal from zi.quest_defs() qd where qd.k = q;
      qr.p := jsonb_set(qr.p, array[q], to_jsonb(least(goal, coalesce((qr.p ->> q)::bigint, 0) + inc)));
      changed := true;
    end if;
  end loop;
  if changed then update public.quest_day set p = qr.p where user_id = u and day = d; end if;
end $$;
create or replace function public.my_quests() returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); r public.quest_day;
begin
  perform zi.quest_row(u);
  select * into r from public.quest_day where user_id = u and day = zi.cur();
  return to_jsonb(r);
end $$;
create or replace function public.claim_quest(k text) returns bigint language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); d int := zi.cur(); r public.quest_day; goal int; rew int; amt bigint;
begin
  select * into r from public.quest_day where user_id = u and day = d for update;
  if not found or not (k = any (r.qs)) then perform zi.err('not_found'); end if;
  if k = any (r.cl) then perform zi.err('claimed'); end if;
  select q.goal, q.rew into goal, rew from zi.quest_defs() q where q.k = claim_quest.k;
  if coalesce((r.p ->> k)::int, 0) < goal then perform zi.err('not_done'); end if;
  amt := floor(rew * zi.cfgn('{questMult}', 1) * case when zi.ev_on('quest2') then 2 else 1 end);
  update public.quest_day set cl = cl || k where user_id = u and day = d;
  perform zi.mv(u, 'quest', amt, 'qc', jsonb_build_object('q', k));
  perform zi.add_xp(u, 25);
  if zi.st_add(u, 'questN', 1) >= 10 then perform zi.ach(u, 'quester'); end if;
  return amt;
end $$;

/* ---------- daily calendar (7-day streak, replaces the plain daily bonus) ---------- */
create or replace function public.claim_daily() returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); d int := zi.cur(); lg jsonb; xp bigint; s int; amt bigint; base numeric := zi.cfgn('{bonus}', 50);
        f numeric[] := array[1, 1.5, 2, 3, 4, 6, 10]; mult numeric := 1; b jsonb; bx boolean := false;
begin
  select login, p.xp into lg, xp from public.profiles p where id = u for update;
  if base <= 0 then perform zi.err('off'); end if;
  if (lg ->> 'd')::int = d then perform zi.err('claimed'); end if;
  s := case when (lg ->> 'd')::int = d - 1 then coalesce((lg ->> 's')::int, 0) % 7 + 1 else 1 end;
  if zi.ev_on('bonus2') then mult := mult * 2; end if;
  select c.buffs into b from public.profiles p join public.clans c on c.id = p.clan_id where p.id = u and not p.clan_pending;
  if coalesce((b ->> 'bonus')::bigint, 0) > zi.ms() then mult := mult * 1.5; end if;
  amt := floor(base * f[s] * zi.vip_mult(xp) * mult);
  perform zi.mv(u, 'bonus', amt, 'b', jsonb_build_object('s', s));
  update public.profiles set login = jsonb_build_object('d', d, 's', s, 'n', coalesce((lg ->> 'n')::int, 0) + 1) where id = u;
  if s = 7 then
    insert into public.inventory (user_id, item, src) values (u, 'box-common', 'login');
    bx := true;
    perform zi.ach(u, 'login7');
  end if;
  perform zi.add_xp(u, 50);
  if zi.st_add(u, 'bonusN', 1) >= 7 then perform zi.ach(u, 'bonus7'); end if;
  perform zi.q_add(u, 'bonus');
  return jsonb_build_object('amt', amt, 's', s, 'box', bx);
end $$;

/* ---------- transfers ---------- */
create or replace function public.transfer(to_id uuid, amount bigint, note text default '') returns bigint language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); n text := left(trim(coalesce(note, '')), 60);
begin
  if not zi.cfgb('{tx}', true) then perform zi.err('tx_off'); end if;
  if to_id is null or to_id = u then perform zi.err('bad_target'); end if;
  if amount is null or amount < 1 then perform zi.err('bad_amount'); end if;
  if not exists (select 1 from public.profiles where id = to_id and not frozen) then perform zi.err('bad_target'); end if;
  perform 1 from public.profiles where id in (u, to_id) order by id for update;
  perform zi.mv(u, 'tx', -amount, 'to', jsonb_build_object('p', to_id, 'n', n));
  perform zi.mv(to_id, 'tx', amount, 'ti', jsonb_build_object('p', u, 'n', n));
  perform zi.note(to_id, 'ti', amount, jsonb_build_object('p', u, 'n', n));
  perform zi.st_add(u, 'txN', 1);
  perform zi.q_add(u, 'tx');
  perform zi.ach(u, 'gift');
  return amount;
end $$;

/* ---------- chat (public, per round, per clan) ---------- */
create table if not exists public.messages (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  body text not null, round int, clan_id uuid,
  at bigint not null default zi.ms(), deleted boolean not null default false
);
create index if not exists msg_at on public.messages (id desc);
create or replace function zi.my_clan() returns uuid language sql stable security definer set search_path = public, zi as $$
  select clan_id from public.profiles where id = auth.uid() and not clan_pending
$$;
create or replace function public.send_msg(body text, round int default null, to_clan boolean default false) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); b text := left(trim(regexp_replace(coalesce(body, ''), '\s+', ' ', 'g')), 280); cl uuid; m public.messages;
begin
  if b = '' then perform zi.err('empty'); end if;
  if (select muted from public.profiles where id = u) then perform zi.err('muted'); end if;
  if exists (select 1 from public.messages where user_id = u and at > zi.ms() - 2000) then perform zi.err('wait'); end if;
  if to_clan then
    cl := zi.my_clan();
    if cl is null then perform zi.err('no_clan'); end if;
    round := null;
  end if;
  insert into public.messages (user_id, body, round, clan_id) values (u, b, round, cl) returning * into m;
  perform zi.st_add(u, 'msgN', 1);
  perform zi.q_add(u, 'chat');
  perform zi.ach(u, 'chat1');
  return to_jsonb(m);
end $$;
create or replace function public.delete_msg(id bigint) returns void language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me();
begin
  update public.messages m set deleted = true where m.id = delete_msg.id and (m.user_id = u or zi.is_admin());
end $$;

/* ---------- weekly lottery ---------- */
create table if not exists public.lot_tickets (
  w int not null, user_id uuid not null references public.profiles (id) on delete cascade,
  n int not null default 0, s bigint not null default 0, primary key (w, user_id)
);
create table if not exists public.lottery (
  w int primary key, pool bigint not null default 0, bonus bigint not null default 0, t int not null default 0,
  winner uuid, ticket int, prize bigint, at bigint
);
create or replace function public.buy_tickets(n int) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); wk int := zi.curweek(); price bigint := zi.cfgn('{lot,price}', 20)::bigint; cost bigint; have int;
begin
  if not zi.cfgb('{lot,on}', true) then perform zi.err('off'); end if;
  if n is null or n < 1 then perform zi.err('bad_amount'); end if;
  select coalesce((select lt.n from public.lot_tickets lt where lt.w = wk and lt.user_id = u), 0) into have;
  if have + n > 100 then perform zi.err('lot_max'); end if;
  cost := n * price;
  perform zi.bet_check(u, cost);
  perform zi.mv(u, 'lot', -cost, 'lb', jsonb_build_object('n', n, 'w', wk));
  insert into public.lot_tickets (w, user_id, n, s) values (wk, u, n, cost)
  on conflict (w, user_id) do update set n = lot_tickets.n + excluded.n, s = lot_tickets.s + excluded.s;
  insert into public.lottery (w, pool, t) values (wk, cost, n) on conflict (w) do update set pool = lottery.pool + excluded.pool, t = lottery.t + excluded.t;
  perform zi.q_add(u, 'ticket', jsonb_build_object('n', n));
  return jsonb_build_object('n', have + n, 'cost', cost);
end $$;
create or replace function zi.lot_draw(ww int) returns void language plpgsql security definer set search_path = public, zi as $$
declare l public.lottery; r int; acc int := 0; x record; pz bigint;
begin
  select * into l from public.lottery where w = ww for update;
  if not found then insert into public.lottery (w, at) values (ww, zi.ms()) on conflict do nothing; return; end if;
  if l.at is not null then return; end if;
  if l.t <= 0 then update public.lottery set at = zi.ms() where w = ww; return; end if;
  r := floor(random() * l.t);
  for x in select * from public.lot_tickets where w = ww and n > 0 order by user_id loop
    acc := acc + x.n;
    if r < acc then
      pz := floor(l.pool * (100 - zi.cfgn('{lot,cut}', 10)) / 100.0) + l.bonus;
      update public.lottery set winner = x.user_id, ticket = r + 1, prize = pz, at = zi.ms() where w = ww;
      if pz > 0 then perform zi.mv(x.user_id, 'lot', pz, 'lw', jsonb_build_object('w', ww)); end if;
      perform zi.note(x.user_id, 'lw', pz, jsonb_build_object('w', ww));
      perform zi.feed(x.user_id, 'lw', pz, jsonb_build_object('w', ww));
      perform zi.ach(x.user_id, 'lucky');
      return;
    end if;
  end loop;
end $$;

/* ---------- shop, inventory, boxes ---------- */
create table if not exists public.items (
  id text primary key, cat text not null, name text not null, title text, price bigint,
  rarity int not null default 0, supply int, sold int not null default 0,
  src text not null default 'shop', ev text, ord int not null default 0
);
create table if not exists public.inventory (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  item text not null references public.items (id), serial int, src text,
  at bigint not null default zi.ms(), listed boolean not null default false
);
create index if not exists inv_items_user on public.inventory (user_id);
insert into public.items (id, cat, name, title, price, rarity, supply, src, ev, ord) values
 ('fr-gold', 'frame', 'ოქროს ჩარჩო', null, 600, 0, null, 'shop', null, 1),
 ('fr-neon', 'frame', 'ნეონის ჩარჩო', null, 1500, 0, null, 'shop', null, 2),
 ('fr-fire', 'frame', 'ცეცხლოვანი ჩარჩო', null, 4000, 0, null, 'shop', null, 3),
 ('fr-crown', 'frame', 'გვირგვინის ჩარჩო', null, 8000, 0, 25, 'shop', null, 4),
 ('nc-emerald', 'color', 'ზურმუხტისფერი სახელი', null, 400, 0, null, 'shop', null, 10),
 ('nc-ruby', 'color', 'ლალისფერი სახელი', null, 400, 0, null, 'shop', null, 11),
 ('nc-gold', 'color', 'ოქროსფერი სახელი', null, 1200, 0, null, 'shop', null, 12),
 ('nc-rainbow', 'color', 'ცისარტყელა სახელი', null, 3500, 0, null, 'shop', null, 13),
 ('ch-glow', 'chat', 'მანათობელი შეტყობინება', null, 900, 0, null, 'shop', null, 20),
 ('ch-gold', 'chat', 'ოქროს ჩარჩო ჩატში', null, 1600, 0, null, 'shop', null, 21),
 ('ch-spark', 'chat', 'ციმციმა შეტყობინება', null, 3000, 0, null, 'shop', null, 22),
 ('ti-investor', 'title', 'ტიტული', 'ინვესტორი', 500, 0, null, 'shop', null, 30),
 ('ti-lucky', 'title', 'ტიტული', 'იღბლიანი', 800, 0, null, 'shop', null, 31),
 ('ti-legend', 'title', 'ტიტული', 'ლეგენდა', 5000, 0, null, 'shop', null, 32),
 ('ti-founder', 'title', 'ტიტული', 'დამფუძნებელი', 3000, 0, 50, 'shop', null, 33),
 ('sk-emerald', 'skin', 'თემა „ზურმუხტი“', null, 2500, 0, null, 'shop', null, 40),
 ('sk-amethyst', 'skin', 'თემა „ამეთვისტო“', null, 2500, 0, null, 'shop', null, 41),
 ('sk-rose', 'skin', 'თემა „ვარდისფერი ოქრო“', null, 4000, 0, null, 'shop', null, 42),
 ('box-common', 'box', 'ჩვეულებრივი ყუთი', null, 300, 0, null, 'shop', null, 50),
 ('box-premium', 'box', 'პრემიუმ ყუთი', null, 1000, 0, null, 'shop', null, 51),
 -- box-only cosmetics (1 common, 2 rare, 3 epic, 4 legendary)
 ('fr-wood', 'frame', 'ხის ჩარჩო', null, null, 1, null, 'box', null, 60),
 ('nc-sky', 'color', 'ცისფერი სახელი', null, null, 1, null, 'box', null, 61),
 ('nc-mint', 'color', 'პიტნისფერი სახელი', null, null, 1, null, 'box', null, 62),
 ('ch-bubble', 'chat', 'ბუშტის შეტყობინება', null, null, 1, null, 'box', null, 63),
 ('ti-rookie', 'title', 'ტიტული', 'ახალბედა', null, 1, null, 'box', null, 64),
 ('fr-silver', 'frame', 'ვერცხლის ჩარჩო', null, null, 2, null, 'box', null, 65),
 ('nc-violet', 'color', 'იისფერი სახელი', null, null, 2, null, 'box', null, 66),
 ('ch-wave', 'chat', 'ტალღოვანი შეტყობინება', null, null, 2, null, 'box', null, 67),
 ('ti-shark', 'title', 'ტიტული', 'ზვიგენი', null, 2, null, 'box', null, 68),
 ('fr-aurora', 'frame', 'ავრორას ჩარჩო', null, null, 3, null, 'box', null, 69),
 ('nc-lava', 'color', 'ლავისფერი სახელი', null, null, 3, null, 'box', null, 70),
 ('ch-neon', 'chat', 'ნეონის შეტყობინება', null, null, 3, null, 'box', null, 71),
 ('ti-oracle', 'title', 'ტიტული', 'ორაკული', null, 3, null, 'box', null, 72),
 ('fr-dragon', 'frame', 'დრაკონის ჩარჩო', null, null, 4, null, 'box', null, 73),
 ('nc-galaxy', 'color', 'გალაქტიკის სახელი', null, null, 4, null, 'box', null, 74),
 ('ti-mythic', 'title', 'ტიტული', 'მითიური', null, 4, null, 'box', null, 75),
 ('sk-midnight', 'skin', 'თემა „შუაღამე“', null, null, 4, null, 'box', null, 76),
 -- season pass rewards
 ('fr-pass', 'frame', 'სეზონის ჩარჩო', null, null, 3, null, 'pass', null, 80),
 ('nc-pass', 'color', 'სეზონის ფერი', null, null, 3, null, 'pass', null, 81),
 ('ti-pass', 'title', 'ტიტული', 'სეზონის გმირი', null, 4, null, 'pass', null, 82),
 -- holidays
 ('fr-pumpkin', 'frame', 'გოგრის ჩარჩო', null, null, 3, null, 'token', 'halloween', 90),
 ('nc-pumpkin', 'color', 'გოგრისფერი სახელი', null, 1500, 0, null, 'shop', 'halloween', 91),
 ('sk-night', 'skin', 'თემა „ჰელოუინის ღამე“', null, 3000, 0, null, 'shop', 'halloween', 92),
 ('fr-snow', 'frame', 'თოვლის ჩარჩო', null, null, 3, null, 'token', 'newyear', 93),
 ('ch-snow', 'chat', 'თოვლიანი შეტყობინება', null, 1200, 0, null, 'shop', 'newyear', 94),
 ('sk-frost', 'skin', 'თემა „ყინვა“', null, 3000, 0, null, 'shop', 'newyear', 95)
on conflict (id) do nothing;

-- which holiday is on right now (admin can force one, or switch them off)
create or replace function zi.holiday() returns text language plpgsql stable as $$
declare t text := zi.cfg() ->> 'theme'; d date; md int;
begin
  if t in ('halloween', 'newyear') then return t; end if;
  if t = 'none' then return null; end if;
  d := (to_timestamp(zi.ms() / 1000.0) at time zone 'Asia/Tbilisi')::date;
  md := extract(month from d)::int * 100 + extract(day from d)::int;
  if md between 1024 and 1102 then return 'halloween'; end if;
  if md >= 1220 or md <= 107 then return 'newyear'; end if;
  return null;
end $$;

create or replace function zi.give_item(u uuid, it text, src text) returns boolean language plpgsql security definer set search_path = public, zi as $$
begin
  if exists (select 1 from public.inventory where user_id = u and item = it) and (select cat from public.items where id = it) <> 'box' then return false; end if;
  insert into public.inventory (user_id, item, src) values (u, it, src);
  return true;
end $$;

create or replace function public.buy_item(id text) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); it public.items; price bigint; xp bigint; ser int;
begin
  select * into it from public.items i where i.id = buy_item.id for update;
  if not found or it.src <> 'shop' or it.price is null then perform zi.err('unavailable'); end if;
  if it.ev is not null and zi.holiday() is distinct from it.ev then perform zi.err('unavailable'); end if;
  if it.cat <> 'box' and exists (select 1 from public.inventory where user_id = u and item = it.id) then perform zi.err('owned'); end if;
  if it.supply is not null and it.sold >= it.supply then perform zi.err('sold_out'); end if;
  select p.xp into xp from public.profiles p where p.id = u;
  price := floor(it.price * (100 - zi.vip_i(xp) * 5) / 100.0);
  perform zi.mv(u, 'shop', -price, 'sb', jsonb_build_object('i', it.id));
  if it.supply is not null then ser := it.sold + 1; end if;
  update public.items set sold = sold + 1 where items.id = it.id;
  insert into public.inventory (user_id, item, serial, src) values (u, it.id, ser, 'shop');
  if it.cat <> 'box' then
    update public.profiles set eq = jsonb_set(eq, array[it.cat], to_jsonb(it.id)) where profiles.id = u;
  end if;
  perform zi.st_add(u, 'shopN', 1);
  perform zi.ach(u, 'shopper');
  return jsonb_build_object('price', price, 'serial', ser);
end $$;

create or replace function public.equip(item text, on_ boolean) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); c text; e jsonb;
begin
  select cat into c from public.items where id = item;
  if c is null or c = 'box' then perform zi.err('not_found'); end if;
  if on_ then
    if not exists (select 1 from public.inventory where user_id = u and inventory.item = equip.item and not listed) then perform zi.err('not_owned'); end if;
    update public.profiles set eq = jsonb_set(eq, array[c], to_jsonb(item)) where id = u returning eq into e;
  else
    update public.profiles set eq = case when eq ->> c = item then eq - c else eq end where id = u returning eq into e;
  end if;
  return e;
end $$;

create or replace function public.open_box(box text) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); inv_id bigint; r numeric := random(); rar int; it text; dup boolean; refund bigint := 0;
begin
  select id into inv_id from public.inventory where user_id = u and item = box and not listed order by id limit 1 for update;
  if inv_id is null then perform zi.err('not_owned'); end if;
  delete from public.inventory where id = inv_id;
  rar := case when box = 'box-premium' then case when r < 0.35 then 1 when r < 0.75 then 2 when r < 0.95 then 3 else 4 end
              else case when r < 0.70 then 1 when r < 0.94 then 2 when r < 0.99 then 3 else 4 end end;
  select id into it from public.items where src = 'box' and rarity = rar order by random() limit 1;
  dup := exists (select 1 from public.inventory where user_id = u and item = it);
  if dup then
    refund := (array[60, 150, 400, 1200])[rar];
    perform zi.mv(u, 'box', refund, 'bxr', jsonb_build_object('i', it));
  else
    insert into public.inventory (user_id, item, src) values (u, it, 'box');
  end if;
  if zi.st_add(u, 'boxN', 1) >= 10 then perform zi.ach(u, 'boxer'); end if;
  perform zi.q_add(u, 'box');
  if rar = 4 then perform zi.feed(u, 'box', 0, jsonb_build_object('i', it)); end if;
  return jsonb_build_object('item', it, 'rarity', rar, 'dup', dup, 'refund', refund);
end $$;

/* ---------- auctions (players sell cosmetics to each other) ---------- */
create table if not exists public.auctions (
  id bigint generated always as identity primary key,
  seller uuid not null references public.profiles (id) on delete cascade,
  inv_id bigint not null, item text not null, serial int,
  start bigint not null, buyout bigint, bid bigint, bidder uuid,
  ends bigint not null, status text not null default 'open', at bigint not null default zi.ms()
);
create index if not exists auctions_open on public.auctions (status, ends);
create or replace function public.auction_create(inv_id bigint, start bigint, buyout bigint default null, hours int default 24) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); iv public.inventory; c text; a public.auctions;
begin
  if hours not in (1, 6, 24, 72) then perform zi.err('bad_hours'); end if;
  if start is null or start < 1 or (buyout is not null and buyout < start) then perform zi.err('bad_amount'); end if;
  select * into iv from public.inventory where id = inv_id and user_id = u for update;
  if not found or iv.listed then perform zi.err('not_owned'); end if;
  select cat into c from public.items where id = iv.item;
  update public.profiles set eq = case when eq ->> c = iv.item then eq - c else eq end where id = u;
  update public.inventory set listed = true where id = inv_id;
  insert into public.auctions (seller, inv_id, item, serial, start, buyout, ends)
  values (u, inv_id, iv.item, iv.serial, start, buyout, zi.ms() + hours * 3600000::bigint) returning * into a;
  return to_jsonb(a);
end $$;
create or replace function zi.auction_settle(aid bigint) returns void language plpgsql security definer set search_path = public, zi as $$
declare a public.auctions; fee bigint;
begin
  select * into a from public.auctions where id = aid for update;
  if not found or a.status <> 'open' then return; end if;
  if a.bidder is null then
    update public.auctions set status = 'expired' where id = aid;
    update public.inventory set listed = false where id = a.inv_id;
    perform zi.note(a.seller, 'aexp', null, jsonb_build_object('i', a.item));
    return;
  end if;
  update public.inventory set user_id = a.bidder, listed = false, src = 'auction', at = zi.ms() where id = a.inv_id;
  fee := floor(a.bid * zi.cfgn('{auction,fee}', 5) / 100.0);
  perform zi.mv(a.seller, 'auction', a.bid - fee, 'asold', jsonb_build_object('i', a.item, 'p', a.bidder));
  update public.auctions set status = 'sold' where id = aid;
  perform zi.note(a.seller, 'asold', a.bid - fee, jsonb_build_object('i', a.item, 'p', a.bidder));
  perform zi.note(a.bidder, 'awon', -a.bid, jsonb_build_object('i', a.item, 'p', a.seller));
  perform zi.ach(a.bidder, 'auction');
end $$;
create or replace function public.auction_bid(id bigint, amount bigint) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); a public.auctions; mn bigint;
begin
  select * into a from public.auctions x where x.id = auction_bid.id for update;
  if not found or a.status <> 'open' or a.ends <= zi.ms() then perform zi.err('closed'); end if;
  if a.seller = u then perform zi.err('own'); end if;
  if a.bidder = u then perform zi.err('top_already'); end if;
  mn := case when a.bid is null then a.start else ceil(a.bid * 1.05) end;
  if a.buyout is not null and amount > a.buyout then amount := a.buyout; end if;
  if amount < mn and not (a.buyout is not null and amount = a.buyout) then perform zi.err('bid_low'); end if;
  perform zi.mv(u, 'auction', -amount, 'abid', jsonb_build_object('a', a.id, 'i', a.item));
  if a.bidder is not null then
    perform zi.mv(a.bidder, 'auction', a.bid, 'aref', jsonb_build_object('a', a.id, 'i', a.item));
    perform zi.note(a.bidder, 'aout', a.bid, jsonb_build_object('a', a.id, 'i', a.item));
  end if;
  update public.auctions x set bid = amount, bidder = u, ends = case when x.ends - zi.ms() < 60000 then x.ends + 60000 else x.ends end
  where x.id = a.id returning * into a;
  if a.buyout is not null and amount >= a.buyout then perform zi.auction_settle(a.id); end if;
  return (select to_jsonb(x) from public.auctions x where x.id = a.id);
end $$;
create or replace function public.auction_cancel(id bigint) returns void language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); a public.auctions;
begin
  select * into a from public.auctions x where x.id = auction_cancel.id for update;
  if not found or a.seller <> u or a.status <> 'open' then perform zi.err('not_found'); end if;
  if a.bidder is not null then perform zi.err('has_bids'); end if;
  update public.auctions set status = 'cancel' where auctions.id = a.id;
  update public.inventory set listed = false where inventory.id = a.inv_id;
end $$;

/* ---------- bank deposits ---------- */
create table if not exists public.deposits (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  a bigint not null, days int not null, rate numeric not null, start bigint not null, ends bigint not null,
  status text not null default 'active', paid bigint
);
create or replace function public.bank_open(amount bigint, days int) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); rate numeric; d public.deposits;
begin
  if days not in (3, 7, 30) then perform zi.err('bad_days'); end if;
  if amount is null or amount < 10 then perform zi.err('bad_amount'); end if;
  rate := zi.cfgn(array['bank', days::text], case days when 3 then 8 when 7 then 22 else 110 end);
  perform zi.mv(u, 'bank', -amount, 'dp', jsonb_build_object('days', days, 'rate', rate));
  insert into public.deposits (user_id, a, days, rate, start, ends) values (u, amount, days, rate, zi.ms(), zi.ms() + days * 86400000::bigint) returning * into d;
  update public.profiles set dep = dep + amount where id = u;
  perform zi.q_add(u, 'bank');
  perform zi.ach(u, 'banker');
  return to_jsonb(d);
end $$;
create or replace function public.bank_close(id bigint) returns bigint language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); d public.deposits; pen bigint;
begin
  select * into d from public.deposits x where x.id = bank_close.id and x.user_id = u for update;
  if not found or d.status <> 'active' then perform zi.err('not_found'); end if;
  pen := ceil(d.a * zi.cfgn('{bank,pen}', 5) / 100.0);
  perform zi.mv(u, 'bank', d.a - pen, 'dpx', jsonb_build_object('pen', pen));
  update public.deposits set status = 'closed', paid = d.a - pen where deposits.id = d.id;
  update public.profiles set dep = greatest(0, dep - d.a) where profiles.id = u;
  return d.a - pen;
end $$;
create or replace function zi.bank_mature() returns void language plpgsql security definer set search_path = public, zi as $$
declare d record; i bigint;
begin
  for d in select * from public.deposits where status = 'active' and ends <= zi.ms() for update skip locked loop
    i := floor(d.a * d.rate / 100.0);
    perform zi.mv(d.user_id, 'bank', d.a + i, 'dpm', jsonb_build_object('i', i, 'days', d.days));
    update public.deposits set status = 'done', paid = d.a + i where id = d.id;
    update public.profiles set dep = greatest(0, dep - d.a) where id = d.user_id;
    perform zi.note(d.user_id, 'dpm', i, jsonb_build_object('a', d.a, 'days', d.days));
  end loop;
end $$;

/* ---------- season pass: a tier per 1 000 season XP ---------- */
create table if not exists public.pass_claims (
  user_id uuid not null references public.profiles (id) on delete cascade,
  sea int not null, tier int not null, at bigint not null default zi.ms(),
  primary key (user_id, sea, tier)
);
create or replace function public.claim_pass(tier int) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); sea int := coalesce((zi.cfg() -> 'season' ->> 'id')::int, 0); sxp bigint; coins bigint; it text; box text;
begin
  if tier < 1 or tier > 30 then perform zi.err('bad_tier'); end if;
  select p.sxp into sxp from public.profiles p where id = u;
  if sxp < tier * 1000 then perform zi.err('locked'); end if;
  insert into public.pass_claims (user_id, sea, tier) values (u, sea, tier) on conflict do nothing;
  if not found then perform zi.err('claimed'); end if;
  coins := tier * 50;
  perform zi.mv(u, 'pass', coins, 'pass', jsonb_build_object('t', tier));
  if tier % 5 = 0 then
    box := case when tier in (15, 25) then 'box-premium' else 'box-common' end;
    insert into public.inventory (user_id, item, src) values (u, box, 'pass');
  end if;
  it := case tier when 10 then 'fr-pass' when 20 then 'nc-pass' when 30 then 'ti-pass' end;
  if it is not null then perform zi.give_item(u, it, 'pass'); end if;
  if tier >= 10 then perform zi.ach(u, 'pass10'); end if;
  return jsonb_build_object('coins', coins, 'box', box, 'item', it);
end $$;

/* ---------- holiday tokens (pumpkins / snowflakes appear on the page; catch them) ---------- */
create or replace function public.collect_token() returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); h text := zi.holiday(); t jsonb; d int := zi.cur(); n int; amt bigint; cnt numeric; key text; it text; got boolean := false;
begin
  if h is null then perform zi.err('off'); end if;
  select tok into t from public.profile_priv where id = u for update;
  n := case when (t ->> 'd')::int = d then coalesce((t ->> 'n')::int, 0) else 0 end;
  if n >= 20 then perform zi.err('limit'); end if;
  if zi.ms() - coalesce((t ->> 'last')::bigint, 0) < 90000 then perform zi.err('wait'); end if;
  amt := 15 + floor(random() * 26);
  perform zi.mv(u, 'token', amt, 'tok', jsonb_build_object('h', h));
  update public.profile_priv set tok = jsonb_build_object('d', d, 'n', n + 1, 'last', zi.ms()) where id = u;
  key := case h when 'halloween' then 'pump' else 'snow' end;
  cnt := zi.st_add(u, key, 1);
  if cnt >= 30 then
    it := case h when 'halloween' then 'fr-pumpkin' else 'fr-snow' end;
    got := zi.give_item(u, it, 'token');
    perform zi.ach(u, case h when 'halloween' then 'pumpkin' else 'snowman' end);
  end if;
  return jsonb_build_object('amt', amt, 'cnt', cnt, 'left', 19 - n, 'item', case when got then it end);
end $$;

-- ===== 004_market.sql =====
-- ზარაფხანა · 004 · stock exchange, predictions, clans (wars, treasury, buffs), loans

/* ---------- stocks: prices move every 5 minutes (random walk + news) and with player demand ---------- */
create table if not exists public.stocks (
  t text primary key, name text not null, p0 numeric not null, vol numeric not null,
  base numeric not null, step bigint not null, held bigint not null default 0, ord int not null default 0
);
create table if not exists public.stock_hist (t text not null, step bigint not null, base numeric not null, primary key (t, step));
create table if not exists public.stock_news (
  id bigint generated always as identity primary key,
  t text not null, step bigint not null, up boolean not null, pct int not null, h text not null
);
create table if not exists public.holdings (
  user_id uuid not null references public.profiles (id) on delete cascade,
  t text not null references public.stocks (t), n bigint not null, c bigint not null,
  primary key (user_id, t)
);
insert into public.stocks (t, name, p0, vol, base, step, ord) values
 ('WINE', 'კახური ღვინის სახლი', 120, 0.011, 120, floor(zi.ms() / 300000.0) - 288, 1),
 ('TECH', 'ტექ-თბილისი', 85, 0.020, 85, floor(zi.ms() / 300000.0) - 288, 2),
 ('TEA', 'გურიის ჩაი', 42, 0.009, 42, floor(zi.ms() / 300000.0) - 288, 3),
 ('ENRG', 'მთის ენერგია', 150, 0.013, 150, floor(zi.ms() / 300000.0) - 288, 4),
 ('PORT', 'ბათუმის პორტი', 96, 0.012, 96, floor(zi.ms() / 300000.0) - 288, 5),
 ('GOLD', 'რაჭის ოქრო', 210, 0.008, 210, floor(zi.ms() / 300000.0) - 288, 6)
on conflict (t) do nothing;

create or replace function zi.stock_price(tk text) returns numeric language sql stable as $$
  select base * exp(0.001 * held) from public.stocks where t = tk
$$;
create or replace function zi.stock_tick() returns void language plpgsql security definer set search_path = public, zi as $$
declare
  now_step bigint := floor(zi.ms() / 300000.0); s record; st bigint; lb numeric; z numeric; up boolean; mag numeric;
  ups text[] := array['რეკორდული კვარტალური მოგება', 'ახალ საერთაშორისო ბაზარზე გასვლა', 'მსხვილი კონტრაქტი გაფორმდა', 'ინვესტორებმა წილი გაზარდეს'];
  dns text[] := array['პრობლემები მიწოდების ჯაჭვში', 'დირექტორი თანამდებობას ტოვებს', 'რეგულატორმა ჯარიმა დააკისრა', 'გაყიდვები მოლოდინზე დაბალია'];
begin
  for s in select * from public.stocks order by t for update loop
    st := greatest(s.step, now_step - 576);
    lb := ln(s.base);
    while st < now_step loop
      st := st + 1;
      z := (random() + random() + random() - 1.5) * 2;
      lb := lb + s.vol * z - 0.004 * (lb - ln(s.p0));
      if random() < 0.004 then
        up := random() < 0.5; mag := 0.05 + random() * 0.13;
        lb := lb + case when up then mag else -mag end;
        insert into public.stock_news (t, step, up, pct, h)
        values (s.t, st, up, round((exp(case when up then mag else -mag end) - 1) * 100),
                case when up then ups[1 + floor(random() * 4)::int] else dns[1 + floor(random() * 4)::int] end);
      end if;
      insert into public.stock_hist (t, step, base) values (s.t, st, exp(lb)) on conflict do nothing;
    end loop;
    if st <> s.step then update public.stocks set base = exp(lb), step = st where t = s.t; end if;
  end loop;
  delete from public.stock_hist where step < now_step - 600;
  delete from public.stock_news where id not in (select id from public.stock_news order by id desc limit 60);
end $$;

create or replace function public.buy_stock(tk text, n bigint) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); s public.stocks; cost bigint; have bigint;
begin
  perform zi.not_paused(u);
  if n is null or n < 1 or n > 1000 then perform zi.err('bad_amount'); end if;
  select * into s from public.stocks where t = tk for update;
  if not found then perform zi.err('not_found'); end if;
  select coalesce((select h.n from public.holdings h where h.user_id = u and h.t = tk), 0) into have;
  if have + n > 1000 then perform zi.err('stock_max'); end if;
  cost := ceil(n * s.base * exp(0.001 * (s.held + n / 2.0)) * 1.01);
  perform zi.mv(u, 'stock', -cost, 'sbuy', jsonb_build_object('t', tk, 'n', n));
  insert into public.holdings (user_id, t, n, c) values (u, tk, n, cost)
  on conflict (user_id, t) do update set n = holdings.n + excluded.n, c = holdings.c + excluded.c;
  update public.stocks set held = held + n where t = tk;
  perform zi.add_xp(u, cost / 2);
  perform zi.q_add(u, 'stock');
  return jsonb_build_object('cost', cost);
end $$;
create or replace function public.sell_stock(tk text, n bigint) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); s public.stocks; h public.holdings; pay bigint; basis bigint; pnl numeric;
begin
  if n is null or n < 1 then perform zi.err('bad_amount'); end if;
  select * into s from public.stocks where t = tk for update;
  select * into h from public.holdings where user_id = u and t = tk for update;
  if h.n is null or n > h.n then perform zi.err('not_owned'); end if;
  pay := floor(n * s.base * exp(0.001 * greatest(0, s.held - n / 2.0)) * 0.99);
  basis := round(h.c * n / h.n::numeric);
  perform zi.mv(u, 'stock', pay, 'ssell', jsonb_build_object('t', tk, 'n', n, 'pnl', pay - basis));
  if h.n = n then delete from public.holdings where user_id = u and t = tk;
  else update public.holdings set n = holdings.n - sell_stock.n, c = holdings.c - basis where user_id = u and t = tk; end if;
  update public.stocks set held = greatest(0, held - n) where t = tk;
  pnl := zi.st_add(u, 'stockPnl', pay - basis);
  if pnl >= 1000 then perform zi.ach(u, 'trader'); end if;
  return jsonb_build_object('pay', pay, 'pnl', pay - basis);
end $$;

/* ---------- predictions (admin asks, players bet, winners share the pool) ---------- */
create table if not exists public.predictions (
  id bigint generated always as identity primary key,
  q text not null, opts text[] not null, pools bigint[] not null, tot bigint not null default 0,
  close bigint not null, res int, at bigint not null default zi.ms(), res_at bigint
);
create table if not exists public.pred_bets (
  pred_id bigint not null references public.predictions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  o int not null, a bigint not null, paid bigint,
  primary key (pred_id, user_id)
);
create or replace function public.pred_bet(id bigint, o int, a bigint) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); p public.predictions; b public.pred_bets;
begin
  if a is null or a < 1 then perform zi.err('bad_amount'); end if;
  select * into p from public.predictions x where x.id = pred_bet.id for update;
  if not found or p.res is not null or p.close <= zi.ms() then perform zi.err('closed'); end if;
  if o < 0 or o >= array_length(p.opts, 1) then perform zi.err('bad_option'); end if;
  select * into b from public.pred_bets where pred_id = p.id and user_id = u;
  if found and b.o <> o then perform zi.err('one_option'); end if;
  perform zi.bet_check(u, a);
  perform zi.mv(u, 'pred', -a, 'pbet', jsonb_build_object('q', p.id));
  insert into public.pred_bets (pred_id, user_id, o, a) values (p.id, u, o, a)
  on conflict (pred_id, user_id) do update set a = pred_bets.a + excluded.a;
  update public.predictions x set pools[o + 1] = x.pools[o + 1] + a, tot = x.tot + a where x.id = p.id;
  perform zi.add_xp(u, a);
  return jsonb_build_object('ok', true);
end $$;
create or replace function public.admin_pred_create(q text, opts text[], hours int) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare p public.predictions; o text[];
begin
  perform zi.need_admin();
  select array_agg(left(trim(x), 40)) into o from unnest(opts) x where trim(x) <> '';
  if char_length(trim(coalesce(q, ''))) < 3 or coalesce(array_length(o, 1), 0) < 2 or array_length(o, 1) > 4 then perform zi.err('bad_pred'); end if;
  insert into public.predictions (q, opts, pools, close) values (left(trim(q), 140), o, array_fill(0::bigint, array[array_length(o, 1)]), zi.ms() + greatest(1, least(hours, 720)) * 3600000::bigint)
  returning * into p;
  return to_jsonb(p);
end $$;
create or replace function public.admin_pred_resolve(id bigint, res int) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare p public.predictions; b record; pay bigint; win_pool bigint; refund boolean; paid_n int := 0;
begin
  perform zi.need_admin();
  select * into p from public.predictions x where x.id = admin_pred_resolve.id for update;
  if not found or p.res is not null then perform zi.err('closed'); end if;
  refund := res < 0 or res >= array_length(p.opts, 1) or p.pools[res + 1] = 0;
  win_pool := case when refund then 0 else p.pools[res + 1] end;
  for b in select * from public.pred_bets where pred_id = p.id for update loop
    if refund then pay := b.a;
    elsif b.o = res then pay := floor(b.a::numeric / win_pool * p.tot * 95 / 100);
    else pay := 0; end if;
    if pay > 0 then perform zi.mv(b.user_id, 'pred', pay, case when refund then 'pref' else 'pwin' end, jsonb_build_object('q', p.id));
    else perform zi.mv(b.user_id, 'pred', 0, 'plose', jsonb_build_object('q', p.id, 'd', -b.a)); end if;
    update public.pred_bets set paid = pay where pred_id = p.id and user_id = b.user_id;
    perform zi.note(b.user_id, case when refund then 'pref' when pay > 0 then 'pwin' else 'plose' end, pay - case when refund then 0 else b.a end, jsonb_build_object('q', p.id));
    if pay > 0 and not refund then perform zi.ach(b.user_id, 'predictor'); paid_n := paid_n + 1; end if;
  end loop;
  update public.predictions x set res = case when refund then -1 else admin_pred_resolve.res end, res_at = zi.ms() where x.id = p.id;
  return jsonb_build_object('refund', refund, 'winners', paid_n);
end $$;

/* ---------- clans ---------- */
create table if not exists public.clans (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references public.profiles (id) on delete cascade,
  name text not null, tag text not null unique, color text not null default '#D9A23A',
  open boolean not null default true, descr text not null default '',
  treasury bigint not null default 0, buffs jsonb not null default '{}'::jsonb,
  at bigint not null default zi.ms()
);
create unique index if not exists clans_name_ci on public.clans (lower(name));
do $$ begin
  alter table public.profiles add constraint profiles_clan_fk foreign key (clan_id) references public.clans (id) on delete set null;
exception when duplicate_object then null; end $$;
create table if not exists public.clan_wars (
  w int not null, a uuid not null references public.clans (id) on delete cascade, b uuid references public.clans (id) on delete cascade,
  sa bigint not null default 0, sb bigint not null default 0, winner uuid, prize bigint, done boolean not null default false,
  primary key (w, a)
);

create or replace function zi.my_owned_clan(u uuid) returns public.clans language plpgsql security definer set search_path = public, zi as $$
declare c public.clans;
begin
  select * into c from public.clans where owner = u for update;
  if not found then perform zi.err('not_owner'); end if;
  return c;
end $$;
create or replace function public.clan_create(name text, tag text, color text, open boolean, descr text) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); c public.clans; tg text := left(regexp_replace(upper(coalesce(tag, '')), '[^A-Z0-9ა-ჰ]', '', 'g'), 4); nm text := left(trim(coalesce(name, '')), 30);
begin
  if exists (select 1 from public.profiles where id = u and clan_id is not null and not clan_pending) then perform zi.err('in_clan'); end if;
  if char_length(nm) < 2 or char_length(tg) < 2 then perform zi.err('bad_clan'); end if;
  if exists (select 1 from public.clans x where lower(x.name) = lower(nm) or x.tag = tg) then perform zi.err('clan_taken'); end if;
  perform zi.mv(u, 'clan', -500, 'cc', jsonb_build_object('n', nm));
  insert into public.clans (owner, name, tag, color, open, descr)
  values (u, nm, tg, coalesce(nullif(color, ''), '#D9A23A'), coalesce(clan_create.open, true), left(coalesce(descr, ''), 120)) returning * into c;
  update public.profiles set clan_id = c.id, clan_pending = false where id = u;
  return to_jsonb(c);
end $$;
create or replace function public.clan_join(id uuid) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); c public.clans;
begin
  if exists (select 1 from public.profiles where profiles.id = u and clan_id is not null and not clan_pending) then perform zi.err('in_clan'); end if;
  select * into c from public.clans x where x.id = clan_join.id;
  if not found then perform zi.err('not_found'); end if;
  update public.profiles set clan_id = c.id, clan_pending = not c.open where profiles.id = u;
  if not c.open then perform zi.note(c.owner, 'creq', null, jsonb_build_object('p', u)); end if;
  return jsonb_build_object('pending', not c.open);
end $$;
create or replace function public.clan_leave() returns void language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); c public.clans; m record; n int; share bigint;
begin
  select * into c from public.clans where owner = u for update;
  if found then
    select count(*) into n from public.profiles where clan_id = c.id and not clan_pending;
    share := case when n > 0 then c.treasury / n else 0 end;
    for m in select id from public.profiles where clan_id = c.id and not clan_pending loop
      if share > 0 then perform zi.mv(m.id, 'clan', share, 'cpay', jsonb_build_object('c', c.name)); end if;
      if m.id <> u then perform zi.note(m.id, 'cgone', share, jsonb_build_object('c', c.name)); end if;
    end loop;
    delete from public.clans where id = c.id;
  end if;
  update public.profiles set clan_id = null, clan_pending = false where id = u;
end $$;
create or replace function public.clan_approve(who uuid, yes boolean) returns void language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); c public.clans := zi.my_owned_clan(u);
begin
  if not exists (select 1 from public.profiles where id = who and clan_id = c.id and clan_pending) then perform zi.err('not_found'); end if;
  if yes then update public.profiles set clan_pending = false where id = who;
  else update public.profiles set clan_id = null, clan_pending = false where id = who; end if;
  perform zi.note(who, case when yes then 'cok' else 'cno' end, null, jsonb_build_object('c', c.name));
end $$;
create or replace function public.clan_kick(who uuid) returns void language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); c public.clans := zi.my_owned_clan(u);
begin
  if who = u then perform zi.err('bad_target'); end if;
  update public.profiles set clan_id = null, clan_pending = false where id = who and clan_id = c.id;
  if found then perform zi.note(who, 'ckick', null, jsonb_build_object('c', c.name)); end if;
end $$;
create or replace function public.clan_update(open boolean default null, descr text default null, color text default null) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); c public.clans := zi.my_owned_clan(u);
begin
  update public.clans x set open = coalesce(clan_update.open, x.open), descr = coalesce(left(clan_update.descr, 120), x.descr), color = coalesce(nullif(clan_update.color, ''), x.color)
  where x.id = c.id returning * into c;
  if c.open then update public.profiles set clan_pending = false where clan_id = c.id and clan_pending; end if;
  return to_jsonb(c);
end $$;
create or replace function public.clan_donate(amount bigint) returns bigint language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); cl uuid := zi.my_clan(); t bigint;
begin
  if cl is null then perform zi.err('no_clan'); end if;
  if amount is null or amount < 1 then perform zi.err('bad_amount'); end if;
  perform zi.mv(u, 'clan', -amount, 'cdon', jsonb_build_object('c', cl));
  update public.clans set treasury = treasury + amount where id = cl returning treasury into t;
  return t;
end $$;
create or replace function public.clan_payout() returns bigint language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); c public.clans := zi.my_owned_clan(u); n int; share bigint; m record;
begin
  select count(*) into n from public.profiles where clan_id = c.id and not clan_pending;
  share := c.treasury / greatest(n, 1);
  if share < 1 then perform zi.err('treasury_low'); end if;
  for m in select id from public.profiles where clan_id = c.id and not clan_pending loop
    perform zi.mv(m.id, 'clan', share, 'cpay', jsonb_build_object('c', c.name));
    if m.id <> u then perform zi.note(m.id, 'cpay', share, jsonb_build_object('c', c.name)); end if;
  end loop;
  update public.clans set treasury = treasury - share * n where id = c.id;
  return share;
end $$;
create or replace function public.clan_buff(k text) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); c public.clans := zi.my_owned_clan(u); cost bigint; until bigint;
begin
  cost := case k when 'xp10' then 2000 when 'bonus' then 1500 end;
  if cost is null then perform zi.err('not_found'); end if;
  if c.treasury < cost then perform zi.err('treasury_low'); end if;
  until := greatest(coalesce((c.buffs ->> k)::bigint, 0), zi.ms()) + 86400000;
  update public.clans set treasury = treasury - cost, buffs = jsonb_set(buffs, array[k], to_jsonb(until)) where id = c.id returning * into c;
  return to_jsonb(c);
end $$;

-- clan war score = XP earned this week by the clan's current members
create or replace function zi.clan_score(cl uuid, ww int) returns bigint language sql stable as $$
  select coalesce(sum(w.xp), 0)::bigint from public.weekly w join public.profiles p on p.id = w.user_id
  where p.clan_id = cl and not p.clan_pending and w.w = ww
$$;
create or replace function zi.wars_pair(ww int) returns void language plpgsql security definer set search_path = public, zi as $$
declare ids uuid[]; i int := 1;
begin
  if exists (select 1 from public.clan_wars where w = ww) then return; end if;
  select array_agg(id order by zi.clan_score(id, ww - 7) desc, treasury desc, id) into ids from public.clans c
  where (select count(*) from public.profiles p where p.clan_id = c.id and not p.clan_pending) >= 2;
  while ids is not null and i + 1 <= array_length(ids, 1) loop
    insert into public.clan_wars (w, a, b) values (ww, ids[i], ids[i + 1]) on conflict do nothing;
    i := i + 2;
  end loop;
end $$;
create or replace function zi.wars_resolve(ww int) returns void language plpgsql security definer set search_path = public, zi as $$
declare r record; vsa bigint; vsb bigint; win uuid; pz bigint := zi.cfgn('{clanWar,prize}', 1000)::bigint; m record;
begin
  for r in select * from public.clan_wars where w = ww and not done for update loop
    vsa := zi.clan_score(r.a, ww); vsb := case when r.b is null then 0 else zi.clan_score(r.b, ww) end;
    win := case when vsa > vsb then r.a when vsb > vsa then r.b end;
    update public.clan_wars set sa = vsa, sb = vsb, winner = win, prize = case when win is not null then pz end, done = true where w = ww and a = r.a;
    if win is not null and zi.cfgb('{clanWar,on}', true) then
      update public.clans set treasury = treasury + pz where id = win;
      for m in select id from public.profiles where clan_id = win and not clan_pending loop
        perform zi.note(m.id, 'cwar', pz, jsonb_build_object('w', ww));
        perform zi.ach(m.id, 'clanwar');
      end loop;
    end if;
  end loop;
end $$;
-- last week's best clan (by members' net game result): active members get a prize each
create or replace function zi.clan_prize(ww int) returns void language plpgsql security definer set search_path = public, zi as $$
declare pz bigint := zi.cfgn('{clanPrize}', 200)::bigint; top uuid; m record;
begin
  if pz <= 0 then return; end if;
  select p.clan_id into top from public.weekly w join public.profiles p on p.id = w.user_id
  where w.w = ww and p.clan_id is not null and not p.clan_pending group by p.clan_id having sum(w.net) > 0 order by sum(w.net) desc limit 1;
  if top is null then return; end if;
  for m in select p.id from public.profiles p join public.weekly w on w.user_id = p.id and w.w = ww where p.clan_id = top and not p.clan_pending and w.n > 0 loop
    perform zi.mv(m.id, 'clan', pz, 'cwin', jsonb_build_object('w', ww));
    perform zi.note(m.id, 'cwin', pz, jsonb_build_object('w', ww));
  end loop;
end $$;

/* ---------- loans between players ---------- */
create table if not exists public.loans (
  id bigint generated always as identity primary key,
  lender uuid not null references public.profiles (id) on delete cascade,
  borrower uuid not null references public.profiles (id) on delete cascade,
  a bigint not null, r int not null, d int not null, st text not null default 'open',
  at bigint not null default zi.ms(), ta bigint, due bigint, paid bigint, pa bigint
);
create index if not exists loans_parties on public.loans (lender, borrower);
create or replace function zi.owed(a bigint, r int) returns bigint language sql immutable as $$ select round(a * (1 + r / 100.0))::bigint $$;
create or replace function public.loan_offer(to_id uuid, a bigint, r int, days int) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); l public.loans;
begin
  if to_id is null or to_id = u or not exists (select 1 from public.profiles where id = to_id and not frozen) then perform zi.err('bad_target'); end if;
  if a is null or a < 1 then perform zi.err('bad_amount'); end if;
  r := least(greatest(coalesce(r, 0), 0), 50); days := least(greatest(coalesce(days, 1), 1), 14);
  perform zi.mv(u, 'loan', -a, 'lnout', jsonb_build_object('p', to_id));
  update public.profiles set lent = lent + a where id = u;
  insert into public.loans (lender, borrower, a, r, d) values (u, to_id, a, r, days) returning * into l;
  perform zi.note(to_id, 'lnoffer', a, jsonb_build_object('p', u, 'r', r, 'd', days, 'id', l.id));
  return to_jsonb(l);
end $$;
create or replace function public.loan_accept(id bigint) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); l public.loans;
begin
  select * into l from public.loans x where x.id = loan_accept.id for update;
  if not found or l.borrower <> u or l.st <> 'open' then perform zi.err('closed'); end if;
  perform zi.mv(u, 'loan', l.a, 'lnin', jsonb_build_object('p', l.lender));
  update public.loans x set st = 'active', ta = zi.ms(), due = zi.ms() + l.d * 86400000::bigint where x.id = l.id returning * into l;
  perform zi.note(l.lender, 'lnacc', null, jsonb_build_object('p', u, 'a', l.a));
  return to_jsonb(l);
end $$;
create or replace function public.loan_decline(id bigint) returns void language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); l public.loans;
begin
  select * into l from public.loans x where x.id = loan_decline.id for update;
  if not found or l.st <> 'open' or u not in (l.lender, l.borrower) then perform zi.err('closed'); end if;
  update public.loans x set st = 'cancel', pa = zi.ms() where x.id = l.id;
  perform zi.mv(l.lender, 'loan', l.a, 'lnback', jsonb_build_object('p', l.borrower));
  update public.profiles set lent = greatest(0, lent - l.a) where profiles.id = l.lender;
  if u = l.borrower then perform zi.note(l.lender, 'lndec', l.a, jsonb_build_object('p', u)); end if;
end $$;
create or replace function zi.loan_close(lid bigint, auto boolean) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare l public.loans; owed bigint; pay bigint; res text;
begin
  select * into l from public.loans where id = lid for update;
  if not found or l.st <> 'active' then perform zi.err('closed'); end if;
  owed := zi.owed(l.a, l.r);
  pay := least(owed, (select balance from public.profiles where id = l.borrower));
  if not auto and pay < owed then perform zi.err('insufficient'); end if;
  res := case when pay >= owed then 'done' else 'default' end;
  perform zi.mv(l.borrower, 'loan', -pay, case when res = 'done' then 'lnpay' else 'lndef' end, jsonb_build_object('p', l.lender));
  perform zi.mv(l.lender, 'loan', pay, case when res = 'done' then 'lnrec' else 'lnlost' end, jsonb_build_object('p', l.borrower));
  update public.profiles set lent = greatest(0, lent - l.a) where id = l.lender;
  update public.loans set st = res, paid = pay, pa = zi.ms() where id = lid;
  perform zi.st_add(l.borrower, case when res = 'done' then 'loanOk' else 'loanDef' end, 1);
  perform zi.note(l.lender, case when res = 'done' then 'lnrec' else 'lnlost' end, pay, jsonb_build_object('p', l.borrower));
  if auto then perform zi.note(l.borrower, case when res = 'done' then 'lnauto' else 'lndef' end, -pay, jsonb_build_object('p', l.lender)); end if;
  return jsonb_build_object('st', res, 'pay', pay);
end $$;
create or replace function public.loan_repay(id bigint) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me();
begin
  if not exists (select 1 from public.loans x where x.id = loan_repay.id and x.borrower = u) then perform zi.err('closed'); end if;
  return zi.loan_close(loan_repay.id, false);
end $$;
create or replace function zi.loans_tick() returns void language plpgsql security definer set search_path = public, zi as $$
declare l record;
begin
  for l in select id from public.loans where st = 'active' and due <= zi.ms() loop
    perform zi.loan_close(l.id, true);
  end loop;
  for l in select * from public.loans where st = 'open' and at < zi.ms() - 72 * 3600000::bigint for update skip locked loop
    update public.loans set st = 'cancel', pa = zi.ms() where id = l.id;
    perform zi.mv(l.lender, 'loan', l.a, 'lnback', jsonb_build_object('p', l.borrower));
    update public.profiles set lent = greatest(0, lent - l.a) where id = l.lender;
  end loop;
end $$;

-- ===== 005_games.sql =====
-- ზარაფხანა · 005 · games: provably fair RNG, play limits, 12 server-side games, duels, personal stats

/* ---------- provably fair seeds: result = HMAC-SHA256(server seed, "client:nonce:round") ---------- */
create table if not exists zi.fair_secret (user_id uuid primary key, seed text not null);
create table if not exists public.fair (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  hash text not null, client text not null, nonce bigint not null default 0,
  prev_seed text, prev_hash text, prev_client text, prev_nonce bigint
);
create table if not exists public.fair_seeds (
  user_id uuid not null references public.profiles (id) on delete cascade,
  hash text primary key, seed text not null, client text, nonce bigint, at bigint not null default zi.ms()
);
create or replace function zi.sha(t text) returns text language sql immutable as $$
  select encode(extensions.digest(convert_to(t, 'UTF8'), 'sha256'), 'hex')
$$;
create or replace function zi.fair_init(u uuid) returns void language plpgsql security definer set search_path = public, zi, extensions as $$
declare s text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  insert into zi.fair_secret (user_id, seed) values (u, s) on conflict do nothing;
  if found then
    insert into public.fair (user_id, hash, client) values (u, zi.sha(s), encode(extensions.gen_random_bytes(8), 'hex'))
    on conflict (user_id) do update set hash = excluded.hash, nonce = 0;
  end if;
end $$;
create or replace function zi.floats(seed text, client text, nonce bigint, cnt int) returns float8[] language plpgsql immutable as $$
declare o float8[] := '{}'; r int := 0; h bytea; j int;
begin
  while coalesce(array_length(o, 1), 0) < cnt loop
    h := extensions.hmac(convert_to(client || ':' || nonce || ':' || r, 'UTF8'), convert_to(seed, 'UTF8'), 'sha256');
    for j in 0..7 loop
      o := o || (get_byte(h, 4 * j)::float8 / 256 + get_byte(h, 4 * j + 1)::float8 / 65536
               + get_byte(h, 4 * j + 2)::float8 / 16777216 + get_byte(h, 4 * j + 3)::float8 / 4294967296);
    end loop;
    r := r + 1;
  end loop;
  return o[1:cnt];
end $$;
create or replace function public.fair_rotate(new_client text default null) returns jsonb language plpgsql security definer set search_path = public, zi, extensions as $$
declare u uuid := zi.me(); old text; s text := encode(extensions.gen_random_bytes(32), 'hex'); f public.fair;
begin
  if exists (select 1 from public.games where user_id = u and status = 'active') then perform zi.err('active_game'); end if;
  select seed into old from zi.fair_secret where user_id = u for update;
  update public.fair x set prev_seed = old, prev_hash = x.hash, prev_client = x.client, prev_nonce = x.nonce,
    hash = zi.sha(s), client = coalesce(nullif(left(trim(coalesce(new_client, '')), 32), ''), encode(extensions.gen_random_bytes(8), 'hex')), nonce = 0
  where x.user_id = u returning * into f;
  insert into public.fair_seeds (user_id, hash, seed, client, nonce) values (u, f.prev_hash, old, f.prev_client, f.prev_nonce) on conflict do nothing;
  update zi.fair_secret set seed = s where user_id = u;
  return to_jsonb(f);
end $$;

/* ---------- play limits: daily loss / wager caps and self-exclusion ---------- */
create or replace function zi.bet_check(u uuid, amount bigint) returns void language plpgsql security definer set search_path = public, zi as $$
declare pr public.profile_priv; vl jsonb; dy jsonb; d int := zi.cur(); k text; mb numeric := zi.cfgn('{maxBet}', 0);
begin
  if amount is null or amount < 1 then perform zi.err('bad_amount'); end if;
  if mb > 0 and amount > mb then perform zi.err('max_bet'); end if;
  select * into pr from public.profile_priv where id = u for update;
  vl := pr.lim; dy := pr.day;
  if (vl ->> 'pause')::bigint > zi.ms() then perform zi.err('paused'); end if;
  foreach k in array array['loss', 'wager'] loop
    if vl -> 'pend' -> k is not null and (vl -> 'pend' -> k ->> 'at')::bigint <= zi.ms() then
      vl := jsonb_set(vl, array[k], coalesce(vl -> 'pend' -> k -> 'v', 'null'::jsonb));
      vl := jsonb_set(vl, '{pend}', (vl -> 'pend') - k);
    end if;
  end loop;
  if (dy ->> 'd')::int is distinct from d then dy := jsonb_build_object('d', d, 'w', 0, 'n', 0); end if;
  if (vl ->> 'wager') is not null and (dy ->> 'w')::bigint + amount > (vl ->> 'wager')::bigint then perform zi.err('lim_wager'); end if;
  if (vl ->> 'loss') is not null and greatest(0, -(dy ->> 'n')::bigint) + amount > (vl ->> 'loss')::bigint then perform zi.err('lim_loss'); end if;
  dy := jsonb_set(dy, '{w}', to_jsonb((dy ->> 'w')::bigint + amount));
  update public.profile_priv set lim = vl, day = dy where id = u;
end $$;
create or replace function zi.day_net(u uuid, net bigint) returns void language plpgsql security definer set search_path = public, zi as $$
declare d int := zi.cur();
begin
  update public.profile_priv set day = case when (day ->> 'd')::int = d
      then jsonb_set(day, '{n}', to_jsonb(coalesce((day ->> 'n')::bigint, 0) + net))
      else jsonb_build_object('d', d, 'w', 0, 'n', net) end
  where id = u;
end $$;
create or replace function public.my_limits() returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); pr public.profile_priv;
begin
  select * into pr from public.profile_priv where id = u;
  return jsonb_build_object('lim', pr.lim, 'day', case when (pr.day ->> 'd')::int = zi.cur() then pr.day else jsonb_build_object('d', zi.cur(), 'w', 0, 'n', 0) end);
end $$;
-- lowering a limit applies at once; raising or removing it waits 24 hours
create or replace function public.set_limits(loss bigint, wager bigint) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); vl jsonb; k text; v bigint; c bigint; pend jsonb;
begin
  select pp.lim into vl from public.profile_priv pp where id = u for update;
  pend := coalesce(vl -> 'pend', '{}'::jsonb);
  foreach k in array array['loss', 'wager'] loop
    v := case k when 'loss' then loss else wager end;
    if v is not null and v < 1 then v := null; end if;
    c := (vl ->> k)::bigint;
    if v is not distinct from c then pend := pend - k; continue; end if;
    if v is not null and (c is null or v < c) then
      vl := jsonb_set(vl, array[k], to_jsonb(v)); pend := pend - k;
    else
      pend := jsonb_set(pend, array[k], jsonb_build_object('v', to_jsonb(v), 'at', zi.ms() + 86400000));
    end if;
  end loop;
  vl := jsonb_set(vl, '{pend}', pend);
  update public.profile_priv set lim = vl where id = u;
  return vl;
end $$;
create or replace function public.pause_play(hours int) returns bigint language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); p bigint;
begin
  if hours not in (24, 168, 720) then perform zi.err('bad_hours'); end if;
  update public.profile_priv set lim = jsonb_set(lim, '{pause}', to_jsonb(greatest(coalesce((lim ->> 'pause')::bigint, 0), zi.ms() + hours * 3600000::bigint)))
  where id = u returning (lim ->> 'pause')::bigint into p;
  return p;
end $$;

/* ---------- games ---------- */
create table if not exists public.games (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  g text not null, bet bigint not null, pay bigint, status text not null default 'active',
  nonce bigint, hash text, client text, params jsonb, res jsonb,
  at bigint not null default zi.ms(), done bigint
);
create index if not exists games_user on public.games (user_id, id desc);
create index if not exists games_active on public.games (g, status) where status = 'active';
create table if not exists zi.game_secret (game_id bigint primary key, seed text, data jsonb);

-- take the bet, draw the provably fair numbers, open the game
create or replace function zi.game_begin(u uuid, g text, bet bigint, params jsonb, cnt int, out gid bigint, out f float8[]) language plpgsql security definer set search_path = public, zi as $$
declare s text; c text; n bigint; h text;
begin
  perform zi.bet_check(u, bet);
  perform zi.mv(u, 'game', -bet, 'gb', jsonb_build_object('g', g));
  update public.fair x set nonce = x.nonce + 1 where x.user_id = u returning x.client, x.nonce - 1, x.hash into c, n, h;
  select fs.seed into s from zi.fair_secret fs where fs.user_id = u;
  f := zi.floats(s, c, n, cnt);
  insert into public.games (user_id, g, bet, nonce, hash, client, params) values (u, g, bet, n, h, c, params) returning id into gid;
  insert into zi.game_secret (game_id, seed) values (gid, s);
end $$;

-- settle a game: payout, stats, XP, quests, weekly tournament, events, achievements, feed
create or replace function zi.game_end(gid bigint, pay bigint, res jsonb, unlock text default null) returns bigint language plpgsql security definer set search_path = public, zi as $$
declare gm public.games; net bigint; m numeric; games_n numeric; cb bigint;
begin
  select * into gm from public.games where id = gid for update;
  if not found or gm.status <> 'active' then return null; end if;
  pay := greatest(0, coalesce(pay, 0));
  net := pay - gm.bet;
  m := round(pay::numeric / nullif(gm.bet, 0), 2);
  update public.games set status = 'done', pay = game_end.pay, res = game_end.res, done = zi.ms() where id = gid;
  perform zi.mv(gm.user_id, 'game', pay, 'g', jsonb_build_object('g', gm.g, 'bet', gm.bet, 'net', net, 'm', m, 'id', gid, 'd', net));
  perform zi.weekly_add(gm.user_id, net, gm.bet, 1, 0, 0);
  perform zi.st_add(gm.user_id, 'game', net);
  games_n := zi.st_add(gm.user_id, 'games', 1);
  perform zi.st_max(gm.user_id, 'best', net);
  perform zi.add_xp(gm.user_id, gm.bet);
  perform zi.q_add(gm.user_id, 'game', jsonb_build_object('g', gm.g, 'bet', gm.bet, 'win', pay));
  perform zi.day_net(gm.user_id, net);
  if net < 0 and zi.ev_on('cash10') then
    cb := floor(-net * 0.1);
    if cb > 0 then perform zi.mv(gm.user_id, 'event', cb, 'cb', jsonb_build_object('g', gm.g)); end if;
  end if;
  if games_n >= 10 then perform zi.ach(gm.user_id, 'games10'); end if;
  if games_n >= 100 then perform zi.ach(gm.user_id, 'games100'); end if;
  if unlock is not null then perform zi.ach(gm.user_id, unlock); end if;
  if net >= 1000 or (m >= 10 and net >= 100) then perform zi.feed(gm.user_id, 'g', net, jsonb_build_object('g', gm.g, 'm', m)); end if;
  return pay;
end $$;
create or replace function zi.bal(u uuid) returns bigint language sql stable as $$ select balance from public.profiles where id = u $$;
create or replace function zi.gout(gid bigint, extra jsonb) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare gm public.games;
begin
  select * into gm from public.games where id = gid;
  return extra || jsonb_build_object('id', gid, 'bet', gm.bet, 'pay', gm.pay, 'status', gm.status, 'nonce', gm.nonce, 'hash', gm.hash, 'bal', zi.bal(gm.user_id), 'now', zi.ms());
end $$;

/* coin flip ×1.94 */
create or replace function public.game_flip(bet bigint, side text) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); gb record; r text; pay bigint;
begin
  if side not in ('z', 'b') then perform zi.err('bad_params'); end if;
  select * into gb from zi.game_begin(u, 'flip', bet, jsonb_build_object('side', side), 1);
  r := case when gb.f[1] < 0.5 then 'z' else 'b' end;
  pay := case when r = side then floor(bet * 1.94) else 0 end;
  perform zi.game_end(gb.gid, pay, jsonb_build_object('r', r));
  return zi.gout(gb.gid, jsonb_build_object('r', r));
end $$;

/* wheel of fortune, 10 sectors */
create or replace function public.game_wheel(bet bigint) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); gb record; seg numeric[] := array[0, 1.5, 0.5, 2, 0, 1.2, 0.3, 3, 0, 1.2]; idx int;
begin
  select * into gb from zi.game_begin(u, 'wheel', bet, '{}'::jsonb, 1);
  idx := floor(gb.f[1] * 10)::int;
  perform zi.game_end(gb.gid, floor(bet * seg[idx + 1])::bigint, jsonb_build_object('idx', idx, 'm', seg[idx + 1]));
  return zi.gout(gb.gid, jsonb_build_object('idx', idx, 'm', seg[idx + 1]));
end $$;

/* dice: roll 0.00–99.99 over/under a target */
create or replace function public.game_dice(bet bigint, target numeric, dir text) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); gb record; roll numeric; chance numeric; mult numeric; win boolean;
begin
  if dir not in ('u', 'o') or target is null or target < 2 or target > 98 then perform zi.err('bad_params'); end if;
  target := round(target, 2);
  chance := case when dir = 'u' then target else 99.99 - target end;
  mult := floor(97 / chance * 100) / 100;
  select * into gb from zi.game_begin(u, 'dice', bet, jsonb_build_object('t', target, 'dir', dir), 1);
  roll := floor(gb.f[1] * 10000) / 100;
  win := case when dir = 'u' then roll < target else roll > target end;
  perform zi.game_end(gb.gid, case when win then floor(bet * mult)::bigint else 0 end, jsonb_build_object('roll', roll, 'm', mult),
                      case when win and chance < 10 then 'dice_sniper' end);
  return zi.gout(gb.gid, jsonb_build_object('roll', roll, 'm', mult, 'win', win));
end $$;

/* plinko, 10 rows */
create or replace function public.game_plinko(bet bigint, risk text) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); gb record; tbl numeric[]; path int[] := '{}'; bin int := 0; i int; m numeric;
begin
  tbl := case risk when 'low' then array[10, 3, 1.4, 1.1, 1, 0.4, 1, 1.1, 1.4, 3, 10]
                   when 'med' then array[22, 5, 2, 1.3, 0.6, 0.4, 0.6, 1.3, 2, 5, 22]
                   when 'high' then array[76, 10, 3, 0.8, 0.3, 0.2, 0.3, 0.8, 3, 10, 76] end;
  if tbl is null then perform zi.err('bad_params'); end if;
  select * into gb from zi.game_begin(u, 'plinko', bet, jsonb_build_object('risk', risk), 10);
  for i in 1..10 loop
    path := path || (case when gb.f[i] >= 0.5 then 1 else 0 end);
    bin := bin + (case when gb.f[i] >= 0.5 then 1 else 0 end);
  end loop;
  m := tbl[bin + 1];
  perform zi.game_end(gb.gid, floor(bet * m)::bigint, jsonb_build_object('path', to_jsonb(path), 'bin', bin, 'm', m),
                      case when bin in (0, 10) then 'plinko_edge' end);
  return zi.gout(gb.gid, jsonb_build_object('path', to_jsonb(path), 'bin', bin, 'm', m));
end $$;

/* european roulette: bets = {"n17": 50, "rd": 20, ...} */
create or replace function zi.ru_hit(k text, n int) returns int language sql immutable as $$
  select case
    when k ~ '^n([0-9]|[12][0-9]|3[0-6])$' then case when substr(k, 2)::int = n then 36 else 0 end
    when k = 'd1' then case when n between 1 and 12 then 3 else 0 end
    when k = 'd2' then case when n between 13 and 24 then 3 else 0 end
    when k = 'd3' then case when n between 25 and 36 then 3 else 0 end
    when k = 'lo' then case when n between 1 and 18 then 2 else 0 end
    when k = 'hi' then case when n between 19 and 36 then 2 else 0 end
    when k = 'ev' then case when n > 0 and n % 2 = 0 then 2 else 0 end
    when k = 'od' then case when n % 2 = 1 then 2 else 0 end
    when k = 'rd' then case when n = any (array[1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]) then 2 else 0 end
    when k = 'bk' then case when n > 0 and not (n = any (array[1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36])) then 2 else 0 end
    else -1 end
$$;
create or replace function public.game_roulette(bets jsonb) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); gb record; tot bigint := 0; e record; num int; win bigint := 0;
begin
  if jsonb_typeof(bets) <> 'object' then perform zi.err('bad_params'); end if;
  for e in select key, value from jsonb_each(bets) loop
    if zi.ru_hit(e.key, 0) < 0 or jsonb_typeof(e.value) <> 'number' then perform zi.err('bad_params'); end if;
    if (e.value::text)::numeric < 1 or (e.value::text)::numeric <> floor((e.value::text)::numeric) then perform zi.err('bad_params'); end if;
    tot := tot + (e.value::text)::bigint;
  end loop;
  if tot < 1 then perform zi.err('bad_amount'); end if;
  select * into gb from zi.game_begin(u, 'roulette', tot, jsonb_build_object('bets', bets), 1);
  num := floor(gb.f[1] * 37)::int;
  for e in select key, value from jsonb_each(bets) loop
    win := win + (e.value::text)::bigint * zi.ru_hit(e.key, num);
  end loop;
  perform zi.game_end(gb.gid, win, jsonb_build_object('num', num));
  return zi.gout(gb.gid, jsonb_build_object('num', num, 'win', win));
end $$;

/* slot: three reels, one line */
create or replace function public.game_slot(bet bigint) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); gb record; cum int[] := array[1, 3, 6, 10, 15, 22]; pays numeric[] := array[100, 50, 25, 15, 10, 8];
        res int[] := '{}'; i int; j int; r int; m numeric := 0; z int;
begin
  select * into gb from zi.game_begin(u, 'slot', bet, '{}'::jsonb, 3);
  for i in 1..3 loop
    r := floor(gb.f[i] * 22)::int;
    z := 0;
    while r >= cum[z + 1] loop z := z + 1; end loop;
    res := res || z;
  end loop;
  if res[1] = res[2] and res[2] = res[3] then m := pays[res[1] + 1];
  else
    z := (res[1] = 1)::int + (res[2] = 1)::int + (res[3] = 1)::int;
    m := case z when 2 then 5 when 1 then 1.2 else 0 end;
  end if;
  perform zi.game_end(gb.gid, floor(bet * m)::bigint, jsonb_build_object('reels', to_jsonb(res), 'm', m));
  return zi.gout(gb.gid, jsonb_build_object('reels', to_jsonb(res), 'm', m));
end $$;

/* keno: pick 1–10 of 40, 10 are drawn */
create or replace function public.game_keno(bet bigint, picks int[]) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); gb record; pool int[]; drawn int[] := '{}'; i int; j int; hits int; k int; m numeric;
  tbl jsonb := '{"1":{"1":3.8},"2":{"1":1,"2":10},"3":{"2":3.5,"3":40},"4":{"2":2,"3":8,"4":90},"5":{"2":1,"3":4,"4":30,"5":250},
                 "6":{"3":4,"4":12,"5":75,"6":700},"7":{"3":2,"4":6,"5":40,"6":250,"7":2000},"8":{"3":1,"4":4,"5":20,"6":100,"7":600,"8":3000},
                 "9":{"4":4,"5":12,"6":50,"7":300,"8":2000,"9":8000},"10":{"4":2,"5":8,"6":30,"7":150,"8":800,"9":4000,"10":10000}}';
begin
  k := coalesce(array_length(picks, 1), 0);
  if k < 1 or k > 10 or (select count(distinct x) from unnest(picks) x where x between 1 and 40) <> k then perform zi.err('bad_params'); end if;
  select * into gb from zi.game_begin(u, 'keno', bet, jsonb_build_object('picks', to_jsonb(picks)), 10);
  pool := array(select generate_series(1, 40));
  for i in 0..9 loop
    j := floor(gb.f[i + 1] * (40 - i))::int + 1;
    drawn := drawn || pool[j];
    pool := pool[1:j - 1] || pool[j + 1:];
  end loop;
  select count(*) into hits from unnest(drawn) d where d = any (picks);
  m := coalesce((tbl -> k::text ->> hits::text)::numeric, 0);
  perform zi.game_end(gb.gid, floor(bet * m)::bigint, jsonb_build_object('drawn', to_jsonb(drawn), 'hits', hits, 'm', m));
  return zi.gout(gb.gid, jsonb_build_object('drawn', to_jsonb(drawn), 'hits', hits, 'm', m));
end $$;

/* ---------- multi-step games: the hidden layout lives server-side until the game ends ---------- */
create or replace function zi.active_game(u uuid, gid bigint, gname text, out gm public.games, out sec jsonb) language plpgsql security definer set search_path = public, zi as $$
begin
  select * into gm from public.games where id = gid and user_id = u and g = gname for update;
  if not found then perform zi.err('not_found'); end if;
  if gm.status <> 'active' then perform zi.err('game_over'); end if;
  select data into sec from zi.game_secret where game_id = gid for update;
end $$;

/* mines: 5×5, 1/3/5/10 mines */
create or replace function zi.mines_mult(n int, k int) returns float8 language plpgsql immutable as $$
declare x float8 := 0.97; i int;
begin
  for i in 0..k - 1 loop x := x * (25 - i)::float8 / (25 - n - i); end loop;
  return x;
end $$;
create or replace function public.game_mines_start(bet bigint, mines int) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); gb record; pool int[]; bombs int[] := '{}'; i int; j int;
begin
  if mines not in (1, 3, 5, 10) then perform zi.err('bad_params'); end if;
  if exists (select 1 from public.games x where x.user_id = u and x.g = 'mines' and x.status = 'active') then perform zi.err('active_game'); end if;
  select * into gb from zi.game_begin(u, 'mines', bet, jsonb_build_object('mines', mines), mines);
  pool := array(select generate_series(0, 24));
  for i in 0..mines - 1 loop
    j := floor(gb.f[i + 1] * (25 - i))::int + 1;
    bombs := bombs || pool[j];
    pool := pool[1:j - 1] || pool[j + 1:];
  end loop;
  update zi.game_secret set data = jsonb_build_object('bombs', to_jsonb(bombs), 'open', '[]'::jsonb) where game_id = gb.gid;
  return zi.gout(gb.gid, jsonb_build_object('mines', mines));
end $$;
create or replace function public.game_mines_pick(id bigint, cell int) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); a record; n int; opened jsonb; k int; mult float8;
begin
  select * into a from zi.active_game(u, id, 'mines');
  if cell < 0 or cell > 24 or a.sec -> 'open' @> to_jsonb(cell) then perform zi.err('bad_params'); end if;
  n := ((a.gm).params ->> 'mines')::int;
  if a.sec -> 'bombs' @> to_jsonb(cell) then
    perform zi.game_end(id, 0, a.sec || jsonb_build_object('hit', cell));
    return zi.gout(id, jsonb_build_object('boom', true, 'bombs', a.sec -> 'bombs', 'hit', cell));
  end if;
  opened := (a.sec -> 'open') || to_jsonb(cell);
  k := jsonb_array_length(opened);
  mult := zi.mines_mult(n, k);
  update zi.game_secret set data = jsonb_set(data, '{open}', opened) where game_id = id;
  if k = 25 - n then
    perform zi.game_end(id, floor((a.gm).bet * mult)::bigint, a.sec || jsonb_build_object('open', opened), case when mult >= 5 then 'mines5' end);
    return zi.gout(id, jsonb_build_object('boom', false, 'k', k, 'mult', mult, 'bombs', a.sec -> 'bombs', 'done', true));
  end if;
  return zi.gout(id, jsonb_build_object('boom', false, 'k', k, 'mult', mult));
end $$;
create or replace function public.game_mines_cash(id bigint) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); a record; k int; mult float8;
begin
  select * into a from zi.active_game(u, id, 'mines');
  k := jsonb_array_length(a.sec -> 'open');
  if k < 1 then perform zi.err('pick_first'); end if;
  mult := zi.mines_mult(((a.gm).params ->> 'mines')::int, k);
  perform zi.game_end(id, floor((a.gm).bet * mult)::bigint, a.sec, case when mult >= 5 then 'mines5' end);
  return zi.gout(id, jsonb_build_object('mult', mult, 'bombs', a.sec -> 'bombs'));
end $$;

/* tower: 8 floors, one trap per floor among 4 / 3 / 2 tiles */
create or replace function zi.tower_mult(n int, f int) returns numeric language sql immutable as $$
  select floor(0.97 * power(n::numeric / (n - 1), f) * 100) / 100
$$;
create or replace function public.game_tower_start(bet bigint, diff text) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); gb record; n int; traps int[] := '{}'; i int;
begin
  n := case diff when 'easy' then 4 when 'mid' then 3 when 'hard' then 2 end;
  if n is null then perform zi.err('bad_params'); end if;
  if exists (select 1 from public.games x where x.user_id = u and x.g = 'tower' and x.status = 'active') then perform zi.err('active_game'); end if;
  select * into gb from zi.game_begin(u, 'tower', bet, jsonb_build_object('diff', diff, 'n', n), 8);
  for i in 1..8 loop traps := traps || floor(gb.f[i] * n)::int; end loop;
  update zi.game_secret set data = jsonb_build_object('traps', to_jsonb(traps), 'picks', '[]'::jsonb) where game_id = gb.gid;
  return zi.gout(gb.gid, jsonb_build_object('n', n));
end $$;
create or replace function public.game_tower_pick(id bigint, col int) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); a record; n int; fl int; picks jsonb; mult numeric;
begin
  select * into a from zi.active_game(u, id, 'tower');
  n := ((a.gm).params ->> 'n')::int;
  picks := a.sec -> 'picks';
  fl := jsonb_array_length(picks);
  if col < 0 or col >= n then perform zi.err('bad_params'); end if;
  if (a.sec -> 'traps' ->> fl)::int = col then
    perform zi.game_end(id, 0, a.sec || jsonb_build_object('hit', col));
    return zi.gout(id, jsonb_build_object('trap', true, 'traps', a.sec -> 'traps', 'floor', fl));
  end if;
  picks := picks || to_jsonb(col); fl := fl + 1;
  mult := zi.tower_mult(n, fl);
  update zi.game_secret set data = jsonb_set(data, '{picks}', picks) where game_id = id;
  if fl = 8 then
    perform zi.game_end(id, floor((a.gm).bet * mult)::bigint, a.sec || jsonb_build_object('picks', picks));
    return zi.gout(id, jsonb_build_object('trap', false, 'floor', fl, 'mult', mult, 'traps', a.sec -> 'traps', 'done', true));
  end if;
  return zi.gout(id, jsonb_build_object('trap', false, 'floor', fl, 'mult', mult));
end $$;
create or replace function public.game_tower_cash(id bigint) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); a record; fl int; mult numeric;
begin
  select * into a from zi.active_game(u, id, 'tower');
  fl := jsonb_array_length(a.sec -> 'picks');
  if fl < 1 then perform zi.err('pick_first'); end if;
  mult := zi.tower_mult(((a.gm).params ->> 'n')::int, fl);
  perform zi.game_end(id, floor((a.gm).bet * mult)::bigint, a.sec);
  return zi.gout(id, jsonb_build_object('mult', mult, 'traps', a.sec -> 'traps'));
end $$;

/* hi-lo: card values are 0..51 (rank = v % 13, A..K; suit = v / 13) */
create or replace function public.game_hilo_start(bet bigint) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); gb record; cards int[] := '{}'; i int;
begin
  if exists (select 1 from public.games x where x.user_id = u and x.g = 'hilo' and x.status = 'active') then perform zi.err('active_game'); end if;
  select * into gb from zi.game_begin(u, 'hilo', bet, '{}'::jsonb, 60);
  for i in 1..60 loop cards := cards || floor(gb.f[i] * 52)::int; end loop;
  update zi.game_secret set data = jsonb_build_object('cards', to_jsonb(cards), 'i', 0, 'mult', 1, 'streak', 0, 'skips', 3) where game_id = gb.gid;
  return zi.gout(gb.gid, jsonb_build_object('card', cards[1], 'mult', 1, 'streak', 0, 'skips', 3));
end $$;
create or replace function public.game_hilo_act(id bigint, act text) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); a record; s jsonb; i int; r int; nr int; p numeric; step numeric; ok boolean; mult numeric; cur int; nxt int;
begin
  select * into a from zi.active_game(u, id, 'hilo');
  s := a.sec; i := (s ->> 'i')::int;
  cur := (s -> 'cards' ->> i)::int; r := cur % 13;
  if i >= 59 then perform zi.err('game_over'); end if;
  nxt := (s -> 'cards' ->> (i + 1))::int; nr := nxt % 13;
  if act = 'skip' then
    if (s ->> 'skips')::int < 1 then perform zi.err('no_skips'); end if;
    s := jsonb_set(jsonb_set(s, '{i}', to_jsonb(i + 1)), '{skips}', to_jsonb((s ->> 'skips')::int - 1));
    update zi.game_secret set data = s where game_id = id;
    return zi.gout(id, jsonb_build_object('card', nxt, 'mult', s -> 'mult', 'streak', s -> 'streak', 'skips', s -> 'skips'));
  end if;
  if act not in ('hi', 'lo') then perform zi.err('bad_params'); end if;
  p := case when act = 'hi' then (12 - r) / 13.0 else r / 13.0 end;
  if p <= 0 then perform zi.err('bad_params'); end if;
  step := floor(0.97 / p * 100) / 100;
  ok := case when act = 'hi' then nr > r else nr < r end;
  s := jsonb_set(s, '{i}', to_jsonb(i + 1));
  if not ok then
    perform zi.game_end(id, 0, jsonb_build_object('cards', (select jsonb_agg(x) from jsonb_array_elements(s -> 'cards') with ordinality t(x, o) where o <= i + 2)));
    return zi.gout(id, jsonb_build_object('ok', false, 'card', nxt));
  end if;
  mult := floor((s ->> 'mult')::numeric * step * 100) / 100;
  s := jsonb_set(jsonb_set(s, '{mult}', to_jsonb(mult)), '{streak}', to_jsonb((s ->> 'streak')::int + 1));
  update zi.game_secret set data = s where game_id = id;
  if i + 1 >= 58 then
    perform zi.game_end(id, floor((a.gm).bet * mult)::bigint, jsonb_build_object('mult', mult));
    return zi.gout(id, jsonb_build_object('ok', true, 'card', nxt, 'mult', mult, 'streak', s -> 'streak', 'done', true));
  end if;
  return zi.gout(id, jsonb_build_object('ok', true, 'card', nxt, 'mult', mult, 'streak', s -> 'streak', 'skips', s -> 'skips'));
end $$;
create or replace function public.game_hilo_cash(id bigint) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); a record; mult numeric;
begin
  select * into a from zi.active_game(u, id, 'hilo');
  if (a.sec ->> 'streak')::int < 1 then perform zi.err('pick_first'); end if;
  mult := (a.sec ->> 'mult')::numeric;
  perform zi.game_end(id, floor((a.gm).bet * mult)::bigint, jsonb_build_object('mult', mult));
  return zi.gout(id, jsonb_build_object('mult', mult));
end $$;

/* blackjack: dealer stands on 17, blackjack pays 3:2, double on the first two cards */
create or replace function zi.bj_val(cards int[]) returns int language plpgsql immutable as $$
declare t int := 0; a int := 0; c int; r int;
begin
  foreach c in array cards loop
    r := c % 13;
    if r = 0 then t := t + 11; a := a + 1; elsif r >= 9 then t := t + 10; else t := t + r + 1; end if;
  end loop;
  while t > 21 and a > 0 loop t := t - 10; a := a - 1; end loop;
  return t;
end $$;
create or replace function zi.bj_finish(gid bigint, s jsonb, kind text) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare gm public.games; d int[]; nxt int; cards int[]; p int; dv int; pay bigint;
begin
  select * into gm from public.games where id = gid;
  cards := array(select jsonb_array_elements_text(s -> 'deck')::int);
  d := array(select jsonb_array_elements_text(s -> 'd')::int);
  nxt := (s ->> 'next')::int;
  p := zi.bj_val(array(select jsonb_array_elements_text(s -> 'p')::int));
  if kind is null then
    if p > 21 then kind := 'bust';
    else
      while zi.bj_val(d) < 17 loop d := d || cards[nxt + 1]; nxt := nxt + 1; end loop;
      dv := zi.bj_val(d);
      kind := case when dv > 21 then 'dbust' when p > dv then 'win' when p = dv then 'push' else 'lose' end;
    end if;
  end if;
  pay := case kind when 'bj' then floor((s ->> 'b0')::bigint * 2.5) when 'win' then gm.bet * 2 when 'dbust' then gm.bet * 2 when 'push' then gm.bet else 0 end;
  s := jsonb_set(jsonb_set(s, '{d}', to_jsonb(d)), '{next}', to_jsonb(nxt));
  perform zi.game_end(gid, pay, jsonb_build_object('p', s -> 'p', 'd', to_jsonb(d), 'kind', kind), case when kind = 'bj' then 'bj' end);
  return zi.gout(gid, jsonb_build_object('p', s -> 'p', 'd', to_jsonb(d), 'kind', kind, 'done', true));
end $$;
create or replace function public.game_bj_start(bet bigint) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); gb record; deck int[] := '{}'; i int; s jsonb; pbj boolean; dbj boolean;
begin
  if exists (select 1 from public.games x where x.user_id = u and x.g = 'bj' and x.status = 'active') then perform zi.err('active_game'); end if;
  select * into gb from zi.game_begin(u, 'bj', bet, '{}'::jsonb, 24);
  for i in 1..24 loop deck := deck || floor(gb.f[i] * 52)::int; end loop;
  s := jsonb_build_object('deck', to_jsonb(deck), 'p', jsonb_build_array(deck[1], deck[3]), 'd', jsonb_build_array(deck[2], deck[4]), 'next', 4, 'b0', bet, 'dbl', false);
  update zi.game_secret set data = s where game_id = gb.gid;
  pbj := zi.bj_val(array[deck[1], deck[3]]) = 21; dbj := zi.bj_val(array[deck[2], deck[4]]) = 21;
  if pbj or dbj then return zi.bj_finish(gb.gid, s, case when pbj and dbj then 'push' when pbj then 'bj' else 'lose' end); end if;
  return zi.gout(gb.gid, jsonb_build_object('p', s -> 'p', 'd', jsonb_build_array(deck[2])));
end $$;
create or replace function public.game_bj_act(id bigint, act text) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); a record; s jsonb; nxt int; c int; pv int;
begin
  select * into a from zi.active_game(u, id, 'bj');
  s := a.sec; nxt := (s ->> 'next')::int;
  if act = 'double' then
    if jsonb_array_length(s -> 'p') <> 2 or (s ->> 'dbl')::boolean then perform zi.err('bad_params'); end if;
    perform zi.bet_check(u, (s ->> 'b0')::bigint);
    perform zi.mv(u, 'game', -(s ->> 'b0')::bigint, 'gb', jsonb_build_object('g', 'bj', 'dbl', true));
    update public.games set bet = bet + (s ->> 'b0')::bigint where games.id = game_bj_act.id;
    c := (s -> 'deck' ->> nxt)::int;
    s := jsonb_set(jsonb_set(jsonb_set(s, '{p}', (s -> 'p') || to_jsonb(c)), '{next}', to_jsonb(nxt + 1)), '{dbl}', 'true');
    return zi.bj_finish(id, s, null);
  elsif act = 'hit' then
    c := (s -> 'deck' ->> nxt)::int;
    s := jsonb_set(jsonb_set(s, '{p}', (s -> 'p') || to_jsonb(c)), '{next}', to_jsonb(nxt + 1));
    pv := zi.bj_val(array(select jsonb_array_elements_text(s -> 'p')::int));
    if pv >= 21 or nxt + 1 >= 14 then return zi.bj_finish(id, s, null); end if;
    update zi.game_secret set data = s where game_id = id;
    return zi.gout(id, jsonb_build_object('p', s -> 'p', 'd', jsonb_build_array((s -> 'd' ->> 0)::int)));
  elsif act = 'stand' then
    return zi.bj_finish(id, s, null);
  end if;
  perform zi.err('bad_params');
end $$;

/* solo rocket: multiplier = e^(0.11·t); crash point is fixed when the flight starts */
create or replace function zi.crash_m(t0 bigint, t bigint) returns numeric language sql immutable as $$
  select floor(exp(0.11 * greatest(0, t - t0) / 1000.0) * 100) / 100
$$;
create or replace function zi.crash_point(f float8) returns numeric language sql immutable as $$
  select least(10000, greatest(1, floor(97 / (100 * (1 - f)) * 100) / 100))
$$;
create or replace function public.game_crash_start(bet bigint, auto numeric default null) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); gb record; cp numeric;
begin
  if auto is not null and auto < 1.01 then auto := null; end if;
  if exists (select 1 from public.games x where x.user_id = u and x.g = 'crash' and x.status = 'active' and x.at > zi.ms() - 600000) then perform zi.err('active_game'); end if;
  select * into gb from zi.game_begin(u, 'crash', bet, jsonb_build_object('auto', round(auto, 2)), 1);
  cp := zi.crash_point(gb.f[1]);
  update zi.game_secret set data = jsonb_build_object('cp', cp) where game_id = gb.gid;
  return zi.gout(gb.gid, jsonb_build_object('t0', (select x.at from public.games x where x.id = gb.gid), 'auto', round(auto, 2)));
end $$;
create or replace function zi.crash_settle(gid bigint, cash_at numeric) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare gm public.games; cp numeric; auto numeric; m numeric; pay bigint := 0; won numeric;
begin
  select * into gm from public.games where id = gid for update;
  if gm.status <> 'active' then return zi.gout(gid, coalesce(gm.res, '{}'::jsonb)); end if;
  select (data ->> 'cp')::numeric into cp from zi.game_secret where game_id = gid;
  auto := (gm.params ->> 'auto')::numeric;
  m := zi.crash_m(gm.at, zi.ms());
  if auto is not null and auto <= cp and m >= auto then won := auto;           -- auto cash-out was reached
  elsif cash_at is not null and m < cp then won := least(m, cp);              -- manual cash-out in time
  elsif m >= cp then won := null;                                              -- crashed
  else return zi.gout(gid, jsonb_build_object('flying', true)); end if;
  if won is not null then pay := floor(gm.bet * won); end if;
  perform zi.game_end(gid, pay, jsonb_build_object('cp', cp, 'cash', won), case when won >= 10 then 'crash10' end);
  return zi.gout(gid, jsonb_build_object('cp', cp, 'cash', won));
end $$;
create or replace function public.game_crash_cash(id bigint) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me();
begin
  if not exists (select 1 from public.games x where x.id = game_crash_cash.id and x.user_id = u and x.g = 'crash') then perform zi.err('not_found'); end if;
  return zi.crash_settle(id, 1);
end $$;
create or replace function public.game_crash_poll(id bigint) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me();
begin
  if not exists (select 1 from public.games x where x.id = game_crash_poll.id and x.user_id = u and x.g = 'crash') then perform zi.err('not_found'); end if;
  return zi.crash_settle(id, null);
end $$;
create or replace function zi.crash_tidy() returns void language plpgsql security definer set search_path = public, zi as $$
declare r record;
begin
  for r in select id from public.games where g = 'crash' and status = 'active' and at < zi.ms() - 5000 loop
    perform zi.crash_settle(r.id, null);
  end loop;
end $$;

/* ---------- duels: player vs player, winner takes both stakes ---------- */
create table if not exists public.duels (
  id bigint generated always as identity primary key,
  f uuid not null references public.profiles (id) on delete cascade,
  g text not null, s bigint not null, target uuid references public.profiles (id) on delete set null,
  st text not null default 'open', a uuid references public.profiles (id) on delete set null,
  w uuid, r jsonb, at bigint not null default zi.ms(), ta bigint
);
create index if not exists duels_st on public.duels (st, at desc);
create or replace function public.duel_create(g text, s bigint, target uuid default null) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); d public.duels;
begin
  if g not in ('flip', 'dice') then perform zi.err('bad_params'); end if;
  if target = u then perform zi.err('bad_target'); end if;
  perform zi.bet_check(u, s);
  perform zi.mv(u, 'duel', -s, 'dout', jsonb_build_object('g', g));
  insert into public.duels (f, g, s, target) values (u, g, s, target) returning * into d;
  perform zi.q_add(u, 'duel');
  if target is not null then perform zi.note(target, 'duel', s, jsonb_build_object('p', u, 'id', d.id)); end if;
  return to_jsonb(d);
end $$;
create or replace function public.duel_accept(id bigint) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); d public.duels; win uuid; res jsonb; fa int[]; aa int[];
begin
  select * into d from public.duels x where x.id = duel_accept.id for update;
  if not found or d.st <> 'open' then perform zi.err('closed'); end if;
  if d.f = u then perform zi.err('own'); end if;
  if d.target is not null and d.target <> u then perform zi.err('not_for_you'); end if;
  perform zi.bet_check(u, d.s);
  perform zi.mv(u, 'duel', -d.s, 'din', jsonb_build_object('g', d.g));
  if d.g = 'dice' then
    loop
      fa := array[1 + floor(random() * 6)::int, 1 + floor(random() * 6)::int];
      aa := array[1 + floor(random() * 6)::int, 1 + floor(random() * 6)::int];
      exit when fa[1] + fa[2] <> aa[1] + aa[2];
    end loop;
    win := case when fa[1] + fa[2] > aa[1] + aa[2] then d.f else u end;
    res := jsonb_build_object('fa', to_jsonb(fa), 'aa', to_jsonb(aa));
  else
    res := jsonb_build_object('side', case when random() < 0.5 then 'z' else 'b' end);
    win := case when res ->> 'side' = 'z' then d.f else u end;
  end if;
  update public.duels x set st = 'done', a = u, w = win, r = res, ta = zi.ms() where x.id = d.id returning * into d;
  perform zi.mv(win, 'duel', 2 * d.s, 'dw', jsonb_build_object('p', case when win = d.f then u else d.f end, 'd', d.s));
  perform zi.mv(case when win = d.f then u else d.f end, 'duel', 0, 'dl', jsonb_build_object('p', win, 'd', -d.s));
  perform zi.day_net(win, d.s);
  perform zi.day_net(case when win = d.f then u else d.f end, -d.s);
  perform zi.st_add(win, 'duelW', 1);
  perform zi.ach(win, 'duelist');
  perform zi.q_add(u, 'duel');
  perform zi.note(d.f, case when win = d.f then 'dw' else 'dl' end, case when win = d.f then d.s else -d.s end, jsonb_build_object('p', u, 'id', d.id));
  if d.s >= 500 then perform zi.feed(win, 'dw', d.s, jsonb_build_object('p', case when win = d.f then u else d.f end)); end if;
  return to_jsonb(d);
end $$;
create or replace function public.duel_cancel(id bigint) returns void language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); d public.duels;
begin
  select * into d from public.duels x where x.id = duel_cancel.id for update;
  if not found or d.f <> u or d.st <> 'open' then perform zi.err('closed'); end if;
  update public.duels x set st = 'cancel', ta = zi.ms() where x.id = d.id;
  perform zi.mv(u, 'duel', d.s, 'dc', null);
end $$;
create or replace function zi.duels_tick() returns void language plpgsql security definer set search_path = public, zi as $$
declare d record;
begin
  for d in select * from public.duels where st = 'open' and at < zi.ms() - 48 * 3600000::bigint for update skip locked loop
    update public.duels set st = 'cancel', ta = zi.ms() where id = d.id;
    perform zi.mv(d.f, 'duel', d.s, 'dc', null);
  end loop;
  delete from public.duels where st in ('cancel', 'done') and coalesce(ta, at) < zi.ms() - 7 * 86400000::bigint;
end $$;

/* ---------- personal statistics ---------- */
create or replace function public.my_stats() returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); c0 int := zi.cur() - 29;
begin
  return jsonb_build_object(
    'games', coalesce((select jsonb_agg(x order by x.n desc) from (
        select g, count(*) n, sum(bet) wager, sum(pay - bet) net, count(*) filter (where pay > bet) wins, max(round(pay::numeric / nullif(bet, 0), 2)) best
        from public.games where user_id = u and status = 'done' group by g) x), '[]'::jsonb),
    'days', coalesce((select jsonb_agg(x order by x.c) from (
        select zi.cyc(at) c, sum(delta) filter (where cat <> 'admin') net,
               (array_agg(bal order by id desc))[1] bal
        from public.ledger where user_id = u and at >= zi.cyc_start(c0) group by 1) x), '[]'::jsonb),
    'heat', coalesce((select jsonb_agg(x) from (
        select extract(isodow from to_timestamp(at / 1000.0) at time zone 'Asia/Tbilisi')::int dw,
               extract(hour from to_timestamp(at / 1000.0) at time zone 'Asia/Tbilisi')::int h, count(*) n
        from public.games where user_id = u and at > zi.ms() - 60 * 86400000::bigint group by 1, 2) x), '[]'::jsonb),
    'cats', coalesce((select jsonb_object_agg(cat, s) from (select cat, sum(delta) s from public.ledger where user_id = u group by cat) x), '{}'::jsonb)
  );
end $$;
-- reveal the server data of a finished game (for the fairness check)
create or replace function public.game_proof(id bigint) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); gm public.games;
begin
  select * into gm from public.games x where x.id = game_proof.id and x.user_id = u;
  if not found then perform zi.err('not_found'); end if;
  return jsonb_build_object('game', to_jsonb(gm), 'seed', (select fs.seed from public.fair_seeds fs where fs.user_id = u and fs.hash = gm.hash));
end $$;

-- pick up an unfinished game after a page reload (only what the player may see)
create or replace function public.game_resume(g text) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); gm public.games; sec jsonb;
begin
  select * into gm from public.games x where x.user_id = u and x.g = game_resume.g and x.status = 'active' order by x.id desc limit 1;
  if not found then return null; end if;
  select data into sec from zi.game_secret where game_id = gm.id;
  return zi.gout(gm.id, jsonb_build_object('params', gm.params, 'state', case gm.g
    when 'mines' then jsonb_build_object('open', sec -> 'open')
    when 'tower' then jsonb_build_object('picks', sec -> 'picks')
    when 'hilo' then jsonb_build_object('card', sec -> 'cards' -> ((sec ->> 'i')::int), 'mult', sec -> 'mult', 'streak', sec -> 'streak', 'skips', sec -> 'skips')
    when 'bj' then jsonb_build_object('p', sec -> 'p', 'd', jsonb_build_array(sec -> 'd' -> 0))
    when 'crash' then jsonb_build_object('t0', gm.at, 'auto', gm.params -> 'auto')
    else '{}'::jsonb end));
end $$;

-- ===== 006_multi.sql =====
-- ზარაფხანა · 006 · multiplayer: live rocket, Texas hold'em poker, bingo

/* =================== live rocket: one shared flight for everyone =================== */
create table if not exists public.live_rounds (
  n bigint primary key, start_at bigint not null, crash numeric, hash text not null, seed text, done boolean not null default false
);
create table if not exists zi.live_secret (n bigint primary key, seed text not null, cp numeric not null);
create table if not exists public.live_bets (
  n bigint not null references public.live_rounds (n) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  a bigint not null, auto numeric, m numeric, pay bigint, gid bigint, at bigint not null default zi.ms(),
  primary key (n, user_id)
);
create or replace function zi.live_new(start bigint) returns bigint language plpgsql security definer set search_path = public, zi, extensions as $$
declare nn bigint; s text := encode(extensions.gen_random_bytes(32), 'hex'); cp numeric;
begin
  select coalesce(max(n), 0) + 1 into nn from public.live_rounds;
  cp := zi.crash_point((zi.floats(s, 'live', nn, 1))[1]);
  insert into zi.live_secret (n, seed, cp) values (nn, s, cp);
  insert into public.live_rounds (n, start_at, hash) values (nn, start, zi.sha(s));
  return nn;
end $$;
create or replace function zi.live_step() returns void language plpgsql security definer set search_path = public, zi as $$
declare r public.live_rounds; sec zi.live_secret; tc bigint; b record; now_ bigint := zi.ms();
begin
  perform pg_advisory_xact_lock(hashtext('zar-live'));
  select * into r from public.live_rounds order by n desc limit 1;
  if not found then perform zi.live_new(now_ + 7000); return; end if;
  select * into sec from zi.live_secret where n = r.n;
  tc := r.start_at + ceil(ln(sec.cp) / 0.11 * 1000)::bigint;
  if not r.done and now_ >= tc then
    update public.live_rounds set crash = sec.cp, seed = sec.seed, done = true where n = r.n;
    for b in select * from public.live_bets where n = r.n and m is null loop
      if b.auto is not null and b.auto <= sec.cp then
        update public.live_bets set m = b.auto, pay = floor(b.a * b.auto) where n = r.n and user_id = b.user_id;
        perform zi.game_end(b.gid, floor(b.a * b.auto)::bigint, jsonb_build_object('n', r.n, 'cash', b.auto, 'cp', sec.cp), case when b.auto >= 10 then 'crash10' end);
      else
        update public.live_bets set pay = 0 where n = r.n and user_id = b.user_id;
        perform zi.game_end(b.gid, 0, jsonb_build_object('n', r.n, 'cp', sec.cp));
      end if;
    end loop;
    r.done := true;
  end if;
  if r.done and now_ >= tc + 4000 then perform zi.live_new(now_ + 7000); end if;
end $$;
create or replace function public.live_state() returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare r public.live_rounds;
begin
  perform zi.live_step();
  select * into r from public.live_rounds order by n desc limit 1;
  return jsonb_build_object('now', zi.ms(), 'round', to_jsonb(r),
    'bets', coalesce((select jsonb_agg(to_jsonb(b) - 'gid' order by b.a desc) from public.live_bets b where b.n = r.n), '[]'::jsonb),
    'hist', coalesce((select jsonb_agg(x.crash order by x.n desc) from (select n, crash from public.live_rounds where done order by n desc limit 12) x), '[]'::jsonb));
end $$;
create or replace function public.live_bet(n bigint, a bigint, auto numeric default null) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); r public.live_rounds; gid bigint;
begin
  select * into r from public.live_rounds x where x.n = live_bet.n for update;
  if not found or r.done or zi.ms() >= r.start_at then perform zi.err('closed'); end if;
  if exists (select 1 from public.live_bets b where b.n = r.n and b.user_id = u) then perform zi.err('already'); end if;
  if auto is not null and auto < 1.01 then auto := null; end if;
  perform zi.bet_check(u, a);
  perform zi.mv(u, 'game', -a, 'gb', jsonb_build_object('g', 'live'));
  insert into public.games (user_id, g, bet, hash, params) values (u, 'live', a, r.hash, jsonb_build_object('n', r.n, 'auto', auto)) returning id into gid;
  insert into public.live_bets (n, user_id, a, auto, gid) values (r.n, u, a, round(auto, 2), gid);
  return jsonb_build_object('ok', true, 'bal', zi.bal(u));
end $$;
create or replace function public.live_cash(n bigint) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); r public.live_rounds; b public.live_bets; cp numeric; vm numeric; vpay bigint;
begin
  select * into r from public.live_rounds x where x.n = live_cash.n for update;
  select * into b from public.live_bets x where x.n = live_cash.n and x.user_id = u for update;
  if not found or b.m is not null or b.pay is not null then perform zi.err('closed'); end if;
  if r.done or zi.ms() < r.start_at then perform zi.err('closed'); end if;
  select s.cp into cp from zi.live_secret s where s.n = r.n;
  vm := zi.crash_m(r.start_at, zi.ms());
  if b.auto is not null and vm >= b.auto and b.auto <= cp then vm := b.auto; end if;
  if vm >= cp then perform zi.live_step(); return jsonb_build_object('crashed', true, 'bal', zi.bal(u)); end if;
  vpay := floor(b.a * vm);
  update public.live_bets x set m = vm, pay = vpay where x.n = r.n and x.user_id = u;
  perform zi.game_end(b.gid, vpay, jsonb_build_object('n', r.n, 'cash', vm), case when vm >= 10 then 'crash10' end);
  return jsonb_build_object('m', vm, 'pay', vpay, 'bal', zi.bal(u));
end $$;

/* =================== Texas hold'em (no limit) =================== */
create table if not exists public.poker_tables (
  id int generated always as identity primary key,
  name text not null, sb bigint not null, bb bigint not null, min_buy bigint not null, max_buy bigint not null,
  seats int not null default 6, hand bigint not null default 0, stage text not null default 'idle',
  board text[] not null default '{}', cur_bet bigint not null default 0, min_raise bigint not null default 0,
  turn int, deadline bigint, dealer int, last jsonb, next_at bigint not null default 0, updated bigint not null default zi.ms()
);
create table if not exists public.poker_seats (
  table_id int not null references public.poker_tables (id) on delete cascade, seat int not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  stack bigint not null default 0, bet bigint not null default 0, total bigint not null default 0,
  in_hand boolean not null default false, folded boolean not null default false, allin boolean not null default false,
  acted boolean not null default false, out_ boolean not null default false, leaving boolean not null default false,
  last text, buyin bigint not null default 0, idle_since bigint, joined bigint not null default zi.ms(),
  primary key (table_id, seat), unique (table_id, user_id)
);
create table if not exists public.poker_holes (
  table_id int not null, hand bigint not null, user_id uuid not null references public.profiles (id) on delete cascade,
  cards text[] not null, primary key (table_id, hand, user_id)
);
create table if not exists zi.poker_deck (table_id int primary key, hand bigint, deck text[], pos int);
insert into public.poker_tables (name, sb, bb, min_buy, max_buy)
select * from (values ('მეგობრული', 5::bigint, 10::bigint, 200::bigint, 1000::bigint), ('საშუალო', 25, 50, 1000, 5000), ('მაღალი', 100, 200, 4000, 20000)) v
where not exists (select 1 from public.poker_tables);

create or replace function zi.pk_r(c text) returns int language sql immutable as $$ select position(substr(c, 1, 1) in '23456789TJQKA') + 1 $$;
create or replace function zi.pk_rank5(c text[]) returns bigint language plpgsql immutable as $$
declare r int[]; s text[]; flush boolean; straight boolean := false; high int := 0; tb int[]; cn int[]; uq int[]; cat int; sc bigint; i int;
begin
  select array_agg(zi.pk_r(v) order by zi.pk_r(v) desc), array_agg(substr(v, 2, 1)) into r, s from unnest(c) v;
  flush := (select count(distinct x) from unnest(s) x) = 1;
  uq := array(select distinct x from unnest(r) x order by x desc);
  if array_length(uq, 1) = 5 then
    if uq[1] - uq[5] = 4 then straight := true; high := uq[1];
    elsif uq = array[14, 5, 4, 3, 2] then straight := true; high := 5; end if;
  end if;
  select array_agg(rk order by n desc, rk desc), array_agg(n order by n desc, rk desc) into tb, cn
  from (select x rk, count(*) n from unnest(r) x group by x) g;
  if straight and flush then cat := 8; tb := array[high];
  elsif cn[1] = 4 then cat := 7;
  elsif cn[1] = 3 and cn[2] = 2 then cat := 6;
  elsif flush then cat := 5;
  elsif straight then cat := 4; tb := array[high];
  elsif cn[1] = 3 then cat := 3;
  elsif cn[1] = 2 and cn[2] = 2 then cat := 2;
  elsif cn[1] = 2 then cat := 1;
  else cat := 0; end if;
  sc := cat;
  for i in 1..5 loop sc := sc * 16 + coalesce(tb[i], 0); end loop;
  return sc;
end $$;
create or replace function zi.pk_best(c text[]) returns bigint language plpgsql immutable as $$
declare n int := coalesce(array_length(c, 1), 0); best bigint := -1; a int; b int; d int; e int; f int;
begin
  if n < 5 then return -1; end if;
  for a in 1..n - 4 loop for b in a + 1..n - 3 loop for d in b + 1..n - 2 loop for e in d + 1..n - 1 loop for f in e + 1..n loop
    best := greatest(best, zi.pk_rank5(array[c[a], c[b], c[d], c[e], c[f]]));
  end loop; end loop; end loop; end loop; end loop;
  return best;
end $$;

-- next seat (circular) after `from_` that matches: 'deal' = in the hand, 'act' = can still act
create or replace function zi.pk_next(tid int, from_ int, kind text) returns int language sql stable as $$
  select seat from public.poker_seats
  where table_id = tid and in_hand and (kind = 'deal' or (not folded and not allin))
  order by (seat - from_ - 1 + 100) % 100 limit 1
$$;
create or replace function zi.pk_deal(tid int, n int) returns text[] language plpgsql security definer set search_path = public, zi as $$
declare d zi.poker_deck; out_ text[];
begin
  select * into d from zi.poker_deck where table_id = tid for update;
  out_ := d.deck[d.pos + 1:d.pos + n];
  update zi.poker_deck set pos = pos + n where table_id = tid;
  return out_;
end $$;
create or replace function zi.pk_post(tid int, st int, amt bigint, lbl text) returns void language sql security definer set search_path = public, zi as $$
  update public.poker_seats set stack = stack - least(stack, amt), bet = bet + least(stack, amt), total = total + least(stack, amt),
    allin = (stack - least(stack, amt)) = 0, last = lbl
  where table_id = tid and seat = st
$$;
create or replace function zi.pk_start(tid int) returns boolean language plpgsql security definer set search_path = public, zi as $$
declare t public.poker_tables; n int; dl int; sbs int; bbs int; s record;
begin
  select * into t from public.poker_tables where id = tid for update;
  if t.stage <> 'idle' or zi.ms() < t.next_at then return false; end if;
  select count(*) into n from public.poker_seats where table_id = tid and not out_ and not leaving and stack > 0;
  if n < 2 then return false; end if;
  update public.poker_seats set in_hand = (not out_ and not leaving and stack > 0), bet = 0, total = 0, folded = false, allin = false, acted = false, last = null
  where table_id = tid;
  dl := zi.pk_next(tid, coalesce(t.dealer, -1), 'deal');
  if n = 2 then sbs := dl; else sbs := zi.pk_next(tid, dl, 'deal'); end if;
  bbs := zi.pk_next(tid, sbs, 'deal');
  insert into zi.poker_deck (table_id, hand, deck, pos)
  values (tid, t.hand + 1, array(select r || su from unnest(string_to_array('2,3,4,5,6,7,8,9,T,J,Q,K,A', ',')) r, unnest(array['s', 'h', 'd', 'c']) su order by random()), 0)
  on conflict (table_id) do update set hand = excluded.hand, deck = excluded.deck, pos = 0;
  for s in select seat, user_id from public.poker_seats where table_id = tid and in_hand order by seat loop
    insert into public.poker_holes (table_id, hand, user_id, cards) values (tid, t.hand + 1, s.user_id, zi.pk_deal(tid, 2))
    on conflict (table_id, hand, user_id) do update set cards = excluded.cards;
  end loop;
  perform zi.pk_post(tid, sbs, t.sb, 'SB');
  perform zi.pk_post(tid, bbs, t.bb, 'BB');
  update public.poker_tables set hand = t.hand + 1, stage = 'preflop', board = '{}', cur_bet = t.bb, min_raise = t.bb, dealer = dl,
    turn = zi.pk_next(tid, bbs, 'act'), deadline = zi.ms() + 25000, updated = zi.ms()
  where id = tid;
  delete from public.poker_holes where table_id = tid and hand < t.hand - 1;
  perform zi.pk_advance(tid, true);
  return true;
end $$;

-- after every action: move the turn, close betting rounds, deal streets, go to showdown
create or replace function zi.pk_advance(tid int, just_started boolean default false) returns void language plpgsql security definer set search_path = public, zi as $$
declare t public.poker_tables; live int; can_act int; pending int; nxt int;
begin
  select * into t from public.poker_tables where id = tid for update;
  if t.stage not in ('preflop', 'flop', 'turn', 'river') then return; end if;
  select count(*) filter (where not folded), count(*) filter (where not folded and not allin) into live, can_act from public.poker_seats where table_id = tid and in_hand;
  if live <= 1 then perform zi.pk_showdown(tid); return; end if;
  select count(*) into pending from public.poker_seats where table_id = tid and in_hand and not folded and not allin and (not acted or bet < t.cur_bet);
  -- one player left who could act and has nothing to call: nobody else can bet
  if pending = 0 or (can_act <= 1 and not exists (select 1 from public.poker_seats where table_id = tid and in_hand and not folded and not allin and bet < t.cur_bet)) then
    if can_act <= 1 or t.stage = 'river' then
      -- run out the board and show down
      if t.stage = 'preflop' then t.board := zi.pk_deal(tid, 5);
      elsif t.stage = 'flop' then t.board := t.board || zi.pk_deal(tid, 2);
      elsif t.stage = 'turn' then t.board := t.board || zi.pk_deal(tid, 1); end if;
      update public.poker_tables set board = t.board, stage = 'river' where id = tid;
      perform zi.pk_showdown(tid);
      return;
    end if;
    update public.poker_seats set bet = 0, acted = false where table_id = tid;
    t.board := t.board || zi.pk_deal(tid, case when t.stage = 'preflop' then 3 else 1 end);
    update public.poker_tables set board = t.board,
      stage = case t.stage when 'preflop' then 'flop' when 'flop' then 'turn' else 'river' end,
      cur_bet = 0, min_raise = t.bb, turn = zi.pk_next(tid, t.dealer, 'act'), deadline = zi.ms() + 25000, updated = zi.ms()
    where id = tid;
    return;
  end if;
  if just_started then return; end if;
  nxt := zi.pk_next(tid, t.turn, 'act');
  -- skip players who have already matched and acted
  update public.poker_tables set turn = (select seat from public.poker_seats where table_id = tid and in_hand and not folded and not allin and (not acted or bet < t.cur_bet)
                                          order by (seat - t.turn - 1 + 100) % 100 limit 1),
    deadline = zi.ms() + 25000, updated = zi.ms()
  where id = tid;
end $$;

create or replace function zi.pk_showdown(tid int) returns void language plpgsql security definer set search_path = public, zi as $$
declare t public.poker_tables; lv bigint; prev bigint := 0; portion bigint; best bigint; winners int[]; nw int; share bigint; rem int;
        rake bigint := 0; rk_left bigint; cut bigint; potsum bigint; s record; shown jsonb := '[]'::jsonb; wins jsonb := '{}'::jsonb; live int; sc jsonb := '{}'::jsonb; w int; net bigint; won bigint;
begin
  select * into t from public.poker_tables where id = tid for update;
  select count(*) into live from public.poker_seats where table_id = tid and in_hand and not folded;
  select coalesce(sum(total), 0) into potsum from public.poker_seats where table_id = tid;
  if coalesce(array_length(t.board, 1), 0) >= 3 then
    rake := least(floor(potsum * zi.cfgn('{poker,rake}', 2) / 100.0), t.bb * 10);
  end if;
  rk_left := rake;
  -- scores of the players still in
  for s in select ps.seat, ps.user_id, h.cards from public.poker_seats ps join public.poker_holes h on h.table_id = tid and h.hand = t.hand and h.user_id = ps.user_id
           where ps.table_id = tid and ps.in_hand and not ps.folded loop
    sc := sc || jsonb_build_object(s.seat::text, case when live > 1 then zi.pk_best(s.cards || t.board) else 0 end);
    if live > 1 then shown := shown || jsonb_build_array(jsonb_build_object('seat', s.seat, 'user', s.user_id, 'cards', to_jsonb(s.cards), 'score', zi.pk_best(s.cards || t.board))); end if;
  end loop;
  for lv in select distinct total from public.poker_seats where table_id = tid and total > 0 order by total loop
    select coalesce(sum(least(total, lv) - least(total, prev)), 0) into portion from public.poker_seats where table_id = tid;
    cut := least(rk_left, portion); portion := portion - cut; rk_left := rk_left - cut;
    select max((sc ->> seat::text)::bigint) into best from public.poker_seats where table_id = tid and in_hand and not folded and total >= lv;
    if best is null then
      -- everybody who matched this level folded: it goes to the best remaining hand
      select max((sc ->> seat::text)::bigint) into best from public.poker_seats where table_id = tid and in_hand and not folded;
      winners := array(select seat from public.poker_seats where table_id = tid and in_hand and not folded and (sc ->> seat::text)::bigint = best order by (seat - t.dealer - 1 + 100) % 100);
    else
      winners := array(select seat from public.poker_seats where table_id = tid and in_hand and not folded and total >= lv and (sc ->> seat::text)::bigint = best order by (seat - t.dealer - 1 + 100) % 100);
    end if;
    nw := array_length(winners, 1);
    share := portion / nw; rem := portion % nw;
    for i in 1..nw loop
      w := winners[i];
      wins := jsonb_set(wins, array[w::text], to_jsonb(coalesce((wins ->> w::text)::bigint, 0) + share + case when i = 1 then rem else 0 end));
    end loop;
    prev := lv;
  end loop;
  -- pay the stacks, record each player's hand
  for s in select * from public.poker_seats where table_id = tid and (in_hand or total > 0) loop
    won := coalesce((wins ->> s.seat::text)::bigint, 0);
    net := won - s.total;
    update public.poker_seats set stack = stack + won, bet = 0, total = 0, in_hand = false, acted = false, last = case when won > 0 then 'win' else last end,
      idle_since = case when out_ then coalesce(idle_since, zi.ms()) else null end
    where table_id = tid and seat = s.seat;
    if s.total > 0 then
      insert into public.games (user_id, g, bet, pay, status, params, res, done) values (s.user_id, 'poker', s.total, won, 'done', jsonb_build_object('t', tid, 'hand', t.hand), jsonb_build_object('board', to_jsonb(t.board)), zi.ms());
      perform zi.weekly_add(s.user_id, net, s.total, 1, 0, 0);
      perform zi.st_add(s.user_id, 'pokerH', 1);
      perform zi.st_add(s.user_id, 'game', net);
      perform zi.add_xp(s.user_id, s.total);
      perform zi.q_add(s.user_id, 'poker');
      perform zi.day_net(s.user_id, net);
      if won >= t.bb * 20 and net > 0 then perform zi.ach(s.user_id, 'poker'); end if;
      if net >= 1000 then perform zi.feed(s.user_id, 'pk', net, jsonb_build_object('t', t.name)); end if;
    end if;
  end loop;
  update public.poker_tables set stage = 'idle', turn = null, deadline = null, cur_bet = 0, next_at = zi.ms() + case when live > 1 then 6000 else 3000 end,
    last = jsonb_build_object('hand', t.hand, 'board', to_jsonb(t.board), 'shown', shown, 'wins', wins, 'pot', potsum, 'rake', rake - rk_left), updated = zi.ms()
  where id = tid;
  -- people who asked to leave, or busted, get their chips back and free the seat
  for s in select * from public.poker_seats where table_id = tid and (leaving or stack = 0) loop
    if s.stack > 0 then perform zi.mv(s.user_id, 'poker', s.stack, 'pkout', jsonb_build_object('t', tid, 'net', s.stack - s.buyin)); end if;
    delete from public.poker_seats where table_id = tid and seat = s.seat;
  end loop;
end $$;

create or replace function zi.pk_lock_seat(tid int, u uuid, out t public.poker_tables, out s public.poker_seats) language plpgsql security definer set search_path = public, zi as $$
begin
  select * into t from public.poker_tables where id = tid for update;
  if not found then perform zi.err('not_found'); end if;
  select * into s from public.poker_seats where table_id = tid and user_id = u for update;
end $$;
create or replace function public.poker_sit(tid int, seat int, buyin bigint) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); x record;
begin
  if not zi.cfgb('{poker,on}', true) then perform zi.err('off'); end if;
  select * into x from zi.pk_lock_seat(tid, u);
  if (x.s).user_id is not null then perform zi.err('already'); end if;
  if seat < 0 or seat >= (x.t).seats or exists (select 1 from public.poker_seats ps where ps.table_id = tid and ps.seat = poker_sit.seat) then perform zi.err('seat_taken'); end if;
  if buyin < (x.t).min_buy or buyin > (x.t).max_buy then perform zi.err('bad_amount'); end if;
  perform zi.bet_check(u, buyin);
  perform zi.mv(u, 'poker', -buyin, 'pkin', jsonb_build_object('t', tid));
  insert into public.poker_seats (table_id, seat, user_id, stack, buyin) values (tid, seat, u, buyin, buyin);
  perform zi.pk_start(tid);
  return public.poker_state(tid);
end $$;
create or replace function public.poker_rebuy(tid int, amount bigint) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); x record;
begin
  select * into x from zi.pk_lock_seat(tid, u);
  if (x.s).user_id is null then perform zi.err('not_seated'); end if;
  if (x.s).in_hand and (x.t).stage <> 'idle' then perform zi.err('in_hand'); end if;
  if amount < 1 or (x.s).stack + amount > (x.t).max_buy then perform zi.err('bad_amount'); end if;
  perform zi.bet_check(u, amount);
  perform zi.mv(u, 'poker', -amount, 'pkin', jsonb_build_object('t', tid));
  update public.poker_seats set stack = stack + amount, buyin = buyin + amount where table_id = tid and user_id = u;
  return public.poker_state(tid);
end $$;
create or replace function public.poker_leave(tid int) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); x record; st int;
begin
  select * into x from zi.pk_lock_seat(tid, u);
  if (x.s).user_id is null then return public.poker_state(tid); end if;
  if (x.t).stage <> 'idle' and (x.s).in_hand then
    -- in a hand: fold now, get the chips back when the hand ends
    update public.poker_seats set leaving = true where table_id = tid and user_id = u;
    if not (x.s).folded then
      update public.poker_seats set folded = true, acted = true, last = 'fold' where table_id = tid and user_id = u;
      perform zi.pk_advance(tid, (x.t).turn is distinct from (x.s).seat);
    end if;
    return public.poker_state(tid);
  end if;
  if (x.s).stack > 0 then perform zi.mv(u, 'poker', (x.s).stack, 'pkout', jsonb_build_object('t', tid, 'net', (x.s).stack - (x.s).buyin)); end if;
  delete from public.poker_seats where table_id = tid and user_id = u;
  return public.poker_state(tid);
end $$;
create or replace function public.poker_back(tid int) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me();
begin
  update public.poker_seats set out_ = false, idle_since = null where table_id = tid and user_id = u;
  perform zi.pk_start(tid);
  return public.poker_state(tid);
end $$;
create or replace function zi.pk_apply(tid int, st int, act text, amount bigint) returns void language plpgsql security definer set search_path = public, zi as $$
declare t public.poker_tables; s public.poker_seats; put bigint; target bigint;
begin
  select * into t from public.poker_tables where id = tid for update;
  select * into s from public.poker_seats where table_id = tid and seat = st for update;
  if act = 'fold' then
    update public.poker_seats set folded = true, acted = true, last = 'fold' where table_id = tid and seat = st;
  elsif act = 'check' then
    if s.bet < t.cur_bet then perform zi.err('cant_check'); end if;
    update public.poker_seats set acted = true, last = 'check' where table_id = tid and seat = st;
  elsif act = 'call' then
    put := least(t.cur_bet - s.bet, s.stack);
    if put <= 0 then perform zi.err('cant_call'); end if;
    update public.poker_seats set stack = stack - put, bet = bet + put, total = total + put, acted = true, allin = (stack - put = 0), last = 'call'
    where table_id = tid and seat = st;
  elsif act in ('raise', 'allin') then
    target := case when act = 'allin' then s.bet + s.stack else amount end;
    if target > s.bet + s.stack then perform zi.err('bad_amount'); end if;
    if target <= t.cur_bet then
      if act = 'allin' then perform zi.pk_apply(tid, st, 'call', 0); return; end if;
      perform zi.err('bad_amount');
    end if;
    if target < t.cur_bet + t.min_raise and target < s.bet + s.stack then perform zi.err('raise_small'); end if;
    put := target - s.bet;
    update public.poker_seats set stack = stack - put, bet = target, total = total + put, acted = true, allin = (stack - put = 0),
      last = case when target = s.bet + s.stack then 'allin' when t.cur_bet = 0 then 'bet' else 'raise' end
    where table_id = tid and seat = st;
    if target - t.cur_bet >= t.min_raise then
      update public.poker_tables set min_raise = target - t.cur_bet where id = tid;
      update public.poker_seats set acted = false where table_id = tid and seat <> st and in_hand and not folded and not allin;
    end if;
    update public.poker_tables set cur_bet = target where id = tid;
  else
    perform zi.err('bad_params');
  end if;
end $$;
create or replace function public.poker_act(tid int, act text, amount bigint default 0) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); x record;
begin
  select * into x from zi.pk_lock_seat(tid, u);
  if (x.s).user_id is null or (x.t).stage not in ('preflop', 'flop', 'turn', 'river') or (x.t).turn is distinct from (x.s).seat then perform zi.err('not_your_turn'); end if;
  perform zi.pk_apply(tid, (x.s).seat, act, amount);
  perform zi.pk_advance(tid);
  return public.poker_state(tid);
end $$;
-- timeouts (check or fold, then sit out), idle cleanup, starting the next hand
create or replace function zi.pk_poke(tid int) returns void language plpgsql security definer set search_path = public, zi as $$
declare t public.poker_tables; s public.poker_seats; r record;
begin
  select * into t from public.poker_tables where id = tid for update;
  if t.stage in ('preflop', 'flop', 'turn', 'river') and t.deadline < zi.ms() and t.turn is not null then
    select * into s from public.poker_seats where table_id = tid and seat = t.turn;
    perform zi.pk_apply(tid, t.turn, case when s.bet >= t.cur_bet then 'check' else 'fold' end, 0);
    update public.poker_seats set out_ = true where table_id = tid and seat = t.turn;
    perform zi.pk_advance(tid);
  end if;
  if (select stage from public.poker_tables where id = tid) = 'idle' then
    for r in select * from public.poker_seats where table_id = tid and out_ and idle_since < zi.ms() - 600000 loop
      if r.stack > 0 then perform zi.mv(r.user_id, 'poker', r.stack, 'pkout', jsonb_build_object('t', tid, 'net', r.stack - r.buyin)); end if;
      delete from public.poker_seats where table_id = tid and seat = r.seat;
    end loop;
    update public.poker_seats set idle_since = coalesce(idle_since, zi.ms()) where table_id = tid and out_;
    perform zi.pk_start(tid);
  end if;
end $$;
create or replace function public.poker_state(tid int) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := auth.uid(); t public.poker_tables;
begin
  if u is null then perform zi.err('auth'); end if;
  perform zi.pk_poke(tid);
  select * into t from public.poker_tables where id = tid;
  return jsonb_build_object('now', zi.ms(), 'table', to_jsonb(t),
    'seats', coalesce((select jsonb_agg(to_jsonb(s) order by s.seat) from public.poker_seats s where s.table_id = tid), '[]'::jsonb),
    'pot', (select coalesce(sum(total), 0) from public.poker_seats where table_id = tid),
    'hole', (select to_jsonb(h.cards) from public.poker_holes h join public.poker_seats s on s.table_id = h.table_id and s.user_id = h.user_id
             where h.table_id = tid and h.hand = t.hand and h.user_id = u and s.in_hand));
end $$;
create or replace function public.poker_lobby() returns jsonb language sql security definer set search_path = public, zi as $$
  select coalesce(jsonb_agg(jsonb_build_object('t', to_jsonb(t), 'n', (select count(*) from public.poker_seats s where s.table_id = t.id),
         'me', exists (select 1 from public.poker_seats s where s.table_id = t.id and s.user_id = auth.uid()))
         order by t.bb), '[]'::jsonb)
  from public.poker_tables t
$$;

/* =================== bingo (75 balls, any line wins; a game every 20 minutes) =================== */
create table if not exists public.bingo_games (
  id bigint generated always as identity primary key,
  starts bigint not null unique, price bigint not null, every_ms int not null default 3000,
  status text not null default 'sale', cards int not null default 0, pot bigint not null default 0,
  win_idx int, winners jsonb, balls int[]
);
create table if not exists zi.bingo_secret (game_id bigint primary key, balls int[] not null);
create table if not exists public.bingo_cards (
  id bigint generated always as identity primary key,
  game_id bigint not null references public.bingo_games (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  nums int[] not null, won bigint
);
create index if not exists bingo_cards_game on public.bingo_cards (game_id, user_id);
create or replace function zi.bingo_ensure() returns void language plpgsql security definer set search_path = public, zi as $$
declare ev bigint := greatest(5, zi.cfgn('{bingo,every}', 20))::bigint * 60000; nx bigint;
begin
  if not zi.cfgb('{bingo,on}', true) then return; end if;
  nx := (floor(zi.ms() / ev::numeric) + 1)::bigint * ev;
  insert into public.bingo_games (starts, price, pot) values (nx, zi.cfgn('{bingo,price}', 25)::bigint, zi.cfgn('{bingo,seed}', 100)::bigint) on conflict (starts) do nothing;
end $$;
-- index (0-based) of the ball that completes a line on this card
create or replace function zi.bingo_done_at(nums int[], pos jsonb) returns int language plpgsql immutable as $$
declare best int := 999; l int[]; i int; mx int; v int;
  lines int[][] := array[[1,2,3,4,5],[6,7,8,9,10],[11,12,13,14,15],[16,17,18,19,20],[21,22,23,24,25],
                         [1,6,11,16,21],[2,7,12,17,22],[3,8,13,18,23],[4,9,14,19,24],[5,10,15,20,25],[1,7,13,19,25],[5,9,13,17,21]];
begin
  for i in 1..12 loop
    mx := -1;
    foreach v in array lines[i:i] loop
      if nums[v] <> 0 then mx := greatest(mx, (pos ->> nums[v]::text)::int); end if;
    end loop;
    best := least(best, mx);
  end loop;
  return best;
end $$;
create or replace function zi.bingo_run() returns void language plpgsql security definer set search_path = public, zi as $$
declare g record; vballs int[]; pos jsonb; c record; idx int; best int; nw int; share bigint; ids bigint[];
begin
  perform zi.bingo_ensure();
  for g in select * from public.bingo_games where status = 'sale' and starts <= zi.ms() for update skip locked loop
    if g.cards = 0 then update public.bingo_games set status = 'void' where id = g.id; continue; end if;
    vballs := array(select x from generate_series(1, 75) x order by random());
    insert into zi.bingo_secret (game_id, balls) values (g.id, vballs) on conflict do nothing;
    select jsonb_object_agg(b::text, o - 1) into pos from unnest(vballs) with ordinality t(b, o);
    best := 999;
    for c in select id, nums from public.bingo_cards where game_id = g.id loop
      best := least(best, zi.bingo_done_at(c.nums, pos));
    end loop;
    update public.bingo_games set status = 'live', win_idx = best where id = g.id;
  end loop;
  for g in select * from public.bingo_games where status = 'live' and zi.ms() >= starts + (win_idx + 1)::bigint * every_ms + 1500 for update skip locked loop
    select s.balls into vballs from zi.bingo_secret s where s.game_id = g.id;
    select jsonb_object_agg(b::text, o - 1) into pos from unnest(vballs) with ordinality t(b, o);
    ids := array(select id from public.bingo_cards where game_id = g.id and zi.bingo_done_at(nums, pos) = g.win_idx order by id);
    nw := coalesce(array_length(ids, 1), 0);
    share := case when nw > 0 then g.pot / nw else 0 end;
    for c in select bc.id, bc.user_id from public.bingo_cards bc where bc.id = any (ids) loop
      update public.bingo_cards set won = share where id = c.id;
      if share > 0 then perform zi.mv(c.user_id, 'bingo', share, 'bgw', jsonb_build_object('g', g.id)); end if;
      perform zi.day_net(c.user_id, share);
      perform zi.note(c.user_id, 'bgw', share, jsonb_build_object('g', g.id));
      perform zi.ach(c.user_id, 'bingo');
      perform zi.feed(c.user_id, 'bgw', share, jsonb_build_object('g', g.id));
    end loop;
    update public.bingo_games set status = 'done', balls = vballs[1:g.win_idx + 1],
      winners = (select jsonb_agg(jsonb_build_object('card', bc.id, 'user', bc.user_id, 'won', share)) from public.bingo_cards bc where bc.id = any (ids))
    where id = g.id;
  end loop;
  delete from public.bingo_games where starts < zi.ms() - 3 * 86400000::bigint;
end $$;
create or replace function public.bingo_buy(id bigint, n int) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); g public.bingo_games; have int; cost bigint; i int; nums int[]; col int; pick int[];
begin
  select * into g from public.bingo_games x where x.id = bingo_buy.id for update;
  if not found or g.status <> 'sale' or zi.ms() > g.starts - 3000 then perform zi.err('closed'); end if;
  select count(*) into have from public.bingo_cards c where c.game_id = g.id and c.user_id = u;
  if n < 1 or have + n > 6 then perform zi.err('bingo_max'); end if;
  cost := n * g.price;
  perform zi.bet_check(u, cost);
  perform zi.mv(u, 'bingo', -cost, 'bgb', jsonb_build_object('g', g.id, 'n', n));
  perform zi.day_net(u, -cost);
  for i in 1..n loop
    nums := array_fill(0, array[25]);
    for col in 0..4 loop
      pick := array(select x from generate_series(col * 15 + 1, col * 15 + 15) x order by random() limit 5);
      nums[col + 1] := pick[1]; nums[col + 6] := pick[2]; nums[col + 11] := case when col = 2 then 0 else pick[3] end; nums[col + 16] := pick[4]; nums[col + 21] := pick[5];
    end loop;
    insert into public.bingo_cards (game_id, user_id, nums) values (g.id, u, nums);
  end loop;
  update public.bingo_games x set cards = x.cards + n, pot = x.pot + floor(cost * 0.9) where x.id = g.id;
  perform zi.q_add(u, 'bingo', jsonb_build_object('n', n));
  perform zi.add_xp(u, cost);
  return jsonb_build_object('ok', true, 'bal', zi.bal(u));
end $$;
create or replace function public.bingo_state() returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := auth.uid(); cur public.bingo_games; nxt public.bingo_games; drawn int[]; k int;
begin
  perform zi.bingo_run();
  select * into cur from public.bingo_games where status in ('live', 'done') and starts > zi.ms() - 30 * 60000 order by starts desc limit 1;
  select * into nxt from public.bingo_games where status = 'sale' order by starts limit 1;
  if cur.id is not null then
    if cur.status = 'done' then drawn := cur.balls;
    else
      k := least(cur.win_idx + 1, floor((zi.ms() - cur.starts) / cur.every_ms::numeric)::int + 1);
      select s.balls[1:k] into drawn from zi.bingo_secret s where s.game_id = cur.id;
    end if;
  end if;
  return jsonb_build_object('now', zi.ms(),
    'cur', case when cur.id is null then null else to_jsonb(cur) - 'balls' || jsonb_build_object('drawn', to_jsonb(drawn)) end,
    'next', to_jsonb(nxt),
    'mine', coalesce((select jsonb_agg(to_jsonb(c) order by c.id) from public.bingo_cards c where c.user_id = u and c.game_id in (cur.id, nxt.id)), '[]'::jsonb),
    'players', (select count(distinct user_id) from public.bingo_cards c where c.game_id = nxt.id));
end $$;

-- ===== 007_admin.sql =====
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

-- ===== 099_security.sql =====
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
