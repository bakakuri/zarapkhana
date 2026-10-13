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
