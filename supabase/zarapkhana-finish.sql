-- ზარაფხანა: დასრულება (მეორე ნაწილი)
-- ბაზის დიდი ნაწილი უკვე დაყენებულია. აქ დარჩა მხოლოდ ის ფუნქციები, რომლებიც ჩანაწერებს შლიან (ამიტომ Supabase
-- ამას შენს დადასტურებას ითხოვს), და უსაფრთხოების წესები.
-- SQL Editor → New query → ჩასვი მთლიანად → Run → თუ იკითხავს, „Run this query“.
-- ხელახლა გაშვება უსაფრთხოა.

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
create or replace function zi.duels_tick() returns void language plpgsql security definer set search_path = public, zi as $$
declare d record;
begin
 for d in select * from public.duels where st = 'open' and at < zi.ms() - 48 * 3600000::bigint for update skip locked loop
 update public.duels set st = 'cancel', ta = zi.ms() where id = d.id;
 perform zi.mv(d.f, 'duel', d.s, 'dc', null);
 end loop;
 delete from public.duels where st in ('cancel', 'done') and coalesce(ta, at) < zi.ms() - 7 * 86400000::bigint;
end $$;
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
 for s in select * from public.poker_seats where table_id = tid and (leaving or stack = 0) loop
 if s.stack > 0 then perform zi.mv(s.user_id, 'poker', s.stack, 'pkout', jsonb_build_object('t', tid, 'net', s.stack - s.buyin)); end if;
 delete from public.poker_seats where table_id = tid and seat = s.seat;
 end loop;
end $$;
create or replace function public.poker_leave(tid int) returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare u uuid := zi.me(); x record; st int;
begin
 select * into x from zi.pk_lock_seat(tid, u);
 if (x.s).user_id is null then return public.poker_state(tid); end if;
 if (x.t).stage <> 'idle' and (x.s).in_hand then
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
create or replace function public.admin_poker_delete(tid int) returns void language plpgsql security definer set search_path = public, zi as $$
begin
 perform zi.need_admin();
 if exists (select 1 from public.poker_seats where table_id = tid) then perform zi.err('has_players'); end if;
 delete from public.poker_tables where id = tid;
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
create or replace function public.zar_tick() returns jsonb language plpgsql security definer set search_path = public, zi as $$
declare last bigint; settled int; c int; cur int := zi.cur(); t record; did text[] := '{}'; errs text[] := '{}';
begin
 if not pg_try_advisory_xact_lock(hashtext('zar-tick')) then return jsonb_build_object('busy', true); end if;
 last := coalesce((select (v #>> '{}')::bigint from zi.kv where k = 'tick_at'), 0);
 if auth.uid() is not null and zi.ms() - last < 15000 then return jsonb_build_object('skip', true); end if;
 insert into zi.kv (k, v) values ('tick_at', to_jsonb(zi.ms())) on conflict (k) do update set v = excluded.v;
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
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function zi.on_signup();
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
do $$
declare t text;
begin
 foreach t in array array['profiles', 'feed', 'achievements', 'weekly', 'investments', 'rounds', 'lot_tickets', 'lottery', 'inventory',
 'auctions', 'stock_hist', 'stock_news', 'holdings', 'predictions', 'clans', 'clan_wars', 'duels', 'live_rounds', 'live_bets',
 'poker_tables', 'poker_seats', 'bingo_games', 'bingo_cards'] loop
 execute format('create policy zar_read on public.%I for select to authenticated using (true)', t);
 end loop;
end $$;
create policy zar_read on public.config for select to anon, authenticated using (true);
create policy zar_read on public.items for select to anon, authenticated using (true);
create policy zar_read on public.stocks for select to anon, authenticated using (true);
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
create policy zar_read on public.ledger for select to authenticated
 using (user_id = auth.uid() or coalesce((select p.is_admin from public.profiles p where p.id = auth.uid()), false));
create policy zar_read on public.eco for select to authenticated
 using (coalesce((select p.is_admin from public.profiles p where p.id = auth.uid()), false));
create policy zar_read on public.messages for select to authenticated using (
 not deleted and (
 (clan_id is null and (user_id = auth.uid()
 or not coalesce((select p.muted from public.profiles p where p.id = messages.user_id), false)
 or coalesce((select p.is_admin from public.profiles p where p.id = auth.uid()), false)))
 or clan_id = (select p.clan_id from public.profiles p where p.id = auth.uid() and not p.clan_pending)
 ));
revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;
revoke all on all tables in schema zi from public, anon, authenticated;
revoke all on all functions in schema zi from public, anon, authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
grant execute on function public.server_now() to anon;
revoke execute on function public.zar_tick() from anon;
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
