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
