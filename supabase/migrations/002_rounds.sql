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
