/* ზარაფხანა — invest, leaderboard, games picker, round announcements, boot */
(function () {
  const Z = window.Z;
  const S = Z.state;
  const { $, $$ } = Z;

  /* =================== INVEST =================== */
  let pickT = Z.store.get('zar-tier', 'm');
  const tiersEl = $('#tiers');
  tiersEl.innerHTML = Z.TIERS.map((T, i) =>
    '<button type="button" class="tier' + (T.k === pickT ? ' on' : '') + '" role="radio" aria-checked="' + (T.k === pickT) + '" data-t="' + T.k + '" style="--tc:' + Z.tierVar(T.k) + ';--i:' + (i + 1) + '">' +
    '<span class="band"></span><span class="pick"></span>' +
    '<span class="tier-top"><span class="tier-name">' + T.name + '</span><span class="meter">' + [0, 1, 2, 3].map((j) => '<i class="' + (j < T.risk || (T.risk === 0 && j === 0) ? 'f' : '') + '"></i>').join('') + '</span></span>' +
    '<span class="tier-rate"><b data-rate>+0%</b><span>დღეში</span></span>' +
    '<span class="odds" title="მოგების შანსი"><i style="width:' + (100 - T.lose) + '%"></i></span>' +
    '<dl><div><dt>აგებს</dt><dd>' + (T.lose ? T.lose + '% მონაწილეების' : 'არავინ') + '</dd></div>' +
    '<div><dt>საშუალო შედეგი</dt><dd data-ev>—</dd></div>' +
    '<div><dt>ამ რაუნდში</dt><dd data-pool>—</dd></div></dl></button>').join('');
  $$('.tier', tiersEl).forEach((el) => {
    el.addEventListener('click', () => { pickT = el.dataset.t; Z.store.set('zar-tier', pickT); syncTier(); updatePreview(); });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      const r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      el.style.setProperty('--ry', ((x - 0.5) * 8).toFixed(2) + 'deg');
      el.style.setProperty('--rx', ((0.5 - y) * 8).toFixed(2) + 'deg');
      el.style.setProperty('--mx', (x * 100).toFixed(1) + '%');
      el.style.setProperty('--my', (y * 100).toFixed(1) + '%');
    });
    el.addEventListener('pointerleave', () => { el.style.setProperty('--rx', '0deg'); el.style.setProperty('--ry', '0deg'); });
  });
  function syncTier() {
    $$('.tier', tiersEl).forEach((el) => { const on = el.dataset.t === pickT; el.classList.toggle('on', on); el.setAttribute('aria-checked', on); });
    const pt = $('#pickedTier');
    pt.textContent = Z.tier(pickT).name;
    pt.style.color = Z.tierVar(pickT);
    $('#insRow').hidden = pickT === 'g';
  }
  syncTier();

  const amt = $('#invAmt'), rng = $('#invRange'), auto = $('#invAuto'), comp = $('#invComp'), ins = $('#invIns');
  const avail = () => Math.max(0, Math.floor(S.me ? Z.dispBal() : 0));
  const insCfg = () => Object.assign({ l: 15, m: 30, h: 45, back: 50 }, S.config.ins || {});
  Z.insPrem = (t, a) => (t === 'g' ? 0 : Math.ceil((a * (+insCfg()[t] || 0)) / 100));
  amt.addEventListener('input', () => { const a = avail(); rng.value = a ? Z.clamp(Math.round(((+amt.value || 0) / a) * 100), 0, 100) : 0; updatePreview(); });
  rng.addEventListener('input', () => { amt.value = Math.max(1, Math.floor((avail() * +rng.value) / 100)); updatePreview(); });
  $$('#invChips [data-pct]').forEach((b) => b.addEventListener('click', () => { const p = +b.dataset.pct; let a = Math.floor((avail() * p) / 100); if (ins.checked && pickT !== 'g') a = Math.floor(a / (1 + (+insCfg()[pickT] || 0) / 100)); amt.value = Math.max(1, a); rng.value = p; updatePreview(); }));
  auto.addEventListener('change', () => { comp.disabled = !auto.checked; if (!auto.checked) comp.checked = false; comp.closest('.check').classList.toggle('dis', !auto.checked); updatePreview(); });
  comp.addEventListener('change', updatePreview);
  ins.addEventListener('change', updatePreview);

  function updatePreview() {
    const T = Z.tier(pickT), rate = Z.ratesFor(S.config, Z.enrollCycle())[pickT];
    const a = Math.floor(+amt.value || 0), profit = Math.floor((a * rate) / 100);
    const useIns = ins.checked && pickT !== 'g', prem = useIns ? Z.insPrem(pickT, a) : 0, back = Math.floor((a * (+insCfg().back || 0)) / 100);
    const ec = Z.enrollCycle(), cur = Z.cycleOf(Z.now());
    const when = ec === cur ? 'ჩაერთვები მიმდინარე რაუნდში #' + Z.roundNo(cur) + ', შედეგი 00:00-ზე.' : 'მიღება დახურულია, ჩაერთვები შემდეგ რაუნდში #' + Z.roundNo(ec) + '.';
    $('#insNote').textContent = pickT === 'g' ? '' : 'წაგებისას ჩადებულის ' + insCfg().back + '% გიბრუნდება. შენატანი: ფსონის ' + insCfg()[pickT] + '% ყოველ რაუნდზე' + (a > 0 ? ' (ახლა ' + Z.fmt(Z.insPrem(pickT, a)) + ' კოინი)' : '') + '.';
    $('#invPreview').innerHTML =
      '<div><small>მოგებისას (' + (100 - T.lose) + '%)</small><b class="pos">+' + Z.fmt(profit - prem) + '</b></div>' +
      '<div><small>წაგებისას (' + T.lose + '%)</small><b class="' + (T.lose ? 'neg' : 'muted') + '">' + (T.lose ? Z.sfmt(-a - prem + (useIns ? back : 0)) : 'შეუძლებელია') + '</b></div>' +
      '<div class="full"><span class="odds"><i style="width:' + (100 - T.lose) + '%"></i></span><p>' + when + ' ' +
      (auto.checked ? (comp.checked ? 'მოგება დაემატება ფსონს და გაგრძელდება ავტომატურად.' : 'მოგება ჩაირიცხება ბალანსზე, ფსონი გაგრძელდება ავტომატურად.') : 'რაუნდის შემდეგ ფსონი მოგებასთან ერთად დაბრუნდება ბალანსზე.') +
      (useIns ? ' დაზღვევის შენატანი: ' + Z.fmt(prem) + ' კოინი.' : '') + '</p></div>';
    const sub = $('#invSubmit');
    const need = a + prem;
    const ok = S.me && !(S.me.frozen) && a > 0 && need <= Z.dispBal();
    sub.disabled = !ok;
    sub.textContent = !S.me ? 'იტვირთება…' : S.me.frozen ? 'ანგარიში გაყინულია' : need > Z.dispBal() ? 'ბალანსი არ გყოფნის' : 'ჩადება · ' + Z.fmt(a) + ' კოინი';
  }
  $('#investForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const a = Math.floor(+amt.value || 0), sub = $('#invSubmit');
    sub.disabled = true;
    const inv = await Z.invest(pickT, a, auto.checked, comp.checked, ins.checked && pickT !== 'g');
    sub.disabled = false;
    if (!inv) return;
    Z.toast('ჩაიდო ' + Z.fmt(a) + ' კოინი · ' + Z.tier(pickT).name + (inv.sc > Z.cycleOf(Z.now()) ? ' (შემდეგი რაუნდი)' : ''), 'win');
    Z.coinFly(sub, $('#myInvs'), 9);
  });

  // current round pool, by tier (everyone's active investments are public)
  function poolStats() {
    const cur = Z.cycleOf(Z.now()), o = {};
    for (const T of Z.TIERS) o[T.k] = { n: 0, s: 0 };
    for (const v of S.invs.values()) if (v.end == null && v.cur === cur && o[v.t]) { o[v.t].n++; o[v.t].s += v.ls; }
    return o;
  }

  function invRows(invs) {
    const cur = Z.cycleOf(Z.now());
    return '<div class="inv-list">' + invs.map((v, i) => {
      const st = Z.invStatus(v);
      const chip = st === 'queued' ? '<span class="chip queued">რაუნდი #' + Z.roundNo(v.cur) + '</span>'
        : st === 'active' ? '<span class="chip open">მიმდინარე</span>'
        : st === 'lost' ? '<span class="chip lost">წაგებული</span>'
        : st === 'refund' ? '<span class="chip">დაბრუნდა</span>'
        : '<span class="chip won">დასრულდა</span>';
      const last = v.lc != null ? (st === 'lost' ? 'წააგო რაუნდ #' + Z.roundNo(v.lc) + '-ში' : 'ბოლოს მოიგო რაუნდ #' + Z.roundNo(v.lc) + '-ში') : 'დაიწყო რაუნდ #' + Z.roundNo(v.sc) + '-დან';
      const live = v.end == null;
      const stopNote = live && v.sa != null ? (v.sa >= cur ? ' · ჩერდება ამ რაუნდის შემდეგ' : '') : '';
      const insNote = v.ins ? ' · დაზღვეული' : '';
      return '<div class="inv-row" style="--tc:' + Z.tierVar(v.t) + ';--k:' + i + '"><span class="ti">' + Z.TIER_LETTER[v.t] + '</span>' +
        '<div class="mid"><b>' + Z.fmt(v.ls) + '</b> <small>' + Z.esc(Z.tier(v.t).name) + ' · ' + last + stopNote + insNote + '</small></div>' + chip +
        (live ? '<div class="ctr">' +
          '<label class="mini-toggle"><input type="checkbox" data-auto="' + v.id + '"' + (v.sa == null ? ' checked' : '') + '><span class="switch"></span>ავტო-გაგრძელება</label>' +
          '<label class="mini-toggle' + (v.sa == null ? '' : ' dis') + '"><input type="checkbox" data-comp="' + v.id + '"' + (v.cp ? ' checked' : '') + (v.sa == null ? '' : ' disabled') + '><span class="switch"></span>რეინვესტირება</label>' +
          (v.t !== 'g' ? '<label class="mini-toggle"><input type="checkbox" data-ins="' + v.id + '"' + (v.ins ? ' checked' : '') + '><span class="switch"></span>დაზღვევა <small class="muted">' + Z.fmt(Z.insPrem(v.t, v.ls)) + '/რაუნდი</small></label>' : '') +
          '</div>' : '') + '</div>';
    }).join('') + '</div>';
  }
  $('#myInvs').addEventListener('change', async (e) => {
    const a = e.target.dataset.auto, c = e.target.dataset.comp, n = e.target.dataset.ins, on = e.target.checked;
    e.target.disabled = true;
    if (a && await Z.setAuto(a, on)) Z.toast(on ? 'ავტო-გაგრძელება ჩართულია' : 'ინვესტიცია შეჩერდება მიმდინარე რაუნდის შემდეგ');
    if (c && await Z.setComp(c, on)) Z.toast(on ? 'მოგება დაემატება ფსონს' : 'მოგება ჩაირიცხება ბალანსზე');
    if (n && await Z.setIns(n, on)) Z.toast(on ? 'დაზღვევა ჩაირთო' : 'დაზღვევა გამოირთო შემდეგი რაუნდიდან');
    e.target.disabled = false;
  });

  Z.renderers.invest = () => {
    const rates = Z.ratesFor(S.config, Z.enrollCycle());
    const pool = poolStats();
    $$('.tier', tiersEl).forEach((el) => {
      const k = el.dataset.t, T = Z.tier(k), r = rates[k];
      el.querySelector('[data-rate]').textContent = '+' + r + '%';
      const ev = ((100 - T.lose) / 100) * (1 + r / 100) - 1;
      const evEl = el.querySelector('[data-ev]');
      evEl.textContent = (ev >= 0 ? '+' : '−') + Math.abs(ev * 100).toFixed(1) + '%';
      evEl.className = ev >= 0 ? 'pos' : 'neg';
      el.querySelector('[data-pool]').textContent = pool[k].n + ' · ' + Z.fmt(pool[k].s) + ' კოინი';
    });
    $('#invAvail').textContent = S.me ? Z.fmt(Z.dispBal()) : '—';
    comp.disabled = !auto.checked;
    updatePreview();
    const mine = S.me ? (S.me.invs || []).slice().sort((a, b) => ((b.end == null) - (a.end == null)) || (b.at - a.at)).slice(0, 25) : [];
    Z.setHTML($('#myInvs'), !S.ready ? '<div class="skeleton" style="height:10rem"></div>' : mine.length ? invRows(mine) : Z.empty('ჯერ ინვესტიცია არ გაქვს. აირჩიე დონე და ჩადე.'));
  };

  /* =================== LEADERS =================== */
  let lbC = null;
  $('#lbPrev').addEventListener('click', () => stepRound(-1));
  $('#lbNext').addEventListener('click', () => stepRound(1));
  function roundKeys() { return [...S.cycles.keys()].sort((a, b) => a - b); }
  Z.setLbRound = (c) => { if (S.cycles.has(c)) lbC = c; };
  function stepRound(d) {
    const ks = roundKeys();
    if (!ks.length) return;
    let i = ks.indexOf(lbC);
    if (i < 0) i = ks.length - 1;
    i = Z.clamp(i + d, 0, ks.length - 1);
    lbC = ks[i];
    Z.renderers.leaders();
    Z.render();
  }
  Z.renderers.leaders = () => {
    const ks = roundKeys();
    if (lbC == null || !S.cycles.has(lbC)) {
      lbC = null;
      for (let i = ks.length - 1; i >= 0; i--) if ((S.cycles.get(ks[i]).e || []).length) { lbC = ks[i]; break; }
      if (lbC == null && ks.length) lbC = ks[ks.length - 1];
    }
    const res = lbC != null ? S.cycles.get(lbC) : null;
    Z.lbC = lbC;
    $('#lbPrev').disabled = !res || ks.indexOf(lbC) <= 0;
    $('#lbNext').disabled = !res || ks.indexOf(lbC) >= ks.length - 1;
    $('#lbLabel').textContent = res ? 'რაუნდი #' + Z.roundNo(res.c) : 'რაუნდები ჯერ არ არის';
    $('#lbDate').textContent = res ? 'დასრულდა ' + Z.fdate(Z.cycleEnd(res.c)) : 'პირველი შედეგები 00:00-ზე';
    const e = res ? res.e || [] : [];
    Z.setHTML($('#lbTiers'), Z.TIERS.map((T) => {
      const xs = e.filter((x) => x.t === T.k);
      const w = xs.filter((x) => x.w).length, l = xs.length - w;
      const rate = res ? (res.r || {})[T.k] : Z.ratesFor(S.config, Z.cycleOf(Z.now()))[T.k];
      return '<div class="tsum" style="--tc:' + Z.tierVar(T.k) + '"><b><span class="tdot"></span>' + T.name + ' · +' + rate + '%</b><span>' + xs.length + ' მონაწილე · ' + w + ' მოიგო · ' + l + ' წააგო</span>' +
        '<span class="bar"><i style="width:' + (xs.length ? (w / xs.length) * 100 : 0) + '%"></i></span></div>';
    }).join(''));
    const ag = res ? Z.aggregate(res) : [];
    const win = ag.filter((a) => a.d > 0).sort((a, b) => b.d - a.d);
    const lose = ag.filter((a) => a.d < 0).sort((a, b) => a.d - b.d);
    const pod = win.slice(0, 3);
    const order = [1, 0, 2];
    Z.setHTML($('#podium'), pod.length ? order.filter((i) => pod[i]).map((i) => {
      const a = pod[i];
      return '<div class="pod p' + (i + 1) + '" style="--k:' + i + '">' + Z.av(a.p) + '<span class="nm">' + Z.nm(a.p) + '</span><span class="v">' + Z.sfmt(a.d) + '</span><span class="step">' + (i + 1) + '</span></div>';
    }).join('') : '');
    $('#podium').hidden = !pod.length;
    $('#podium').style.setProperty('--n', Math.max(1, pod.length));
    const row = (a, i) => '<li style="--k:' + i + '">' + Z.av(a.p) + '<span class="nm">' + Z.nm(a.p) + '<small>ჩადებული ' + Z.fmt(a.s) + ' ' + Z.tierDots(a.tiers) + '</small></span><span class="v ' + (a.d >= 0 ? 'pos' : 'neg') + '">' + Z.sfmt(a.d) + '</span></li>';
    const rest = win.slice(3, 10);
    $('#lbWin').className = 'rank from4';
    Z.setHTML($('#lbWin'), !res ? Z.empty('ჯერ არცერთი რაუნდი არ დასრულებულა.') : !win.length ? Z.empty('ამ რაუნდში მოგებული არ ყოფილა.') : rest.map(row).join(''));
    Z.setHTML($('#lbLose'), !res ? Z.empty('ჯერ არცერთი რაუნდი არ დასრულებულა.') : !lose.length ? Z.empty('ამ რაუნდში არავინ წააგო.') : lose.slice(0, 10).map(row).join(''));
    // richest
    const rich = [...S.players.values()].map((p) => ({ p: p.id, free: Z.bal(p.id), tot: Z.wealthOf(p.id) })).map((x) => Object.assign(x, { lk: x.tot - x.free })).sort((a, b) => b.tot - a.tot).slice(0, 10);
    Z.setHTML($('#richest'), rich.length ? rich.map((x, i) => '<li style="--k:' + i + '">' + Z.av(x.p) + '<span class="nm">' + Z.nm(x.p) + ' ' + Z.lvChip(x.p) + '<small>' + Z.fmt(x.free) + ' თავისუფალი · ' + Z.fmt(x.lk) + ' ინვესტიციებში, ბანკში, აქციებსა და სესხებში</small></span><span class="v">' + Z.fmt(x.tot) + '</span></li>').join('')
      : Z.empty('მოთამაშეები ჯერ არ არიან.'));
  };

  /* =================== GAMES PICKER =================== */
  let curGame = Z.store.get('zar-game', 'crash');
  if (!Z.GAMES.some((g) => g.k === curGame)) curGame = Z.GAMES[0].k;
  const picker = $('#gamePicker'), stage = $('#gameStage');
  picker.innerHTML = Z.GAMES.map((g, i) => '<button type="button" role="tab" class="gcard' + (g.k === curGame ? ' on' : '') + '" data-g="' + g.k + '" style="--i:' + (i + 1) + '"><span class="gicon">' + g.icon + '</span><b>' + g.name + '</b><small>' + g.desc + '</small></button>').join('');
  const mounted = {};
  Z.showGame = (k) => showGame(k);
  Z.curGame = () => curGame;
  function showGame(k) {
    if (!Z.GAMES.some((g) => g.k === k)) return;
    curGame = k; Z.store.set('zar-game', k);
    $$('.gcard', picker).forEach((c) => { c.classList.toggle('on', c.dataset.g === k); c.setAttribute('aria-selected', c.dataset.g === k); });
    for (const g of Z.GAMES) {
      if (g.k === k && !mounted[k]) { const d = document.createElement('div'); d.className = 'game-root'; d.dataset.g = k; stage.appendChild(d); g.mount(d); mounted[k] = d; }
      if (mounted[g.k]) mounted[g.k].hidden = g.k !== k;
    }
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) mounted[k].animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 350, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }
  picker.addEventListener('click', (e) => { const c = e.target.closest('[data-g]'); if (c) showGame(c.dataset.g); });
  Z.renderers.games = () => { if (S.ready && !mounted[curGame]) showGame(curGame); };

  /* =================== ROUND ANNOUNCEMENT =================== */
  function announce(c) {
    const res = S.cycles.get(c);
    if (!res) return;
    const ag = Z.aggregate(res), e = res.e || [];
    const mine = ag.find((a) => a.p === S.myId);
    const win = ag.filter((a) => a.d > 0).sort((a, b) => b.d - a.d).slice(0, 3);
    const lose = ag.filter((a) => a.d < 0).sort((a, b) => a.d - b.d).slice(0, 3);
    Z.openModal('<div class="ann"><span class="big-coin"><svg><use href="#i-borj"/></svg></span><h2 id="modalTitle">რაუნდი #' + Z.roundNo(c) + ' დასრულდა</h2>' +
      (mine ? '<div class="res ' + (mine.d >= 0 ? 'pos' : 'neg') + '">' + Z.sfmt(mine.d) + ' კოინი</div><p>' + (mine.d >= 0 ? 'შენმა ინვესტიციამ მოიგო.' : 'ამჯერად შენმა ინვესტიციამ წააგო.') + '</p>'
        : '<p>' + (e.length ? e.length + ' ინვესტიციიდან ' + e.filter((x) => !x.w).length + ' წააგო.' : 'ამ რაუნდში მონაწილე არ ყოფილა.') + '</p>') +
      (e.length ? '<div class="lr-cols"><div><h4>ტოპ მოგებულები</h4>' + Z.miniRank(win, 'w') + '</div><div><h4>ტოპ წაგებულები</h4>' + Z.miniRank(lose, 'l') + '</div></div>' : '') +
      '<div class="btn-row"><button class="btn primary" data-go="leaders" data-close>სრული რეიტინგი</button><button class="btn ghost" data-close>დახურვა</button></div></div>');
    if (mine && mine.d > 0) setTimeout(() => Z.celebrate($('.ann .res'), mine.d), 350);
  }
  function checkAnnounce() {
    if (!S.ready || !S.myId) return;
    const lr = Z.lastRec();
    const key = 'zar-seen-round-' + S.myId;
    const seen = Z.store.get(key, null);
    if (seen == null) { Z.store.set(key, lr != null ? lr : Z.cycleOf(Z.now()) - 1); return; }
    if (lr == null) return;
    if (lr > seen) {
      Z.store.set(key, lr);
      const res = S.cycles.get(lr);
      // only pop up when I took part or something happened; otherwise the bell has it
      if (res && ((res.e || []).some((x) => x.p === S.myId) || (res.e || []).length)) announce(lr);
    }
  }
  Z.on(checkAnnounce);

  /* =================== BOOT =================== */
  const startView = (location.hash || '').replace('#', '');
  Z.go(Z.VIEWS.includes(startView) ? startView : 'home', { keepScroll: true });
  Z.on(() => { if (S.ready && Z.view === 'admin' && !S.isAdmin) Z.go('home'); });
  Z.boot();
})();
