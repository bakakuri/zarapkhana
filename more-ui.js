/* ზარაფხანა — market (stocks, predictions, loans, auction), clans and clan wars, events, CSV export, language */
(function () {
  const Z = window.Z;
  const S = Z.state;
  const { $, $$ } = Z;
  const setHTML = Z.setHTML;
  const pct = (v) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1) + '%';
  const hhmm = (t) => { const d = new Date(t + 4 * 3600e3); return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0'); };
  const nm = (pid) => Z.nm(pid);
  const left = (ms) => { ms = Math.max(0, ms); const d = Math.floor(ms / Z.DAY); return (d ? d + 'დ ' : '') + Z.hms(ms % Z.DAY); };

  /* =================== stock maths (mirror of the server) =================== */
  Z.STOCKS = [];
  const stocks = () => [...S.stocks.values()].sort((a, b) => a.ord - b.ord);
  Z.stepNow = () => Math.floor(Z.now() / Z.STEP);
  Z.held = (t) => +((S.stocks.get(t) || {}).held || 0);
  Z.price = (t) => { const s = S.stocks.get(t); return s ? +s.base * Math.exp(Z.ALPHA * +s.held) : 0; };
  Z.buyQuote = (t, n) => { const s = S.stocks.get(t); return s ? Math.ceil(n * +s.base * Math.exp(Z.ALPHA * (+s.held + n / 2)) * 1.01) : 0; };
  Z.sellQuote = (t, n) => { const s = S.stocks.get(t); return s ? Math.floor(n * +s.base * Math.exp(Z.ALPHA * Math.max(0, +s.held - n / 2)) * 0.99) : 0; };
  Z.priceHist = (t, n) => {
    const s = S.stocks.get(t);
    if (!s) return [{ step: Z.stepNow(), p: 0 }];
    const k = Math.exp(Z.ALPHA * +s.held);
    const h = (S.hist.get(t) || []).filter((x) => x.step <= +s.step);
    const out = h.slice(-n).map((x) => ({ step: x.step, p: x.base * k }));
    if (!out.length || out[out.length - 1].step < +s.step) out.push({ step: +s.step, p: +s.base * k });
    if (out.length === 1) out.unshift({ step: out[0].step - 1, p: out[0].p });
    return out;
  };
  Z.stockValue = (pid) => { const pf = S.holdings.get(pid) || {}; let v = 0; for (const t in pf) v += pf[t].n * Z.price(t); return Math.round(v); };
  Z.stockCost = (pid) => { const pf = S.holdings.get(pid) || {}; let v = 0; for (const t in pf) v += pf[t].c; return v; };
  Z.news = (n) => S.news.slice(0, n);
  let histFor = 0;
  function ensureHist() { if (Date.now() - histFor > 4 * 60e3 || (S.hist.size === 0 && Date.now() - histFor > 20e3)) { histFor = Date.now(); Z.loadHist(); } }

  /* =================== market tabs =================== */
  let mkTab = Z.store.get('zar-mk', 'stocks');
  const TABS = ['stocks', 'pred', 'loans', 'auction'];
  if (!TABS.includes(mkTab)) mkTab = 'stocks';
  function syncTabs() {
    $$('#mkTabs button').forEach((b) => { b.classList.toggle('on', b.dataset.t === mkTab); b.setAttribute('aria-selected', String(b.dataset.t === mkTab)); });
    $('#mkStocks').hidden = mkTab !== 'stocks'; $('#mkPred').hidden = mkTab !== 'pred'; $('#mkLoans').hidden = mkTab !== 'loans'; $('#mkAuction').hidden = mkTab !== 'auction';
  }
  Z.mkTab = (t) => { if (!TABS.includes(t)) return; mkTab = t; Z.store.set('zar-mk', mkTab); syncTabs(); if (t === 'loans' || t === 'pred') Z.refreshMine(t === 'loans' ? ['loans'] : ['preds', 'bets'], 50); if (t === 'auction') Z.refreshMine(['auctions'], 50); render(); };
  $('#mkTabs').addEventListener('click', (e) => { const b = e.target.closest('[data-t]'); if (b) Z.mkTab(b.dataset.t); });
  syncTabs();

  /* =================== stocks =================== */
  let selTk = Z.store.get('zar-tk', 'TECH');
  const change = (tk) => { const h = Z.priceHist(tk, 288); return (h[h.length - 1].p / h[0].p - 1) * 100; };
  function spark(tk) {
    const h = Z.priceHist(tk, 96), ps = h.map((x) => x.p), lo = Math.min(...ps), hi = Math.max(...ps);
    const pts = ps.map((p, i) => ((i / (ps.length - 1)) * 80).toFixed(1) + ',' + (22 - ((p - lo) / (hi - lo || 1)) * 20).toFixed(1)).join(' ');
    return '<svg class="spark ' + (ps[ps.length - 1] >= ps[0] ? 'up' : 'dn') + '" viewBox="0 0 80 24" aria-hidden="true"><polyline points="' + pts + '"/></svg>';
  }
  function renderStocks() {
    if (Z.view !== 'market' || mkTab !== 'stocks') return;
    ensureHist();
    Z.STOCKS = stocks();
    if (!Z.STOCKS.length) { setHTML($('#tkList'), '<li>' + Z.empty('კომპანიები იტვირთება…') + '</li>'); return; }
    if (!S.stocks.get(selTk)) selTk = Z.STOCKS[0].t;
    const pf = S.holdings.get(S.myId) || {};
    const val = Z.stockValue(S.myId), cost = Z.stockCost(S.myId);
    const unr = val - cost, real = +(((S.me || {}).st || {}).stockPnl || 0);
    const tile = (l, v, cls) => '<div class="stat"><small>' + l + '</small><b class="' + (cls || '') + '">' + v + '</b></div>';
    setHTML($('#pfStats'), tile('პორტფელის ღირებულება', Z.fmt(val)) + tile('ჩადებული', Z.fmt(cost)) + tile('მიმდინარე შედეგი', Z.sfmt(unr), unr >= 0 ? 'pos' : 'neg') + tile('რეალიზებული მოგება', Z.sfmt(real), real >= 0 ? 'pos' : 'neg'));
    setHTML($('#tkList'), Z.STOCKS.map((st, i) => {
      const p = Z.price(st.t), c = change(st.t), own = (pf[st.t] || {}).n || 0;
      return '<li style="--k:' + i + '"><button type="button" class="tk' + (st.t === selTk ? ' on' : '') + '" data-tk="' + st.t + '"><span class="tk-id"><b translate="no">' + st.t + '</b><small>' + Z.esc(st.name) + (own ? ' · შენ: ' + own : '') + '</small></span>' + spark(st.t) + '<span class="tk-p"><b class="num">' + p.toFixed(2) + '</b><small class="' + (c >= 0 ? 'pos' : 'neg') + '">' + pct(c) + '</small></span></button></li>';
    }).join(''));
    const st = S.stocks.get(selTk);
    const p = Z.price(st.t), c = change(st.t), h = pf[st.t], H = Z.held(st.t);
    let holders = 0; for (const m of S.holdings.values()) if ((m[st.t] || {}).n) holders++;
    const det = $('#tkDetail');
    const key = st.t + '|' + st.step + '|' + H + '|' + JSON.stringify(h || null) + '|' + Math.floor(Z.dispBal()) + '|' + (S.hist.get(st.t) || []).length;
    if (det._key !== key) {
      const keepN = $('#tkN') ? $('#tkN').value : '10';
      det._key = key;
      det.innerHTML = '<header class="tk-head"><div><p class="eyebrow"><span translate="no">' + st.t + '</span> · ' + holders + ' მფლობელი · ' + H + ' აქცია ბრუნვაში</p><h3>' + Z.esc(st.name) + '</h3></div><div class="tk-big"><b class="num">' + p.toFixed(2) + '</b><small class="' + (c >= 0 ? 'pos' : 'neg') + '">' + pct(c) + ' 24 სთ-ში</small></div></header>' +
        '<div class="chart-box" id="tkChart"></div>' +
        '<div class="tk-trade"><div class="field"><label class="field-lbl" for="tkN">რაოდენობა</label><div class="bet-row"><input id="tkN" type="number" min="1" max="1000" step="1" value="' + Z.esc(keepN) + '" inputmode="numeric"><button type="button" data-q="1">1</button><button type="button" data-q="10">10</button><button type="button" data-q="max">მაქს</button></div></div>' +
        '<div class="tk-quotes" id="tkQ"></div><div class="btn-row"><button class="btn primary" id="tkBuy" style="flex:1">ყიდვა</button><button class="btn danger" id="tkSell" style="flex:1"' + (h ? '' : ' disabled') + '>გაყიდვა</button></div></div>' +
        '<div class="tk-pos">' + (h ? 'შენ გაქვს <b>' + h.n + '</b> აქცია · საშუალო ფასი ' + (h.c / h.n).toFixed(2) + ' · შედეგი <b class="' + (h.n * p - h.c >= 0 ? 'pos' : 'neg') + '">' + Z.sfmt(Math.round(h.n * p - h.c)) + '</b>' : 'ამ კომპანიის აქციები არ გაქვს.') + '</div>' +
        '<p class="muted note">ფასს ცვლის ბაზრის მოძრაობა, ამბები და ის, რამდენ აქციას ფლობენ მოთამაშეები: ყიდვა ფასს ზრდის, გაყიდვა ამცირებს. ყოველ გარიგებაზე საკომისიო ' + Z.FEE + '%. ერთ კომპანიაში მაქსიმუმ 1000 აქცია.</p>';
      const hist = Z.priceHist(st.t, 144).filter((_, i, a) => a.length < 80 || i % 2 === 1);
      Z.lineChart($('#tkChart'), [{ name: st.t, cls: 's1', values: hist.map((x) => ({ x: hhmm(x.step * Z.STEP), y: Math.round(x.p * 100) / 100, label: hhmm(x.step * Z.STEP) })) }], { h: 190, label: st.name + ' ფასი ბოლო 12 საათში', area: true, zero: false });
      quote();
    }
    const news = Z.news(8);
    setHTML($('#newsList'), news.length ? news.map((n, i) => { const s = S.stocks.get(n.t) || { name: n.t }; return '<li style="--k:' + i + '"><span class="nw-t ' + (n.up ? 'pos' : 'neg') + '" translate="no">' + n.t + '</span><span class="nw-h"><b>' + Z.esc(n.h) + '</b><small>' + Z.esc(s.name) + ' · ' + Z.ago(+n.step * Z.STEP) + '</small></span><b class="num ' + (n.up ? 'pos' : 'neg') + '">' + (n.pct > 0 ? '+' : '') + n.pct + '%</b></li>'; }).join('') : '<li class="muted empty-li">ამბები ჯერ არ არის</li>');
    const rank = [...S.holdings.keys()].map((pid) => ({ pid, v: Z.stockValue(pid), r: +(((S.players.get(pid) || {}).st || {}).stockPnl || 0) + Z.stockValue(pid) - Z.stockCost(pid) })).filter((x) => x.v > 0 && S.players.has(x.pid)).sort((a, b) => b.v - a.v).slice(0, 8);
    setHTML($('#pfRank'), rank.length ? rank.map((x, i) => '<li style="--k:' + i + '">' + Z.av(x.pid) + '<span class="nm">' + nm(x.pid) + '<small>შედეგი ' + Z.sfmt(Math.round(x.r)) + '</small></span><span class="v">' + Z.fmt(x.v) + '</span></li>').join('') : Z.empty('აქციები ჯერ არავის უყიდია.'));
  }
  function quote() {
    const q = $('#tkQ'); if (!q) return;
    const n = Math.max(0, Math.floor(+$('#tkN').value || 0));
    const h = (S.holdings.get(S.myId) || {})[selTk];
    q.innerHTML = n ? '<span>ყიდვა: <b class="num">' + Z.fmt(Z.buyQuote(selTk, n)) + '</b></span><span>გაყიდვა: <b class="num">' + (h && n <= h.n ? Z.fmt(Z.sellQuote(selTk, n)) : '—') + '</b></span>' : '';
  }
  $('#tkList').addEventListener('click', (e) => { const b = e.target.closest('[data-tk]'); if (!b) return; selTk = b.dataset.tk; Z.store.set('zar-tk', selTk); renderStocks(); });
  $('#tkDetail').addEventListener('input', (e) => { if (e.target.id === 'tkN') quote(); });
  $('#tkDetail').addEventListener('click', async (e) => {
    const qb = e.target.closest('[data-q]');
    const h = (S.holdings.get(S.myId) || {})[selTk];
    if (qb) {
      let n = +qb.dataset.q;
      if (qb.dataset.q === 'max') { n = 0; while (n < 1000 - ((h || {}).n || 0) && Z.buyQuote(selTk, n + 1) <= Z.dispBal()) n++; if (!n && h) n = h.n; }
      $('#tkN').value = Math.max(1, Math.min(1000, n)); quote(); return;
    }
    const n = Math.floor(+(($('#tkN') || {}).value) || 0);
    const buy = e.target.closest('#tkBuy'), sell = e.target.closest('#tkSell');
    if (!buy && !sell) return;
    if (!(n > 0)) { Z.toast('ჩაწერე რაოდენობა.', 'loss'); return; }
    const b = buy || sell; b.disabled = true;
    if (buy) {
      const r = await Z.buyStock(selTk, n);
      if (r) { Z.toast('ნაყიდია ' + n + ' ' + selTk + ' · ' + Z.fmt(r.cost) + ' კოინი', 'win'); Z.coinFly(b, $('#tkList .tk.on'), 6); }
    } else {
      const r = await Z.sellStock(selTk, n);
      if (r) { Z.toast('გაყიდულია ' + n + ' ' + selTk + ' · +' + Z.fmt(r.pay) + ' კოინი', 'win'); Z.coinFly(b, $('#balPill'), 6); }
    }
    b.disabled = false;
  });

  /* =================== predictions =================== */
  function predCard(p, i) {
    const pools = (p.pools || []).map(Number), tot = +p.tot, mine = S.predBets.get(p.id), open = p.res == null && Z.now() < +p.close;
    const status = p.res != null ? (p.res < 0 ? '<span class="chip">გაუქმდა, ფსონები დაბრუნდა</span>' : '<span class="chip won">შედეგი: <b translate="no">' + Z.esc(p.opts[p.res]) + '</b></span>')
      : open ? '<span class="chip open">ღიაა · <span class="pcd" data-close="' + p.close + '"></span></span>' : '<span class="chip closed">დახურულია, ელოდება შედეგს</span>';
    const opts = p.opts.map((o, j) => {
      const share = tot ? (pools[j] / tot) * 100 : 0, m = pools[j] ? (tot * (100 - Z.PRED_CUT)) / 100 / pools[j] : 0;
      const win = p.res === j, myOpt = mine && mine.o === j;
      return '<div class="po' + (win ? ' win' : '') + (myOpt ? ' mine' : '') + '"><span class="po-bar" style="width:' + share.toFixed(1) + '%"></span><span class="po-l"><b translate="no">' + Z.esc(o) + '</b><small>' + Z.fmt(pools[j]) + ' კოინი · ' + share.toFixed(0) + '%' + (m ? ' · ×' + m.toFixed(2) : '') + '</small></span>' +
        (open && (!mine || myOpt) && S.me ? '<button class="btn sm ' + (myOpt ? 'primary' : '') + '" data-pbet="' + p.id + '|' + j + '">' + (myOpt ? 'დამატება' : 'ფსონი') + '</button>' : '') +
        (S.isAdmin && p.res == null ? '<button class="btn ghost sm" data-pres="' + p.id + '|' + j + '">მოიგო ეს</button>' : '') + '</div>';
    }).join('');
    return '<article class="panel pred r" style="--i:' + (i + 3) + '"><header class="pred-h"><h3 translate="no">' + Z.esc(p.q) + '</h3>' + status + '</header>' +
      '<div class="po-list">' + opts + '</div>' +
      '<div class="pred-f">' + (open && S.me ? '<label class="pa"><span>ფსონის თანხა</span><input type="number" min="1" step="1" value="50" id="pa-' + p.id + '" inputmode="numeric"></label>' : '') +
      '<small class="muted">ფონდი: <b class="num">' + Z.fmt(tot) + '</b> · მოგებულები ინაწილებენ ფონდის ' + (100 - Z.PRED_CUT) + '%-ს' + (mine ? ' · შენი ფსონი: <b>' + Z.fmt(mine.a) + '</b> <span translate="no">„' + Z.esc(p.opts[mine.o]) + '“</span>' + (mine.paid != null ? ' · მიიღე ' + Z.fmt(mine.paid) : '') : '') + '</small>' +
      (S.isAdmin && p.res == null ? '<button class="link danger-link" data-pres="' + p.id + '|-1">გაუქმება და დაბრუნება</button>' : '') + '</div></article>';
  }
  function renderPred() {
    if (Z.view !== 'market' || mkTab !== 'pred') return;
    $('#predAdmin').hidden = !S.isAdmin;
    const list = [...S.preds.values()].sort((a, b) => (a.res != null) - (b.res != null) || b.at - a.at);
    const html = list.length ? list.map(predCard).join('') : '<article class="panel">' + Z.empty(S.isAdmin ? 'პროგნოზი ჯერ არ არის. შექმენი პირველი ზემოთ.' : 'პროგნოზები ჯერ არ არის. მათ ადმინი ქმნის.') + '</article>';
    const box = $('#predList');
    const keep = {};
    box.querySelectorAll('input[id^="pa-"]').forEach((i) => (keep[i.id] = i.value));
    if (setHTML(box, html)) Object.entries(keep).forEach(([id, v]) => { const i = document.getElementById(id); if (i) i.value = v; });
    box.querySelectorAll('.pcd').forEach((el) => (el.textContent = left(+el.dataset.close - Z.now())));
  }
  $('#predList').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-pbet]'), r = e.target.closest('[data-pres]');
    if (b) {
      const [id, j] = b.dataset.pbet.split('|');
      const a = Math.floor(+(document.getElementById('pa-' + id) || {}).value || 0);
      if (!(a > 0) || a > Z.dispBal()) { Z.toast('თანხა არასწორია ან ბალანსი არ გყოფნის.', 'loss'); return; }
      b.disabled = true;
      if (await Z.predBet(+id, +j, a)) { Z.toast('ფსონი მიღებულია · ' + Z.fmt(a) + ' კოინი', 'win'); Z.coinFly(b, b.closest('.pred'), 6); }
      b.disabled = false;
    }
    if (r) {
      const [id, j] = r.dataset.pres.split('|');
      if (r.dataset.armed !== '1') { r.dataset.armed = '1'; const t = r.textContent; r.textContent = 'დაადასტურე'; setTimeout(() => { r.dataset.armed = ''; r.textContent = t; }, 3500); return; }
      const res = await Z.predResolve(+id, +j);
      if (res) Z.toast(res.refund ? 'პროგნოზი გაუქმდა, ფსონები დაბრუნდა.' : 'შედეგი გამოცხადდა · ' + res.winners + ' გამარჯვებული', 'win');
    }
  });
  $('#predForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = $('#pfQ').value.trim(), opts = $$('.pfO').map((i) => i.value.trim()).filter(Boolean);
    if (!q || opts.length < 2) { Z.toast('ჩაწერე კითხვა და მინიმუმ 2 პასუხი.', 'loss'); return; }
    if (await Z.predCreate(q, opts, +$('#pfH').value)) { $('#pfQ').value = ''; Z.toast('პროგნოზი გამოქვეყნდა', 'win'); }
  });

  /* =================== loans =================== */
  let lnPick = null;
  const lnIn = $('#lnTo'), lnRes = $('#lnRes');
  Z.rep = (pid) => { const st = (S.players.get(pid) || {}).st || {}; return { ok: +st.loanOk || 0, bad: +st.loanDef || 0 }; };
  const repChip = (pid) => { const r = Z.rep(pid); return '<span class="rep ' + (r.bad ? 'bad' : r.ok ? 'good' : '') + '">' + r.ok + ' დაფარული · ' + r.bad + ' გადაუხდელი</span>'; };
  const lnList = () => {
    const q = lnIn.value.trim().toLowerCase();
    const ids = [...S.players.values()].filter((p) => p.id !== S.myId && !p.frozen && (!q || p.name.toLowerCase().includes(q))).slice(0, 10).map((p) => p.id);
    lnRes.innerHTML = ids.length ? ids.map((id) => '<li><button type="button" data-id="' + Z.esc(id) + '">' + Z.av(id) + '<span translate="no">' + Z.esc(Z.realName(id)) + '</span>' + repChip(id) + '</button></li>').join('') : '<li class="muted" style="padding:10px">ვერ მოიძებნა</li>';
    lnRes.hidden = false;
  };
  lnIn.addEventListener('focus', lnList); lnIn.addEventListener('input', lnList);
  Z.setLoanTarget = (pid) => { lnPick = pid; lnRes.hidden = true; lnIn.value = ''; $('#lnPick').innerHTML = Z.av(lnPick) + '<span><b>' + nm(lnPick) + '</b><br>' + repChip(lnPick) + '</span>'; lnNote(); };
  lnRes.addEventListener('click', (e) => { const b = e.target.closest('[data-id]'); if (b) Z.setLoanTarget(b.dataset.id); });
  document.addEventListener('click', (e) => { if (!e.target.closest('#mkLoans .search-wrap')) lnRes.hidden = true; });
  function lnNote() {
    const a = Math.floor(+$('#lnA').value || 0), r = Z.clamp(Math.floor(+$('#lnR').value || 0), 0, 50), d = Z.clamp(Math.floor(+$('#lnD').value || 1), 1, 14);
    $('#lnNote').textContent = a > 0 ? 'მსესხებელი დაგიბრუნებს ' + Z.fmt(Math.round(a * (1 + r / 100))) + ' კოინს ' + d + ' დღეში. პროცენტი 0–50%, ვადა 1–14 დღე. უპასუხო შეთავაზება 3 დღეში უქმდება.' : '';
  }
  ['lnA', 'lnR', 'lnD'].forEach((id) => $('#' + id).addEventListener('input', lnNote));
  lnNote();
  $('#lnGo').addEventListener('click', async (e) => {
    if (!lnPick) { Z.toast('ჯერ აირჩიე მსესხებელი.', 'loss'); return; }
    const a = Math.floor(+$('#lnA').value || 0);
    if (!(a > 0) || a > Z.dispBal()) { Z.toast('თანხა არასწორია ან ბალანსი არ გყოფნის.', 'loss'); return; }
    const b = e.currentTarget; b.disabled = true;
    const doc = await Z.loanOffer({ to: lnPick, a, r: Z.clamp(+$('#lnR').value || 0, 0, 50), days: Z.clamp(+$('#lnD').value || 1, 1, 14) });
    b.disabled = false;
    if (doc) { Z.toast('შეთავაზება გაიგზავნა: ' + Z.realName(lnPick), 'win'); Z.coinFly(b, $('#lnMine'), 6); }
  });
  const owed = (l) => Math.round(l.a * (1 + l.r / 100));
  function loanRow(l, i, role) {
    const other = role === 'l' ? l.to : l.f;
    const st = { open: role === 'l' ? 'ელოდება პასუხს' : 'შემოთავაზება', active: 'აქტიური · ვადა ' + left(l.due - Z.now()), done: 'დაფარულია', default: 'გადაუხდელი', cancel: 'გაუქმდა', void: 'სეზონთან ერთად გაუქმდა' }[l.st] || l.st;
    const cls = { open: 'queued', active: 'open', done: 'won', default: 'lost' }[l.st] || '';
    let act = '';
    if (role === 'b' && l.st === 'open') act = '<button class="btn primary sm" data-lacc="' + l.id + '">მიღება</button><button class="btn ghost sm" data-ldec="' + l.id + '">უარი</button>';
    if (role === 'b' && l.st === 'active') act = '<button class="btn primary sm" data-lpay="' + l.id + '">დაფარვა ' + Z.fmt(owed(l)) + '</button>';
    if (role === 'l' && l.st === 'open') act = '<button class="btn ghost sm" data-ldec="' + l.id + '">გაუქმება</button>';
    return '<li style="--k:' + i + '">' + Z.av(other) + '<span class="nm">' + (role === 'l' ? 'შენ → ' : '') + nm(other) + (role === 'b' ? ' → შენ' : '') + '<small>' + Z.fmt(l.a) + ' კოინი · ' + l.r + '% · ' + l.d + ' დღე · დასაბრუნებელი ' + Z.fmt(owed(l)) + (l.paid != null && l.st !== 'done' ? ' · გადახდილი ' + Z.fmt(l.paid) : '') + '</small></span><span class="chip ' + cls + '">' + st + '</span><span class="ln-act">' + act + '</span></li>';
  }
  function renderLoans() {
    if (Z.view !== 'market' || mkTab !== 'loans') return;
    const all = [...S.loans.values()];
    const inc = all.filter((l) => l.to === S.myId).sort((a, b) => b.at - a.at), out = all.filter((l) => l.f === S.myId).sort((a, b) => b.at - a.at);
    setHTML($('#lnMine'), '<h4 class="sub-h">მე მისესხეს</h4><ul class="duel-list ln-list">' + (inc.length ? inc.map((l, i) => loanRow(l, i, 'b')).join('') : '<li class="muted empty-li">არაფერი</li>') + '</ul>' +
      '<h4 class="sub-h">მე ვასესხე</h4><ul class="duel-list ln-list">' + (out.length ? out.map((l, i) => loanRow(l, i, 'l')).join('') : '<li class="muted empty-li">არაფერი</li>') + '</ul>' +
      '<p class="muted note">შენი რეპუტაცია: ' + repChip(S.myId) + '</p>');
  }
  $('#lnMine').addEventListener('click', async (e) => {
    const a = e.target.closest('[data-lacc]'), d = e.target.closest('[data-ldec]'), p = e.target.closest('[data-lpay]');
    const b = a || d || p; if (!b) return;
    b.disabled = true;
    const r = a ? await Z.loanAccept(+a.dataset.lacc) : d ? await Z.loanDecline(+d.dataset.ldec) : await Z.loanRepay(+p.dataset.lpay);
    b.disabled = false;
    if (!r) return;
    if (a) { Z.toast('სესხი მიღებულია', 'win'); Z.coinFly(b, $('#balPill'), 8); }
    if (d) Z.toast('შეთავაზება დაიხურა');
    if (p) { Z.toast('სესხი დაფარულია', 'win'); Z.sfx && Z.sfx('coin'); }
  });

  /* =================== auction =================== */
  const aucOpen = () => [...S.auctions.values()].filter((a) => a.status === 'open' && +a.ends > Z.now() - 5000).sort((a, b) => a.ends - b.ends);
  const minBid = (a) => (a.bid == null ? +a.start : Math.ceil(+a.bid * 1.05));
  function renderAuction() {
    if (Z.view !== 'market' || mkTab !== 'auction') return;
    const fee = (S.config.auction || {}).fee ?? 5;
    $('#aucSub').textContent = 'გამყიდველის საკომისიო ' + fee + '%';
    const list = aucOpen();
    const box = $('#aucList');
    const keep = {};
    box.querySelectorAll('input[id^="ab-"]').forEach((i) => (keep[i.id] = i.value));
    const html = list.length ? list.map((a, i) => {
      const it = S.items.get(a.item) || { id: a.item, cat: '' };
      const mine = a.seller === S.myId, top = a.bidder === S.myId;
      return '<div class="auc-card rar' + (it.rarity || 0) + (top ? ' top' : '') + '" style="--k:' + i + '"><div class="si-prev">' + Z.itemPreview(it) + '</div><b>' + Z.esc(Z.itemName(a.item)) + (a.serial ? ' <small>#' + a.serial + '</small>' : '') + '</b>' +
        '<small class="muted">გამყიდველი ' + nm(a.seller) + '</small>' +
        '<div class="auc-nums"><span><small>' + (a.bid != null ? 'მიმდინარე ფსონი' : 'საწყისი ფასი') + '</small><b class="num">' + Z.fmt(a.bid ?? a.start) + '</b></span>' + (a.buyout ? '<span><small>მაშინვე ყიდვა</small><b class="num">' + Z.fmt(a.buyout) + '</b></span>' : '') +
        '<span><small>დარჩა</small><b class="num auc-left" data-ends="' + a.ends + '">' + left(+a.ends - Z.now()) + '</b></span></div>' +
        (a.bidder ? '<small class="muted">წინ არის ' + nm(a.bidder) + '</small>' : '<small class="muted">ფსონი ჯერ არ არის</small>') +
        (mine ? (a.bidder ? '<span class="chip queued">შენი ლოტია</span>' : '<button class="btn ghost sm" data-acancel="' + a.id + '">მოხსნა</button>')
          : top ? '<span class="chip won">შენ ხარ წინ</span>'
            : '<div class="auc-bid"><input type="number" id="ab-' + a.id + '" min="' + minBid(a) + '" step="1" value="' + minBid(a) + '" inputmode="numeric" aria-label="ფსონი"><button class="btn primary sm" data-abid="' + a.id + '">ფსონი</button>' +
              (a.buyout ? '<button class="btn sm" data-abuy="' + a.id + '">ყიდვა ' + Z.fmt(a.buyout) + '</button>' : '') + '</div>') + '</div>';
    }).join('') : Z.empty('ახლა აქტიური ლოტი არ არის. გაიტანე შენი ნივთი მაღაზიის „ჩემი კოლექციიდან“.', '<button class="btn primary" data-go="shop">ჩემი კოლექცია</button>');
    if (setHTML(box, html)) Object.entries(keep).forEach(([id, v]) => { const i = document.getElementById(id); if (i && +v >= +i.min) i.value = v; });
    const mineAll = [...S.auctions.values()].filter((a) => a.seller === S.myId || a.bidder === S.myId).sort((a, b) => b.id - a.id).slice(0, 20);
    const stName = { open: 'მიმდინარე', sold: 'გაიყიდა', expired: 'არავინ იყიდა', cancel: 'მოხსნილი' };
    setHTML($('#aucMine'), mineAll.length ? mineAll.map((a, i) => {
      const seller = a.seller === S.myId;
      const st = a.status === 'sold' ? (seller ? 'გაიყიდა ' + Z.fmt(a.bid) : 'შენია · ' + Z.fmt(a.bid)) : a.status === 'open' ? (seller ? 'მიმდინარე' : 'შენ ხარ წინ') : stName[a.status] || a.status;
      return '<li style="--k:' + i + '"><span class="si-mini">' + Z.itemPreview(S.items.get(a.item) || { cat: '' }) + '</span><span class="nm">' + Z.esc(Z.itemName(a.item)) + '<small>' + (seller ? 'ვყიდი' : 'ვყიდულობ') + ' · ' + Z.fdate(+a.at).split(',')[0] + '</small></span><span class="chip ' + (a.status === 'sold' ? 'won' : a.status === 'open' ? 'open' : '') + '">' + st + '</span></li>';
    }).join('') : '<li class="muted empty-li">ჯერ არაფერი</li>');
  }
  $('#aucList').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-abid], [data-abuy], [data-acancel]');
    if (!b) return;
    const id = +(b.dataset.abid || b.dataset.abuy || b.dataset.acancel);
    const a = S.auctions.get(id);
    b.disabled = true;
    if (b.dataset.acancel) { if (await Z.auctionCancel(id)) { Z.toast('ლოტი მოიხსნა, ნივთი დაგიბრუნდა'); if (a) S.auctions.set(id, Object.assign({}, a, { status: 'cancel' })); } }
    else {
      const amt = b.dataset.abuy ? +a.buyout : Math.floor(+(document.getElementById('ab-' + id) || {}).value || 0);
      if (!(amt >= minBid(a)) && !(a.buyout && amt >= +a.buyout)) { Z.toast('მინიმალური ფსონია ' + Z.fmt(minBid(a)) + '.', 'loss'); b.disabled = false; return; }
      if (amt > Z.dispBal()) { Z.toast('ბალანსი არ გყოფნის.', 'loss'); b.disabled = false; return; }
      const r = await Z.auctionBid(id, amt);
      if (r) { S.auctions.set(id, r); Z.toast(r.status === 'sold' ? 'ნივთი შენია!' : 'ფსონი მიღებულია · ' + Z.fmt(amt), 'win'); if (r.status === 'sold') Z.celebrate(b, 200); }
    }
    b.disabled = false; Z.emit();
  });
  Z.openSell = (invId) => {
    const iv = S.inv.find((x) => x.id === invId);
    if (!iv) return;
    const it = S.items.get(iv.item) || { cat: '' };
    const fee = (S.config.auction || {}).fee ?? 5;
    Z.openModal('<div class="tx"><h2 id="modalTitle">აუქციონზე გატანა</h2><div class="sell-prev">' + Z.itemPreview(it) + '<b>' + Z.esc(Z.itemName(iv.item)) + '</b></div>' +
      '<div class="ln-row"><div class="field"><label class="field-lbl" for="sellStart">საწყისი ფასი</label><input id="sellStart" type="number" min="1" step="1" value="' + (it.price ? Math.round(it.price * 0.6) : 300) + '" inputmode="numeric"></div>' +
      '<div class="field"><label class="field-lbl" for="sellBuy">მაშინვე ყიდვა (არასავალდებულო)</label><input id="sellBuy" type="number" min="1" step="1" placeholder="—" inputmode="numeric"></div></div>' +
      '<div class="field"><span class="field-lbl">ხანგრძლივობა</span><div class="seg" id="sellHours">' + [[1, '1 სთ'], [6, '6 სთ'], [24, '1 დღე'], [72, '3 დღე']].map(([h, l]) => '<button type="button" data-h="' + h + '" class="' + (h === 24 ? 'on' : '') + '">' + l + '</button>').join('') + '</div></div>' +
      '<p class="muted note">ლოტზე გატანისას ნივთი იხსნება და დაბლოკილია. თუ არავინ იყიდის, დაგიბრუნდება. საკომისიო ' + fee + '%.</p><button class="btn primary wide" id="sellGo">გატანა</button></div>');
    let hours = 24;
    $('#sellHours').addEventListener('click', (e) => { const b = e.target.closest('[data-h]'); if (!b) return; hours = +b.dataset.h; $$('#sellHours button').forEach((x) => x.classList.toggle('on', x === b)); });
    $('#sellGo').addEventListener('click', async (e) => {
      const start = Math.floor(+$('#sellStart').value || 0), buy = Math.floor(+$('#sellBuy').value || 0) || null;
      if (!(start > 0) || (buy && buy < start)) { Z.toast('ფასი არასწორია: მაშინვე ყიდვის ფასი საწყისზე მეტი უნდა იყოს.', 'loss'); return; }
      e.currentTarget.disabled = true;
      const r = await Z.auctionCreate(invId, start, buy, hours);
      if (r) { S.auctions.set(r.id, r); Z.closeModal(); Z.toast('ლოტი გამოქვეყნდა', 'win'); Z.go('market'); Z.mkTab('auction'); }
      else e.currentTarget.disabled = false;
    });
  };

  /* =================== clans and clan wars =================== */
  const COLORS = ['#D9A23A', '#2EC7AE', '#5B8CF2', '#E5484D', '#A78BFA', '#3DD68C'];
  let clanColor = COLORS[0];
  const members = (cid) => [...S.players.values()].filter((p) => p.clan_id === cid && !p.clan_pending).map((p) => p.id);
  const requests = (cid) => [...S.players.values()].filter((p) => p.clan_id === cid && p.clan_pending).map((p) => p.id);
  const wkXp = (pid, w) => +((S.weekly.get(w + '|' + pid) || {}).xp || 0);
  const clanScore = (cid, w) => members(cid).reduce((a, p) => a + wkXp(p, w), 0);
  Z.clanStats = (cid) => { const ms = members(cid), w = Z.curWeek(); return { n: ms.length, wk: clanScore(cid, w), net: ms.reduce((a, p) => a + +((S.weekly.get(w + '|' + p) || {}).net || 0), 0), wealth: ms.reduce((a, p) => a + Z.wealthOf(p), 0) }; };
  Z.clanRanking = () => [...S.clans.values()].map((c) => Object.assign({ c }, Z.clanStats(c.id))).sort((a, b) => b.wk - a.wk || b.wealth - a.wealth);
  const buffLeft = (c, k) => Math.max(0, +((c.buffs || {})[k] || 0) - Z.now());
  function renderWars() {
    const w = Z.curWeek(), cur = S.wars.filter((x) => x.w === w), prev = S.wars.filter((x) => x.w === w - 7);
    const cw = Object.assign({ on: true, prize: 1000 }, S.config.clanWar || {});
    if (!cw.on || (!cur.length && !prev.length)) {
      return setHTML($('#clanWars'), cw.on ? '<div class="wars"><h4>კლანების ომი</h4><p class="muted note">ომები ყოველ ორშაბათს იწყება: კლანები (მინიმუმ 2 წევრით) წყვილდებიან და კვირის განმავლობაში XP-ს აგროვებენ. გამარჯვებულის ხაზინას ემატება ' + Z.fmt(cw.prize) + ' კოინი.</p></div>' : '');
    }
    const cn = (id) => { const c = S.clans.get(id); return c ? '<span class="ctag" style="--cc:' + Z.esc(c.color) + '">' + Z.esc(c.tag) + '</span> <b translate="no">' + Z.esc(c.name) + '</b>' : '<span class="muted">დაშლილი კლანი</span>'; };
    const row = (x, live) => {
      const sa = live ? clanScore(x.a, x.w) : +x.sa, sb = x.b ? (live ? clanScore(x.b, x.w) : +x.sb) : 0, tot = Math.max(1, sa + sb);
      const mineA = Z.clanOf(S.myId) && Z.clanOf(S.myId).id === x.a, mineB = Z.clanOf(S.myId) && Z.clanOf(S.myId).id === x.b;
      return '<div class="war' + (mineA || mineB ? ' mine' : '') + '"><div class="war-side' + (!live && x.winner === x.a ? ' win' : '') + '">' + cn(x.a) + '<b class="num">' + Z.fmt(sa) + ' XP</b></div>' +
        '<div class="war-bar"><i style="width:' + ((sa / tot) * 100).toFixed(1) + '%"></i></div>' +
        '<div class="war-side r' + (!live && x.winner === x.b ? ' win' : '') + '">' + (x.b ? cn(x.b) : '<span class="muted">მოწინააღმდეგე არ ჰყავს</span>') + '<b class="num">' + Z.fmt(sb) + ' XP</b></div></div>';
    };
    setHTML($('#clanWars'), '<div class="wars"><h4>კლანების ომი · ეს კვირა <small class="muted">დარჩა ' + left(Z.weekEnd(w) - Z.now()) + ' · პრიზი ' + Z.fmt(cw.prize) + '</small></h4>' + (cur.length ? cur.map((x) => row(x, true)).join('') : '<p class="muted note">ამ კვირაში წყვილები ჯერ არ შედგენილა.</p>') +
      (prev.length ? '<h4>წინა კვირა</h4>' + prev.map((x) => row(x, false)).join('') : '') + '</div>');
  }
  function renderClans() {
    if (Z.view !== 'leaders') return;
    const prize = S.config.clanPrize ?? 200;
    $('#clanSub').textContent = prize ? 'კვირის საუკეთესო კლანის აქტიური წევრები იღებენ ' + Z.fmt(prize) + ' კოინს' : '';
    const me = S.players.get(S.myId);
    const mine = S.myId ? Z.clanOf(S.myId) : null, req = me && me.clan_id && me.clan_pending ? S.clans.get(me.clan_id) : null;
    const rank = Z.clanRanking();
    let mineHtml = '';
    if (mine) {
      const st = Z.clanStats(mine.id), ms = members(mine.id), owner = mine.owner === S.myId, reqs = owner ? requests(mine.id) : [];
      const pos = rank.findIndex((x) => x.c.id === mine.id) + 1;
      const bx = buffLeft(mine, 'xp10'), bb = buffLeft(mine, 'bonus');
      mineHtml = '<div class="clan-card" style="--cc:' + Z.esc(mine.color) + '"><div class="cc-head"><span class="ctag big">' + Z.esc(mine.tag) + '</span><div translate="no"><h4>' + Z.esc(mine.name) + '</h4><small class="muted">' + Z.esc(mine.descr || '') + '</small></div></div>' +
        '<div class="cc-stats"><div><small>წევრი</small><b>' + st.n + '</b></div><div><small>XP ამ კვირაში</small><b>' + Z.fmt(st.wk) + '</b></div><div><small>ქონება</small><b>' + Z.fmt(st.wealth) + '</b></div><div><small>ადგილი</small><b>#' + (pos || '—') + '</b></div><div><small>ხაზინა</small><b class="gold">' + Z.fmt(mine.treasury) + '</b></div></div>' +
        '<div class="cc-members">' + ms.map((p) => '<span class="cc-m">' + Z.av(p) + (owner && p !== S.myId ? '<button type="button" class="cc-kick" data-ckick="' + Z.esc(p) + '" aria-label="გარიცხვა" title="გარიცხვა">×</button>' : '') + '</span>').join('') + '</div>' +
        '<div class="cc-tre"><div class="field"><label class="field-lbl" for="cdAmt">ხაზინაში შეტანა</label><div class="bet-row"><input id="cdAmt" type="number" min="1" step="1" value="100" inputmode="numeric"><button type="button" class="btn sm" id="cdGo">შეტანა</button></div></div>' +
        '<div class="cc-buffs"><div class="buff' + (bx ? ' on' : '') + '"><b>+10% XP</b><small>' + (bx ? 'აქტიურია ' + left(bx) : '24 სთ · 2 000 ხაზინიდან') + '</small>' + (owner ? '<button class="btn sm" data-cbuff="xp10">' + (bx ? 'გახანგრძლივება' : 'ჩართვა') + '</button>' : '') + '</div>' +
        '<div class="buff' + (bb ? ' on' : '') + '"><b>დღიური ბონუსი ×1.5</b><small>' + (bb ? 'აქტიურია ' + left(bb) : '24 სთ · 1 500 ხაზინიდან') + '</small>' + (owner ? '<button class="btn sm" data-cbuff="bonus">' + (bb ? 'გახანგრძლივება' : 'ჩართვა') + '</button>' : '') + '</div></div>' +
        (owner ? '<button class="btn ghost sm" id="cpGo">ხაზინის თანაბრად განაწილება წევრებზე</button>' : '') + '</div>' +
        (reqs.length ? '<div class="cc-req"><b>გაწევრიანების მოთხოვნები</b>' + reqs.map((p) => '<div class="req">' + Z.av(p) + nm(p) + '<button class="btn primary sm" data-cok="' + Z.esc(p) + '">მიღება</button><button class="btn ghost sm" data-cno="' + Z.esc(p) + '">უარი</button></div>').join('') + '</div>' : '') +
        '<div class="btn-row">' + (owner ? '<button class="btn ghost sm" data-copen="' + (mine.open ? '0' : '1') + '">' + (mine.open ? 'დახურული გახადე' : 'ღია გახადე') + '</button>' : '') +
        '<button class="btn danger sm" id="clanLeave">' + (owner ? 'კლანის დაშლა' : 'კლანიდან გასვლა') + '</button><button class="btn sm" id="clanChat">კლანის ჩატი</button></div>' +
        (owner ? '<p class="muted note">დაშლისას ხაზინა თანაბრად ნაწილდება წევრებზე.</p>' : '') + '</div>';
    } else if (S.me) {
      mineHtml = (req ? '<p class="note muted">მოთხოვნა გაგზავნილია კლანში <span translate="no">„' + Z.esc(req.name) + '“</span>. ელოდება დამფუძნებლის პასუხს. <button class="link" id="clanCancel">გაუქმება</button></p>' : '') +
        '<details class="clan-new"' + (S.clans.size ? '' : ' open') + '><summary>შექმენი საკუთარი კლანი · ' + Z.fmt(Z.CLAN_COST) + ' კოინი</summary>' +
        '<div class="cn-form"><div class="field"><label class="field-lbl" for="cnName">სახელი</label><input id="cnName" type="text" maxlength="30" placeholder="მაგ.: ოქროს ლომები"></div>' +
        '<div class="field"><label class="field-lbl" for="cnTag">ტეგი (2–4 სიმბოლო)</label><input id="cnTag" type="text" maxlength="4" placeholder="LOM"></div>' +
        '<div class="field"><span class="field-lbl">ფერი</span><div class="swatches" id="cnColors">' + COLORS.map((c) => '<button type="button" class="sw-c' + (c === clanColor ? ' on' : '') + '" data-c="' + c + '" style="background:' + c + '" aria-label="ფერი ' + c + '"></button>').join('') + '</div></div>' +
        '<div class="field"><label class="field-lbl" for="cnDesc">აღწერა</label><input id="cnDesc" type="text" maxlength="120" placeholder="ვინ ვართ და რას ვთამაშობთ"></div>' +
        '<label class="check"><input type="checkbox" id="cnOpen" checked><span class="switch"></span><span><b>ღია კლანი</b><small>ნებისმიერს შეუძლია გაწევრიანება. დახურულში მოთხოვნას შენ ადასტურებ.</small></span></label>' +
        '<button class="btn primary" id="cnGo">კლანის შექმნა</button></div></details>';
    }
    const box = $('#clanMine');
    const keep = { n: ($('#cnName') || {}).value, t: ($('#cnTag') || {}).value, d: ($('#cnDesc') || {}).value, o: ($('#cnOpen') || {}).checked, open: ($('.clan-new') || {}).open, cd: ($('#cdAmt') || {}).value };
    if (setHTML(box, mineHtml)) {
      if ($('#cnName')) { if (keep.n != null) $('#cnName').value = keep.n; if (keep.t != null) $('#cnTag').value = keep.t; if (keep.d != null) $('#cnDesc').value = keep.d; if (keep.o != null) $('#cnOpen').checked = keep.o; if (keep.open) $('.clan-new').open = true; }
      if ($('#cdAmt') && keep.cd) $('#cdAmt').value = keep.cd;
    }
    renderWars();
    setHTML($('#clanTable'), '<thead><tr><th>#</th><th>კლანი</th><th>წევრი</th><th>XP ამ კვირაში</th><th>ხაზინა</th><th>ქონება</th><th></th></tr></thead><tbody>' +
      (rank.length ? rank.map((x, i) => {
        const c = x.c, mineC = mine && mine.id === c.id, pending = me && me.clan_id === c.id && me.clan_pending;
        return '<tr style="--k:' + i + '"><td class="num">' + (i + 1) + '</td><td><span class="who"><span class="ctag" style="--cc:' + Z.esc(c.color) + '">' + Z.esc(c.tag) + '</span><span><b translate="no">' + Z.esc(c.name) + '</b><br><small class="muted">' + (c.open ? 'ღია' : 'დახურული') + ' · დამფუძნებელი <span translate="no">' + Z.esc(Z.realName(c.owner)) + '</span></small></span></span></td>' +
          '<td class="num">' + x.n + '</td><td class="num">' + Z.fmt(x.wk) + '</td><td class="num">' + Z.fmt(c.treasury) + '</td><td class="num">' + Z.fmt(x.wealth) + '</td><td>' +
          (mineC ? '<span class="chip won">შენი</span>' : pending ? '<span class="chip queued">მოთხოვნილია</span>' : !mine && S.me ? '<button class="btn sm ' + (c.open ? 'primary' : '') + '" data-cjoin="' + Z.esc(c.id) + '">' + (c.open ? 'გაწევრიანება' : 'მოთხოვნა') + '</button>' : '') + '</td></tr>';
      }).join('') : '<tr><td colspan="7">' + Z.empty('კლანები ჯერ არ არის.') + '</td></tr>') + '</tbody>');
  }
  $('#clanPanel').addEventListener('click', async (e) => {
    const t = e.target;
    const sw = t.closest('[data-c]'); if (sw) { clanColor = sw.dataset.c; $$('#cnColors .sw-c').forEach((x) => x.classList.toggle('on', x === sw)); return; }
    const btn = t.closest('button'); if (!btn) return;
    if (btn.id === 'cnGo') {
      const name = $('#cnName').value.trim(), tag = $('#cnTag').value.trim();
      if (!name || tag.length < 2) { Z.toast('ჩაწერე სახელი და 2–4 სიმბოლოიანი ტეგი.', 'loss'); return; }
      if (Z.dispBal() < Z.CLAN_COST) { Z.toast('კლანის შექმნას სჭირდება ' + Z.fmt(Z.CLAN_COST) + ' კოინი.', 'loss'); return; }
      btn.disabled = true;
      const c = await Z.clanCreate({ name, tag, color: clanColor, open: $('#cnOpen').checked, desc: $('#cnDesc').value.trim() });
      btn.disabled = false;
      if (c) { S.clans.set(c.id, c); Z.toast('კლანი „' + c.name + '“ შეიქმნა!', 'win'); Z.celebrate($('#clanMine'), 300); }
      return;
    }
    const j = btn.dataset.cjoin;
    if (j) { const c = S.clans.get(j); btn.disabled = true; const r = await Z.clanJoin(j); if (r) Z.toast(r.pending ? 'მოთხოვნა გაიგზავნა' : 'შეუერთდი კლანს „' + (c ? c.name : '') + '“', 'win'); return; }
    if (btn.id === 'clanLeave') {
      if (btn.dataset.armed !== '1') { btn.dataset.armed = '1'; btn.textContent = 'დაადასტურე'; setTimeout(() => { btn.dataset.armed = ''; Z.render(); }, 3500); return; }
      if (await Z.clanLeave()) Z.toast('დატოვე კლანი');
      return;
    }
    if (btn.id === 'clanCancel') { Z.clanLeave(); return; }
    if (btn.id === 'clanChat') { Z.chatTab = 'clan'; $('#chatFab').click(); return; }
    if (btn.id === 'cdGo') {
      const a = Math.floor(+$('#cdAmt').value || 0);
      if (!(a > 0) || a > Z.dispBal()) { Z.toast('თანხა არასწორია ან ბალანსი არ გყოფნის.', 'loss'); return; }
      btn.disabled = true; const r = await Z.clanDonate(a); btn.disabled = false;
      if (r) { Z.toast('ხაზინაში შევიდა ' + Z.fmt(a) + ' კოინი', 'win'); Z.coinFly(btn, $('#clanMine .cc-stats'), 6); }
      return;
    }
    if (btn.id === 'cpGo') {
      if (btn.dataset.armed !== '1') { btn.dataset.armed = '1'; btn.textContent = 'დაადასტურე განაწილება'; setTimeout(() => { btn.dataset.armed = ''; Z.render(); }, 3500); return; }
      const r = await Z.clanPayout(); if (r) Z.toast('თითოეულ წევრს დაერიცხა ' + Z.fmt(r) + ' კოინი', 'win');
      return;
    }
    if (btn.dataset.cbuff) { btn.disabled = true; const r = await Z.clanBuff(btn.dataset.cbuff); btn.disabled = false; if (r) { S.clans.set(r.id, r); Z.toast('ბაფი ჩაირთო 24 საათით', 'win'); Z.emit(); } return; }
    if (btn.dataset.ckick) {
      if (btn.dataset.armed !== '1') { btn.dataset.armed = '1'; btn.textContent = '?'; setTimeout(() => { btn.dataset.armed = ''; btn.textContent = '×'; }, 3000); return; }
      if (await Z.clanKick(btn.dataset.ckick)) Z.toast('წევრი გაირიცხა');
      return;
    }
    if (btn.dataset.cok) await Z.clanApprove(btn.dataset.cok, true);
    if (btn.dataset.cno) await Z.clanApprove(btn.dataset.cno, false);
    if (btn.dataset.copen) await Z.clanUpdate({ open: btn.dataset.copen === '1' });
  });

  /* =================== events =================== */
  function renderEvBar() {
    const evs = S.ready ? Z.activeEvents() : [], bar = $('#evBar');
    bar.hidden = !evs.length;
    if (!evs.length) return;
    setHTML(bar, evs.map((e) => { const d = Z.EVENTS.find((x) => x.k === e.k) || { name: e.k }; return '<span class="ev-chip"><b>' + Z.esc(d.name) + '</b><small>დარჩა <span class="ev-left" data-until="' + e.until + '">' + Z.hms(e.until - Z.now()) + '</span></small></span>'; }).join(''));
  }
  function renderEvAdmin() {
    if (Z.view !== 'admin' || !S.isAdmin) return;
    const act = Z.activeEvents();
    setHTML($('#evAdmin'), Z.EVENTS.map((ev) => {
      const a = act.find((x) => x.k === ev.k);
      return '<div class="ev-row' + (a ? ' on' : '') + '"><div><b>' + Z.esc(ev.name) + '</b><small class="muted">' + Z.esc(ev.desc) + (a ? ' · აქტიურია ' + Z.fdate(a.until) + '-მდე' : '') + '</small></div><div class="chips">' +
        [1, 3, 24, 48].map((h) => '<button type="button" class="chip-btn" data-ev="' + ev.k + '|' + h + '">' + h + ' სთ</button>').join('') + (a ? '<button type="button" class="chip-btn stop" data-ev="' + ev.k + '|0">გაჩერება</button>' : '') + '</div></div>';
    }).join(''));
  }
  $('#evAdmin').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-ev]'); if (!b) return;
    const [k, h] = b.dataset.ev.split('|');
    if (await Z.setEvent(k, +h)) Z.toast(+h ? 'ივენთი ჩაირთო ' + h + ' საათით' : 'ივენთი გაჩერდა', 'win');
  });
  setInterval(() => {
    $$('.ev-left').forEach((el) => (el.textContent = Z.hms(Math.max(0, +el.dataset.until - Z.now()))));
    $$('.pcd').forEach((el) => (el.textContent = left(+el.dataset.close - Z.now())));
    $$('.auc-left').forEach((el) => (el.textContent = left(+el.dataset.ends - Z.now())));
  }, 1000);

  /* =================== CSV export of my full history =================== */
  Z.downloadCSV = async () => {
    if (!S.myId) return;
    Z.toast('ისტორია მზადდება…');
    let rows = [];
    try {
      for (let from = 0; from < 20000; from += 1000) {
        const { data, error } = await Z.sb.from('ledger').select('*').eq('user_id', S.myId).order('id', { ascending: false }).range(from, from + 999);
        if (error) throw error;
        rows = rows.concat(data || []);
        if (!data || data.length < 1000) break;
      }
    } catch (e) { Z.toast('ისტორია ვერ ჩამოიტვირთა.', 'loss'); return; }
    const q = (s) => '"' + String(s ?? '').replace(/"/g, '""') + '"';
    const hist = Z.histOf(rows);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const csv = '﻿' + ['თარიღი', 'ოპერაცია', 'კატეგორია', 'თანხა', 'ბალანსი'].join(',') + '\n' +
      hist.map((h) => [Z.fdate(h.at), Z.histText(h), (Z.CAT_NAMES || {})[h.cat] || h.cat, h.delta, (byId.get(h.id) || {}).bal].map(q).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'zarapkhana-history.csv';
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  };
  $('#csvBtn').addEventListener('click', () => Z.downloadCSV());
  $('#langBtn').addEventListener('click', () => Z.setLang && Z.setLang(Z.lang === 'en' ? 'ka' : 'en'));

  /* =================== render =================== */
  function render() { renderStocks(); renderPred(); renderLoans(); renderAuction(); renderClans(); renderEvBar(); renderEvAdmin(); }
  Z.extraRenders.push(render);
  // prices tick every 5 minutes; keep the chart fresh while it is on screen
  setInterval(() => { if (Z.view === 'market' && mkTab === 'stocks' && document.visibilityState === 'visible') { Z.refreshMine(['stocks'], 10); setTimeout(Z.loadHist, 400); } }, 60000);
  setInterval(() => { if (Z.view === 'market' && mkTab === 'auction' && document.visibilityState === 'visible') Z.refreshMine(['auctions'], 10); }, 20000);
})();
