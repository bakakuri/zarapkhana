/* ზარაფხანა — core: constants, state, Supabase connection, data sync and server actions */
(function () {
  const Z = (window.Z = window.Z || {});

  /* ---------- utilities ---------- */
  Z.skew = 0;
  Z.now = () => Date.now() + Z.skew;
  Z.esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  Z.fmt = (n) => {
    n = Math.round(Number(n) || 0);
    const s = Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return (n < 0 ? '−' : '') + s;
  };
  Z.sfmt = (n) => (n > 0 ? '+' : '') + Z.fmt(n);
  Z.clone = (o) => JSON.parse(JSON.stringify(o));
  Z.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  Z.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  Z.store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  Z.randInt = (n) => { try { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; } catch (e) { return Math.floor(Math.random() * n); } };
  Z.rand = () => { try { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] / 4294967296; } catch (e) { return Math.random(); } };
  Z.hash = (str) => {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0) ^ (h1 >>> 0);
  };

  /* ---------- rounds: 24 h, ending at 00:00 Tbilisi (20:00 UTC) ---------- */
  Z.DAY = 864e5;
  Z.OFFSET = 20 * 3600e3;
  Z.cycleOf = (t) => Math.floor((t - Z.OFFSET) / Z.DAY);
  Z.cycleStart = (c) => c * Z.DAY + Z.OFFSET;
  Z.cycleEnd = (c) => (c + 1) * Z.DAY + Z.OFFSET;
  Z.roundNo = (c) => c - 20700;
  Z.closeMs = () => (Z.state.config.closeMin ?? 60) * 60e3;
  Z.enrollCycle = () => { const t = Z.now(), c = Z.cycleOf(t); return t < Z.cycleEnd(c) - Z.closeMs() ? c : c + 1; };
  Z.dow = (c) => (c + 4) % 7;
  Z.weekStart = (c) => c - Z.dow(c);
  Z.curWeek = () => Z.weekStart(Z.cycleOf(Z.now()));
  Z.weekEnd = (w) => Z.cycleEnd(w + 6);

  Z.TIERS = [
    { k: 'g', name: 'გარანტირებული', lose: 0, risk: 0 },
    { k: 'l', name: 'დაბალი', lose: 25, risk: 1 },
    { k: 'm', name: 'საშუალო', lose: 50, risk: 2 },
    { k: 'h', name: 'მაღალი', lose: 75, risk: 3 },
  ];
  Z.tier = (k) => Z.TIERS.find((t) => t.k === k) || Z.TIERS[0];
  Z.DEFAULT_CONFIG = {
    rates: [{ from: 0, r: { g: 3, l: 40, m: 110, h: 320 } }], bonus: 50, welcome: 500, closeMin: 60, tx: true,
    tour: { on: true, prizes: [1000, 500, 250], min: 10 }, lot: { on: true, price: 20, cut: 10 }, questMult: 1,
    season: { id: 0 }, ann: null, fame: [], evs: [], sched: [], clanPrize: 200, clanWar: { on: true, prize: 1000 },
    bank: { 3: 8, 7: 22, 30: 110, pen: 5 }, ins: { l: 15, m: 30, h: 45, back: 50 }, ref: { on: true, amt: 300, xp: 2000 },
    tax: { on: false, threshold: 50000, pct: 2 }, bingo: { on: true, price: 25, seed: 100, every: 20 }, poker: { on: true, rake: 2 },
    auction: { fee: 5 }, theme: null,
  };
  Z.ratesFor = (cfg, c) => {
    const list = (cfg && cfg.rates && cfg.rates.length ? cfg.rates : Z.DEFAULT_CONFIG.rates).slice().sort((a, b) => a.from - b.from);
    let r = list[0].r;
    for (const e of list) if (e.from <= c) r = e.r;
    return r;
  };
  Z.LEVELS = [
    { k: 'bronze', name: 'ბრინჯაო', xp: 0, mult: 1, col: '#B9773E' },
    { k: 'silver', name: 'ვერცხლი', xp: 1500, mult: 1.25, col: '#9DA4B2' },
    { k: 'gold', name: 'ოქრო', xp: 7500, mult: 1.5, col: '#D9A23A' },
    { k: 'plat', name: 'პლატინა', xp: 30000, mult: 2, col: '#4FB3C8' },
    { k: 'dia', name: 'ბრილიანტი', xp: 100000, mult: 3, col: '#8E7BFF' },
  ];
  Z.levelOf = (xp) => { xp = xp || 0; let i = 0; for (let j = 0; j < Z.LEVELS.length; j++) if (xp >= Z.LEVELS[j].xp) i = j; return Object.assign({ i }, Z.LEVELS[i]); };
  Z.STEP = 5 * 60e3;
  Z.ALPHA = 0.001;
  Z.FEE = 1;
  Z.PRED_CUT = 5;
  Z.CLAN_COST = 500;
  Z.EVENTS = [
    { k: 'xp2', name: 'ორმაგი XP', desc: 'ყოველი ქმედება ორმაგ XP-ს იძლევა' },
    { k: 'bonus2', name: 'ორმაგი დღიური ბონუსი', desc: 'დღიური ბონუსი ორჯერ მეტია' },
    { k: 'quest2', name: 'ორმაგი დავალებები', desc: 'დავალებების ჯილდო ორმაგდება' },
    { k: 'cash10', name: 'ქეშბექი 10%', desc: 'წაგებული თამაშის ფსონის 10% ბრუნდება' },
  ];

  /* ---------- state ---------- */
  const S = (Z.state = {
    mode: 'loading', ready: false, myId: null, isAdmin: false, canWrite: true, me: null, email: '',
    players: new Map(), config: Z.clone(Z.DEFAULT_CONFIG), cycles: new Map(), invs: new Map(), ledger: [], feed: [], notes: [], msgs: new Map(),
    ach: new Map(), weekly: new Map(), lottery: new Map(), lotTix: new Map(), items: new Map(), inv: [], auctions: new Map(), deposits: [],
    pass: new Set(), stocks: new Map(), hist: new Map(), news: [], holdings: new Map(), preds: new Map(), predBets: new Map(), clans: new Map(),
    wars: [], loans: new Map(), duels: new Map(), quests: null, fair: null, limits: null, rt: 'off',
  });
  Z.listeners = new Set();
  Z.on = (fn) => Z.listeners.add(fn);
  let emitQueued = false;
  Z.emit = () => {
    if (emitQueued) return;
    emitQueued = true;
    requestAnimationFrame(() => { emitQueued = false; S.me = composeMe(); Z.listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } }); });
  };

  /* ---------- Supabase ---------- */
  const C = window.ZAR_CONFIG || {};
  Z.configured = !!(C.url && C.anonKey && window.supabase && window.supabase.createClient);
  const sb = (Z.sb = Z.configured ? window.supabase.createClient(C.url, C.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }) : null);
  Z.siteUrl = () => location.origin + location.pathname;

  const ERR = {
    insufficient: 'ბალანსი არ გყოფნის.', auth: 'ჯერ შედი ანგარიშში.', noprofile: 'პროფილი ჯერ იქმნება, სცადე ხელახლა.', frozen: 'შენი ანგარიში დროებით გაყინულია. დაუკავშირდი ადმინს.',
    admin: 'ეს მხოლოდ ადმინს შეუძლია.', bad_amount: 'თანხა არასწორია.', bad_params: 'პარამეტრები არასწორია.', bad_tier: 'დონე არასწორია.', not_found: 'ვერ მოიძებნა.',
    claimed: 'უკვე აღებულია.', not_done: 'ჯერ არ შესრულებულა.', off: 'ეს ფუნქცია ახლა გამორთულია.', tx_off: 'გადარიცხვები გამორთულია.', bad_target: 'მიმღები არასწორია.',
    empty: 'ცარიელი შეტყობინება.', muted: 'ადმინმა ჩატში დაგადუმა.', wait: 'ცოტა შეანელე და სცადე ხელახლა.', no_clan: 'კლანში არ ხარ.', lot_max: 'ერთ კვირაში მაქსიმუმ 100 ბილეთი.',
    unavailable: 'ეს ნივთი ახლა არ იყიდება.', owned: 'ეს ნივთი უკვე გაქვს.', sold_out: 'გაიყიდა, მარაგი ამოიწურა.', not_owned: 'ეს ნივთი არ გაქვს.', bad_hours: 'ხანგრძლივობა არასწორია.',
    closed: 'უკვე დახურულია.', own: 'საკუთარზე ამის გაკეთება არ შეიძლება.', top_already: 'შენი ფსონი უკვე ყველაზე მაღალია.', bid_low: 'ფსონი ძალიან დაბალია.', has_bids: 'უკვე არის ფსონები.',
    bad_days: 'ვადა არასწორია.', locked: 'ჯერ არ გახსნილა.', limit: 'დღის ლიმიტი ამოიწურა.', stock_max: 'ერთ კომპანიაში მაქსიმუმ 1000 აქცია.', bad_option: 'პასუხი არასწორია.',
    one_option: 'ერთ კითხვაზე მხოლოდ ერთი პასუხის არჩევა შეიძლება.', bad_pred: 'ჩაწერე კითხვა და 2–4 პასუხი.', in_clan: 'უკვე კლანში ხარ.', bad_clan: 'სახელი და 2–4 სიმბოლოიანი ტეგი საჭიროა.',
    clan_taken: 'ასეთი სახელი ან ტეგი უკვე არსებობს.', not_owner: 'ეს მხოლოდ კლანის დამფუძნებელს შეუძლია.', treasury_low: 'ხაზინაში საკმარისი თანხა არ არის.', paused: 'თამაშისგან შესვენებაზე ხარ.',
    max_bet: 'ფსონი ზედა ზღვარს აჭარბებს.', lim_wager: 'დღის ფსონების ლიმიტი ამოიწურა.', lim_loss: 'ეს ფსონი დღის წაგების ლიმიტს გადააჭარბებდა.', active_game: 'ჯერ დაასრულე დაწყებული თამაში.',
    game_over: 'თამაში უკვე დასრულდა.', pick_first: 'ჯერ ერთი სვლა მაინც გააკეთე.', no_skips: 'გამოტოვებები ამოიწურა.', not_for_you: 'ეს გამოწვევა სხვისთვისაა.', already: 'უკვე დადებული გაქვს.',
    seat_taken: 'ეს ადგილი დაკავებულია.', not_seated: 'მაგიდასთან არ ზიხარ.', in_hand: 'დაელოდე ხელის დასრულებას.', not_your_turn: 'ახლა შენი სვლა არ არის.', cant_check: 'ჯერ ფსონს უნდა გაუთანაბრდე.',
    cant_call: 'გასათანაბრებელი არაფერია.', raise_small: 'აწევა ძალიან მცირეა.', bingo_max: 'ერთ თამაშზე მაქსიმუმ 6 ბარათი.', name_short: 'სახელი ძალიან მოკლეა.', name_taken: 'ეს სახელი დაკავებულია.',
    bad_pic: 'ფოტო ვერ აიტვირთა.', need_auto: 'რეინვესტირებას ავტო-გაგრძელება სჭირდება.', bad_key: 'პარამეტრი არასწორია.', has_players: 'მაგიდასთან ჯერ ხალხი ზის.', crashed: 'რაკეტა უკვე აფეთქდა.',
  };
  Z.errCode = (e) => { const m = (e && (e.code && !/^\d/.test(e.code) && e.code !== 'P0001' ? 'ZAR:' + e.code : e.message || e.msg || e.error_description)) || String(e || ''); const k = /ZAR:(\w+)/.exec(m); return k ? k[1] : m; };
  Z.errText = (e) => ERR[Z.errCode(e)] || 'ვერ შესრულდა. ' + String(Z.errCode(e) || '').slice(0, 120);
  Z.syncClock = (serverMs) => { if (Number.isFinite(+serverMs)) Z.skew = Z.skew * 0.7 + (+serverMs - Date.now()) * 0.3; };

  // call a database function; refresh what it may have changed
  Z.api = async (fn, args, opts = {}) => {
    if (!sb) throw Object.assign(new Error('offline'), { code: 'offline' });
    const { data, error } = await sb.rpc(fn, args || {});
    if (error) { const e = new Error(error.message); e.code = Z.errCode(error); throw e; }
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      if (data.now) Z.syncClock(data.now);
      if (data.bal != null && S.myId && S.players.get(S.myId)) S.players.set(S.myId, Object.assign({}, S.players.get(S.myId), { balance: +data.bal }));
    }
    if (!opts.quiet) { Z.refreshMine(opts.also, opts.lazy ? 1500 : 120); Z.emit(); }
    return data;
  };
  // like api, but shows the error as a toast and returns null
  Z.act = async (fn, args, opts) => {
    try { const d = await Z.api(fn, args, opts); return d == null ? true : d; }
    catch (e) { if (Z.toast) Z.toast(Z.errText(e), 'loss'); else console.warn(e); return null; }
  };

  /* ---------- reading tables ---------- */
  const T = (t) => sb.from(t);
  async function rows(builder) { const { data, error } = await builder; if (error) throw error; return data || []; }
  async function paged(make, max = 10000) {
    let out = [];
    for (let from = 0; from < max; from += 1000) {
      const part = await rows(make().range(from, from + 999));
      out = out.concat(part);
      if (part.length < 1000) break;
    }
    return out;
  }
  const cfgMerge = (d) => Object.assign(Z.clone(Z.DEFAULT_CONFIG), d || {});
  const mapInv = (r) => ({ id: r.id, uid: r.user_id, t: r.t, a: +r.a, sc: r.sc, sa: r.sa, cp: r.cp, ins: r.ins, ins_c: r.ins_c, cur: r.cur, ls: +r.ls, lc: r.lc, end: r.ended, res: r.res, at: +r.at });
  const achKey = (r) => { const m = S.ach.get(r.user_id) || {}; m[r.k] = +r.at; S.ach.set(r.user_id, m); };
  const setHolding = (r, del) => { const m = Object.assign({}, S.holdings.get(r.user_id) || {}); if (del || !r.n) delete m[r.t]; else m[r.t] = { n: +r.n, c: +r.c }; S.holdings.set(r.user_id, m); };
  const keyW = (w, u) => w + '|' + u;
  const mapLoan = (l) => ({ id: l.id, f: l.lender, to: l.borrower, a: +l.a, r: l.r, d: l.d, st: l.st, at: +l.at, ta: l.ta && +l.ta, due: l.due && +l.due, paid: l.paid, pa: l.pa && +l.pa });
  const mapDuel = (d) => ({ id: d.id, f: d.f, g: d.g, s: +d.s, to: d.target, st: d.st, a: d.a, w: d.w, r: d.r, at: +d.at, ta: d.ta && +d.ta });

  Z.loadAll = async () => {
    const me = S.myId, cw = Z.curWeek();
    const [profiles, config, rounds, active, mine, ledger, feed, notes, msgs, ach, weekly, lottery, lotTix, items, inv, aOpen, aRecent, deposits, pass,
      stocks, news, holdings, preds, predBets, clans, wars, loans, dOpen, dRecent, fair] = await Promise.all([
      paged(() => T('profiles').select('*').order('joined_at')),
      rows(T('config').select('*').eq('id', 1)),
      rows(T('rounds').select('*').order('c', { ascending: false }).limit(30)),
      paged(() => T('investments').select('*').is('ended', null).order('at')),
      rows(T('investments').select('*').eq('user_id', me).order('at', { ascending: false }).limit(40)),
      rows(T('ledger').select('*').eq('user_id', me).order('id', { ascending: false }).limit(120)),
      rows(T('feed').select('*').order('id', { ascending: false }).limit(40)),
      rows(T('notes').select('*').eq('user_id', me).order('id', { ascending: false }).limit(60)),
      rows(T('messages').select('*').order('id', { ascending: false }).limit(250)),
      paged(() => T('achievements').select('*')),
      rows(T('weekly').select('*').in('w', [cw, cw - 7])),
      rows(T('lottery').select('*').gte('w', cw - 28)),
      rows(T('lot_tickets').select('*').in('w', [cw, cw - 7])),
      rows(T('items').select('*').order('ord')),
      rows(T('inventory').select('*').eq('user_id', me).order('id')),
      rows(T('auctions').select('*').eq('status', 'open').order('ends')),
      rows(T('auctions').select('*').order('id', { ascending: false }).limit(30)),
      rows(T('deposits').select('*').eq('user_id', me).order('id', { ascending: false }).limit(30)),
      rows(T('pass_claims').select('*').eq('user_id', me)),
      rows(T('stocks').select('*').order('ord')),
      rows(T('stock_news').select('*').order('id', { ascending: false }).limit(40)),
      paged(() => T('holdings').select('*')),
      rows(T('predictions').select('*').order('id', { ascending: false }).limit(30)),
      rows(T('pred_bets').select('*').eq('user_id', me)),
      rows(T('clans').select('*')),
      rows(T('clan_wars').select('*').in('w', [cw, cw - 7])),
      rows(T('loans').select('*').order('id', { ascending: false }).limit(60)),
      rows(T('duels').select('*').eq('st', 'open').order('id', { ascending: false }).limit(60)),
      rows(T('duels').select('*').order('id', { ascending: false }).limit(60)),
      rows(T('fair').select('*').eq('user_id', me)),
    ]);
    S.players = new Map(profiles.map((p) => [p.id, p]));
    if (config[0]) S.config = cfgMerge(config[0].data);
    S.cycles = new Map(rounds.map((r) => [r.c, r]));
    S.invs = new Map(active.concat(mine).map((r) => [r.id, mapInv(r)]));
    S.ledger = ledger; S.feed = feed; S.notes = notes;
    S.msgs = new Map(msgs.map((m) => [m.id, m]));
    S.ach = new Map(); ach.forEach(achKey);
    S.weekly = new Map(weekly.map((r) => [keyW(r.w, r.user_id), r]));
    S.lottery = new Map(lottery.map((r) => [r.w, r]));
    S.lotTix = new Map(lotTix.map((r) => [keyW(r.w, r.user_id), r]));
    S.items = new Map(items.map((i) => [i.id, i]));
    S.inv = inv;
    S.auctions = new Map(aRecent.concat(aOpen).map((a) => [a.id, a]));
    S.deposits = deposits;
    const sea = (S.config.season || {}).id || 0;
    S.pass = new Set(pass.filter((p) => p.sea === sea).map((p) => p.tier));
    S.stocks = new Map(stocks.map((s) => [s.t, s]));
    S.news = news;
    S.holdings = new Map(); holdings.forEach((h) => setHolding(h));
    S.preds = new Map(preds.map((p) => [p.id, p]));
    S.predBets = new Map(predBets.map((b) => [b.pred_id, b]));
    S.clans = new Map(clans.map((c) => [c.id, c]));
    S.wars = wars;
    S.loans = new Map(loans.map((l) => [l.id, mapLoan(l)]));
    S.duels = new Map(dRecent.concat(dOpen).map((d) => [d.id, mapDuel(d)]));
    S.fair = fair[0] || null;
    const p = S.players.get(me);
    S.isAdmin = !!(p && p.is_admin);
    Z.loadQuests();
    S.ready = true;
    Z.emit();
  };
  Z.loadQuests = async () => { try { S.quests = await Z.api('my_quests', {}, { quiet: true }); Z.emit(); } catch (e) {} };
  Z.loadHist = async () => {
    if (!sb) return;
    const from = Math.floor(Z.now() / Z.STEP) - 290;
    try {
      const h = await paged(() => T('stock_hist').select('t,step,base').gte('step', from).order('step'), 4000);
      const m = new Map();
      for (const r of h) { if (!m.has(r.t)) m.set(r.t, []); m.get(r.t).push({ step: +r.step, base: +r.base }); }
      S.hist = m; S.histAt = Date.now();
      Z.emit();
    } catch (e) { console.warn(e); }
  };

  // after my own actions: reload my profile, ledger, investments, inventory and anything else asked for
  // refreshes never overlap: a request that arrives while one is running is merged into the next run
  let mineTimer = null, mineAlso = new Set(), mineBusy = false, mineAgain = false;
  Z.refreshMine = (also, delay = 120) => {
    for (const a of [].concat(also || [])) mineAlso.add(a);
    clearTimeout(mineTimer);
    mineTimer = setTimeout(runMine, delay);
  };
  async function runMine() {
      if (mineBusy) { mineAgain = true; return; }
      const me = S.myId, extra = [...mineAlso]; mineAlso = new Set();
      if (!me) return;
      mineBusy = true;
      try {
        const jobs = [rows(T('profiles').select('*').eq('id', me)), rows(T('ledger').select('*').eq('user_id', me).order('id', { ascending: false }).limit(120)),
          rows(T('investments').select('*').eq('user_id', me).order('at', { ascending: false }).limit(40)), rows(T('inventory').select('*').eq('user_id', me).order('id'))];
        const [p, led, inv, items] = await Promise.all(jobs);
        if (p[0]) S.players.set(me, p[0]);
        S.ledger = led;
        for (const r of inv) S.invs.set(r.id, mapInv(r));
        S.inv = items;
        if (extra.includes('quests')) await Z.loadQuests();
        if (extra.includes('deposits')) S.deposits = await rows(T('deposits').select('*').eq('user_id', me).order('id', { ascending: false }).limit(30));
        if (extra.includes('pass')) { const sea = (S.config.season || {}).id || 0; S.pass = new Set((await rows(T('pass_claims').select('*').eq('user_id', me))).filter((x) => x.sea === sea).map((x) => x.tier)); }
        if (extra.includes('fair')) S.fair = (await rows(T('fair').select('*').eq('user_id', me)))[0] || null;
        if (extra.includes('bets')) S.predBets = new Map((await rows(T('pred_bets').select('*').eq('user_id', me))).map((b) => [b.pred_id, b]));
        if (extra.includes('notes')) S.notes = await rows(T('notes').select('*').eq('user_id', me).order('id', { ascending: false }).limit(60));
        if (extra.includes('loans')) S.loans = new Map((await rows(T('loans').select('*').order('id', { ascending: false }).limit(60))).map((l) => [l.id, mapLoan(l)]));
        if (extra.includes('holdings')) { const hs = await rows(T('holdings').select('*').eq('user_id', me)); S.holdings.set(me, {}); hs.forEach((h) => setHolding(h)); }
        if (extra.includes('stocks')) { (await rows(T('stocks').select('*'))).forEach((s) => S.stocks.set(s.t, s)); }
        if (extra.includes('clans')) S.clans = new Map((await rows(T('clans').select('*'))).map((c) => [c.id, c]));
        if (extra.includes('profiles')) S.players = new Map((await paged(() => T('profiles').select('*').order('joined_at'))).map((x) => [x.id, x]));
        if (extra.includes('duels')) { const d = await rows(T('duels').select('*').order('id', { ascending: false }).limit(60)); for (const x of d) S.duels.set(x.id, mapDuel(x)); }
        if (extra.includes('auctions')) { const a = await rows(T('auctions').select('*').order('id', { ascending: false }).limit(40)); for (const x of a) S.auctions.set(x.id, x); }
        if (extra.includes('preds')) S.preds = new Map((await rows(T('predictions').select('*').order('id', { ascending: false }).limit(30))).map((x) => [x.id, x]));
        if (extra.includes('lottery')) { const cw = Z.curWeek(); (await rows(T('lot_tickets').select('*').in('w', [cw, cw - 7]))).forEach((r) => S.lotTix.set(keyW(r.w, r.user_id), r)); (await rows(T('lottery').select('*').gte('w', cw - 28))).forEach((r) => S.lottery.set(r.w, r)); }
        if (extra.includes('msgs')) (await rows(T('messages').select('*').order('id', { ascending: false }).limit(250))).forEach((m) => S.msgs.set(m.id, m));
        if (extra.includes('config')) { const c = await rows(T('config').select('*').eq('id', 1)); if (c[0]) S.config = cfgMerge(c[0].data); }
        if (extra.includes('rounds')) { (await rows(T('rounds').select('*').order('c', { ascending: false }).limit(30))).forEach((r) => S.cycles.set(r.c, r)); const act = await paged(() => T('investments').select('*').is('ended', null)); for (const [id, v] of S.invs) if (v.end == null && !act.some((a) => a.id === id) && v.uid !== me) S.invs.delete(id); act.forEach((r) => S.invs.set(r.id, mapInv(r))); }
        if (extra.includes('weekly')) { const cw = Z.curWeek(); (await rows(T('weekly').select('*').in('w', [cw, cw - 7]))).forEach((r) => S.weekly.set(keyW(r.w, r.user_id), r)); }
        S.isAdmin = !!(S.players.get(me) || {}).is_admin;
        Z.emit();
      } catch (e) { console.warn('refresh', e); }
      mineBusy = false;
      if (mineAgain) { mineAgain = false; setTimeout(runMine, 30); }
  }

  /* ---------- realtime (with polling as a safety net) ---------- */
  let channel = null;
  function subscribe() {
    const me = S.myId;
    if (channel) sb.removeChannel(channel);
    channel = sb.channel('zar-' + Math.random().toString(36).slice(2, 9));
    const on = (table, fn, filter) => channel.on('postgres_changes', Object.assign({ event: '*', schema: 'public', table }, filter ? { filter } : {}),
      (p) => { try { fn(p.eventType, p.new || {}, p.old || {}); } catch (e) { console.warn(e); } Z.emit(); });
    on('profiles', (ev, n, o) => { if (ev === 'DELETE') S.players.delete(o.id); else S.players.set(n.id, n); if (n.id === me) S.isAdmin = !!n.is_admin; });
    on('config', (ev, n) => { if (n.data) S.config = cfgMerge(n.data); });
    on('rounds', (ev, n) => { if (n.c != null) { S.cycles.set(n.c, n); Z.refreshMine('rounds'); } });
    on('investments', (ev, n, o) => { if (ev === 'DELETE') S.invs.delete(o.id); else if (n.ended == null || n.user_id === me) S.invs.set(n.id, mapInv(n)); else S.invs.delete(n.id); });
    on('feed', (ev, n) => { if (ev === 'INSERT') { S.feed.unshift(n); S.feed.length = Math.min(S.feed.length, 60); } });
    on('notes', (ev, n) => { if (ev === 'INSERT') { S.notes.unshift(n); Z.refreshMine(); if (Z.onNote) Z.onNote(n); } }, 'user_id=eq.' + me);
    on('messages', (ev, n, o) => { if (ev === 'DELETE') S.msgs.delete(o.id); else if (n.deleted) S.msgs.delete(n.id); else S.msgs.set(n.id, n); });
    on('achievements', (ev, n) => { if (n.user_id) achKey(n); });
    on('weekly', (ev, n) => { if (n.user_id) S.weekly.set(keyW(n.w, n.user_id), n); });
    on('lottery', (ev, n) => { if (n.w != null) S.lottery.set(n.w, n); });
    on('lot_tickets', (ev, n) => { if (n.user_id) S.lotTix.set(keyW(n.w, n.user_id), n); });
    on('inventory', () => Z.refreshMine(), 'user_id=eq.' + me);
    on('auctions', (ev, n) => { if (n.id) S.auctions.set(n.id, n); });
    on('stocks', (ev, n) => { if (n.t) S.stocks.set(n.t, n); });
    on('stock_news', (ev, n) => { if (ev === 'INSERT') S.news.unshift(n); });
    on('holdings', (ev, n, o) => { if (ev === 'DELETE') { for (const [u, m] of S.holdings) if (m[o.t] && (!o.user_id || o.user_id === u)) setHolding({ user_id: u, t: o.t }, true); } else setHolding(n); });
    on('predictions', (ev, n) => { if (n.id) S.preds.set(n.id, n); });
    on('clans', (ev, n, o) => { if (ev === 'DELETE') S.clans.delete(o.id); else S.clans.set(n.id, n); });
    on('clan_wars', (ev, n) => { if (n.w != null) { S.wars = S.wars.filter((x) => !(x.w === n.w && x.a === n.a)).concat([n]); } });
    on('loans', (ev, n) => { if (n.id) S.loans.set(n.id, mapLoan(n)); });
    on('duels', (ev, n, o) => { if (ev === 'DELETE') S.duels.delete(o.id); else { S.duels.set(n.id, mapDuel(n)); if (Z.onDuel) Z.onDuel(mapDuel(n)); } });
    channel.subscribe((st) => { S.rt = st; Z.emit(); });
  }
  // polling: cheap things often, everything now and then
  let pollN = 0;
  async function poll() {
    if (!S.ready || document.visibilityState !== 'visible') return;
    pollN++;
    try {
      if (pollN % 6 === 0 || S.rt !== 'SUBSCRIBED') await Z.loadAll();
      else Z.refreshMine(['config', 'notes']);
    } catch (e) { console.warn('poll', e); }
  }

  /* ---------- composed objects the screens use ---------- */
  Z.player = (pid) => {
    const p = S.players.get(pid);
    if (!p) return null;
    return Object.assign({}, p, { st: Object.assign({}, p.st, { xp: +p.xp }), shop: { eq: p.eq || {} }, ach: S.ach.get(pid) || {}, pf: S.holdings.get(pid) || {}, joinedAt: +p.joined_at,
      pic: p.pic && !p.pic_hidden ? p.pic : '', clan: p.clan_id });
  };
  const HIDE = new Set(['gb']);
  Z.histOf = (rows_) => rows_.filter((r) => !HIDE.has(r.k) && r.k).map((r) => Object.assign({}, r.meta || {}, { k: r.k, d: r.meta && r.meta.d != null ? +r.meta.d : +r.delta, delta: +r.delta, at: +r.at, cat: r.cat, id: r.id }));
  function composeMe() {
    const me = S.myId && Z.player(S.myId);
    if (!me) return null;
    me.invs = [...S.invs.values()].filter((v) => v.uid === S.myId).sort((a, b) => b.at - a.at);
    me.hist = Z.histOf(S.ledger);
    me.shop = { own: S.inv.filter((i) => !i.listed).map((i) => i.item), eq: me.eq || {} };
    me.bonusC = (me.login || {}).d;
    return me;
  }
  Z.allPlayersMap = () => new Map([...S.players.keys()].map((k) => [k, Z.player(k)]));
  Z.bal = (pid) => +((S.players.get(pid) || {}).balance || 0);
  Z.myBal = () => Z.bal(S.myId);
  // winnings not yet revealed by an animation are hidden from the displayed balance
  Z.balHold = 0;
  Z.dispBal = () => Math.max(0, Z.myBal() - Z.balHold);
  Z.locked = (pid) => +((S.players.get(pid) || {}).locked || 0);
  Z.granted = () => 0;
  Z.nameOf = (id) => (id === S.myId ? 'შენ' : (S.players.get(id) || {}).name || 'მოთამაშე');
  Z.realName = (id) => (S.players.get(id) || {}).name || 'მოთამაშე';
  Z.colorOf = (id) => 'hsl(' + (Z.hash(String(id)) % 360) + ' 55% 52%)';
  Z.avatarOf = (id) => { const p = S.players.get(id); return p && p.pic && !p.pic_hidden ? p.pic : ''; };
  Z.resolveNames = () => {};
  Z.invStatus = (inv) => {
    if (inv.end != null) return inv.res === 'l' ? 'lost' : inv.res === 'r' || inv.res === 'x' ? 'refund' : 'done';
    if (inv.cur > Z.cycleOf(Z.now()) && inv.lc == null) return 'queued';
    return 'active';
  };
  Z.lastRec = () => { let m = null; for (const k of S.cycles.keys()) if (m == null || k > m) m = k; return m; };

  /* ---------- auth ---------- */
  Z.auth = {
    async signUp(email, password, name, ref) {
      return sb.auth.signUp({ email, password, options: { emailRedirectTo: Z.siteUrl(), data: { name, ref: ref || Z.store.get('zar-ref', '') || undefined } } });
    },
    async signIn(email, password) { return sb.auth.signInWithPassword({ email, password }); },
    async magic(email, name) { return sb.auth.signInWithOtp({ email, options: { emailRedirectTo: Z.siteUrl(), data: { name: name || undefined, ref: Z.store.get('zar-ref', '') || undefined } } }); },
    async google() { return sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: Z.siteUrl(), queryParams: { prompt: 'select_account' } } }); },
    async reset(email) { return sb.auth.resetPasswordForEmail(email, { redirectTo: Z.siteUrl() }); },
    async newPassword(password) { return sb.auth.updateUser({ password }); },
    async signOut() { try { await sb.auth.signOut(); } catch (e) {} location.hash = ''; location.reload(); },
  };

  /* ---------- boot ---------- */
  Z.boot = async () => {
    const ref = new URLSearchParams(location.search).get('ref');
    if (ref) Z.store.set('zar-ref', ref.toUpperCase().slice(0, 12));
    if (!Z.configured) { S.mode = 'setup'; Z.emit(); return; }
    if (/type=recovery/.test(location.hash)) S.recovery = true;
    const authErr = /error_description=([^&]+)/.exec(location.hash) || /error_description=([^&]+)/.exec(location.search);
    if (authErr) setTimeout(() => Z.toast && Z.toast('შესვლა ვერ მოხერხდა: ' + decodeURIComponent(authErr[1].replace(/\+/g, ' ')), 'loss'), 600);
    sb.auth.onAuthStateChange((ev, session) => {
      if (ev === 'PASSWORD_RECOVERY') { S.recovery = true; Z.emit(); }
      if (ev === 'SIGNED_IN' && session && S.myId !== session.user.id) start(session);
      if (ev === 'SIGNED_OUT' && S.myId) location.reload();
    });
    const { data } = await sb.auth.getSession();
    if (data && data.session) await start(data.session);
    else { S.mode = 'auth'; Z.emit(); }
    sb.rpc('server_now').then(({ data: t }) => { if (t) Z.skew = +t - Date.now(); }).catch(() => {});
  };
  let started = false;
  async function start(session) {
    if (started && S.myId === session.user.id) return;
    started = true;
    S.myId = session.user.id;
    S.email = session.user.email || '';
    S.mode = 'cloud';
    Z.emit();
    for (let i = 0; i < 6; i++) {
      try { await Z.loadAll(); break; } catch (e) { console.warn('load', e); await Z.sleep(800 + i * 700); }
    }
    if (!S.players.get(S.myId)) { await Z.sleep(1500); try { await Z.loadAll(); } catch (e) {} }
    subscribe();
    Z.api('touch', {}, { quiet: true }).catch(() => {});
    Z.api('zar_tick', {}, { quiet: true }).catch(() => {});
    setInterval(poll, 15000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') Z.refreshMine(['config', 'notes', 'rounds']); });
    if (!S.recovery && (location.hash.includes('access_token') || location.search.includes('code='))) history.replaceState(null, '', Z.siteUrl() + '#home');
  }
  // when the round clock ticks over, nudge the scheduler and fetch the results
  Z.cycleTurned = async () => {
    try { await Z.api('zar_tick', {}, { quiet: true }); } catch (e) {}
    setTimeout(() => Z.refreshMine(['rounds', 'notes', 'weekly', 'lottery']), 2500);
  };

  /* =================== server actions =================== */
  // investments
  Z.invest = (t, a, auto, comp, insure) => Z.act('invest', { t, amount: Math.floor(a), auto: !!auto, comp: !!(auto && comp), insure: !!insure });
  Z.setAuto = (id, auto) => Z.act('inv_set', { id, auto });
  Z.setComp = (id, comp) => Z.act('inv_set', { id, comp });
  Z.setIns = (id, insure) => Z.act('inv_set', { id, insure });
  // daily calendar, quests
  Z.claimDaily = () => Z.act('claim_daily', {}, { also: ['quests'] });
  Z.claimQuest = (k) => Z.act('claim_quest', { k }, { also: ['quests'] });
  // transfers, chat
  Z.transfer = (to, a, note) => Z.act('transfer', { to_id: to, amount: Math.floor(a), note: note || '' }, { also: ['quests'] });
  Z.sendMsg = (body, round, toClan) => Z.act('send_msg', { body, round: round ?? null, to_clan: !!toClan }, { also: ['msgs', 'quests'] });
  Z.deleteMsg = (id) => Z.act('delete_msg', { id }, { also: ['msgs'] });
  // lottery, shop, boxes, auctions
  Z.buyTickets = (n) => Z.act('buy_tickets', { n }, { also: ['lottery', 'quests'] });
  Z.buyItem = (id) => Z.act('buy_item', { id });
  Z.equip = (item, on) => Z.act('equip', { item, on_: !!on });
  Z.openBox = (box) => Z.act('open_box', { box }, { also: ['quests'] });
  Z.auctionCreate = (inv_id, start, buyout, hours) => Z.act('auction_create', { inv_id, start, buyout: buyout || null, hours }, { also: ['auctions'] });
  Z.auctionBid = (id, amount) => Z.act('auction_bid', { id, amount }, { also: ['auctions'] });
  Z.auctionCancel = (id) => Z.act('auction_cancel', { id }, { also: ['auctions'] });
  // bank, pass, holidays
  Z.bankOpen = (amount, days) => Z.act('bank_open', { amount, days }, { also: ['deposits', 'quests'] });
  Z.bankClose = (id) => Z.act('bank_close', { id }, { also: ['deposits'] });
  Z.claimPass = (tier) => Z.act('claim_pass', { tier }, { also: ['pass'] });
  Z.collectToken = () => Z.api('collect_token', {});
  // stocks, predictions
  Z.buyStock = (tk, n) => Z.act('buy_stock', { tk, n }, { also: ['holdings', 'stocks', 'quests'] });
  Z.sellStock = (tk, n) => Z.act('sell_stock', { tk, n }, { also: ['holdings', 'stocks'] });
  Z.predBet = (id, o, a) => Z.act('pred_bet', { id, o, a }, { also: ['bets', 'preds'] });
  Z.predCreate = (q, opts, hours) => Z.act('admin_pred_create', { q, opts, hours }, { also: ['preds'] });
  Z.predResolve = (id, res) => Z.act('admin_pred_resolve', { id, res }, { also: ['preds', 'bets'] });
  // clans
  Z.clanCreate = (o) => Z.act('clan_create', { name: o.name, tag: o.tag, color: o.color, open: !!o.open, descr: o.desc || '' }, { also: ['clans', 'profiles'] });
  Z.clanJoin = (id) => Z.act('clan_join', { id }, { also: ['profiles'] });
  Z.clanLeave = () => Z.act('clan_leave', {}, { also: ['clans', 'profiles'] });
  Z.clanApprove = (who, yes) => Z.act('clan_approve', { who, yes }, { also: ['profiles'] });
  Z.clanKick = (who) => Z.act('clan_kick', { who }, { also: ['profiles'] });
  Z.clanUpdate = (patch) => Z.act('clan_update', { open: patch.open ?? null, descr: patch.desc ?? null, color: patch.color ?? null }, { also: ['clans', 'profiles'] });
  Z.clanDonate = (amount) => Z.act('clan_donate', { amount }, { also: ['clans'] });
  Z.clanPayout = () => Z.act('clan_payout', {}, { also: ['clans'] });
  Z.clanBuff = (k) => Z.act('clan_buff', { k }, { also: ['clans'] });
  // loans, duels
  Z.loanOffer = (o) => Z.act('loan_offer', { to_id: o.to, a: o.a, r: o.r, days: o.days }, { also: ['loans'] });
  Z.loanAccept = (id) => Z.act('loan_accept', { id }, { also: ['loans'] });
  Z.loanDecline = (id) => Z.act('loan_decline', { id }, { also: ['loans'] });
  Z.loanRepay = (id) => Z.act('loan_repay', { id }, { also: ['loans'] });
  Z.createDuel = (o) => Z.act('duel_create', { g: o.g, s: o.s, target: o.to || null }, { also: ['duels', 'quests'] });
  Z.acceptDuel = (id) => Z.act('duel_accept', { id }, { also: ['duels', 'quests'] });
  Z.cancelDuel = (id) => Z.act('duel_cancel', { id }, { also: ['duels'] });
  // limits, fairness, profile
  Z.setLimits = (loss, wager) => Z.act('set_limits', { loss: loss || null, wager: wager || null });
  Z.pausePlay = (hours) => Z.act('pause_play', { hours });
  Z.loadLimits = async () => { try { S.limits = await Z.api('my_limits', {}, { quiet: true }); Z.emit(); } catch (e) {} };
  Z.fairRotate = (client) => Z.act('fair_rotate', { new_client: client || null }, { also: ['fair'] });
  Z.setName = (n) => Z.act('set_name', { n }, { also: ['profiles'] });
  Z.uploadPic = async (blob) => {
    const path = S.myId + '/avatar-' + Date.now() + '.webp';
    const up = await sb.storage.from('avatars').upload(path, blob, { upsert: true, contentType: blob.type || 'image/webp' });
    if (up.error) { Z.toast && Z.toast('ფოტო ვერ აიტვირთა: ' + up.error.message, 'loss'); return null; }
    const url = sb.storage.from('avatars').getPublicUrl(path).data.publicUrl;
    return Z.act('set_pic', { url });
  };
  Z.removePic = () => Z.act('set_pic', { url: null });
  // admin
  Z.grant = (who, amount, note) => Z.act('admin_grant', { who, amount, note: note || '' });
  Z.grantAll = (amount, note) => Z.act('admin_grant_all', { amount, note: note || '' }, { also: ['profiles'] });
  Z.bulkGrant = (lines) => Z.act('admin_bulk', { lines }, { also: ['profiles'] });
  Z.saveRates = (r, bonus) => Z.act('admin_set_rates', { r, bonus }, { also: ['config'] });
  Z.saveConfigPatch = (patch) => Z.act('admin_cfg', { patch }, { also: ['config'] });
  Z.setAnn = (t) => Z.act('admin_ann', { t: t || null }, { also: ['config'] });
  Z.setEvent = (k, hours) => Z.act('admin_event', { k, hours }, { also: ['config'] });
  Z.adminUser = (who, field, val) => Z.act('admin_user', { who, field, val }, { also: ['profiles'] });
  Z.setMute = (who, on) => Z.adminUser(who, 'muted', on);
  Z.startSeason = (o) => Z.act('admin_season', { base: o.base, reset: !!o.reset }, { also: ['config', 'profiles'] });

  Z.activeEvents = () => (S.config.evs || []).filter((e) => e.until > Z.now());
  Z.evOn = (k) => Z.activeEvents().some((e) => e.k === k);
  Z.seasonId = () => (S.config.season || {}).id || 0;
})();
