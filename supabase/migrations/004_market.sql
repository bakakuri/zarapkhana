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
