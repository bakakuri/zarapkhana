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
