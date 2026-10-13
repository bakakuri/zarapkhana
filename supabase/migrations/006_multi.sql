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
