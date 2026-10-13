/* ზარაფხანა — login calendar, bank deposits, holiday banner and catchable tokens */
(function () {
  const Z = window.Z;
  const S = Z.state;
  const { $, $$ } = Z;
  const setHTML = Z.setHTML;
  const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const left = (ms) => { ms = Math.max(0, ms); const d = Math.floor(ms / Z.DAY); return (d ? d + 'დ ' : '') + Z.hms(ms % Z.DAY); };

  /* =================== 7-day login calendar =================== */
  const CAL = [1, 1.5, 2, 3, 4, 6, 10];
  Z.calDay = () => {
    const lg = (S.me && S.me.login) || {}, cur = Z.cycleOf(Z.now());
    if (+lg.d === cur) return { claimed: true, s: +lg.s || 1 };
    return { claimed: false, s: +lg.d === cur - 1 ? ((+lg.s || 0) % 7) + 1 : 1 };
  };
  Z.calAmt = (s) => {
    const me = S.me; if (!me) return 0;
    let m = Z.levelOf(+me.xp).mult * (Z.evOn('bonus2') ? 2 : 1);
    const c = Z.clanOf(S.myId);
    if (c && +((c.buffs || {}).bonus || 0) > Z.now()) m *= 1.5;
    return Math.floor((S.config.bonus || 0) * CAL[s - 1] * m);
  };
  function renderCal() {
    if (Z.view !== 'home') return;
    const panel = $('#calPanel');
    panel.hidden = !S.ready || !S.me || !(S.config.bonus > 0);
    if (panel.hidden) return;
    const { claimed, s } = Z.calDay();
    const sub = $('#calSub');
    if (claimed) { sub.dataset.wait = '1'; } else { delete sub.dataset.wait; sub.textContent = s > 1 ? 'სერია: ' + (s - 1) + ' დღე ზედიზედ · არ გაწყვიტო!' : 'შემოდი ყოველდღე: ჯილდო იზრდება'; }
    setHTML($('#calGrid'), CAL.map((f, i) => {
      const d = i + 1, done = claimed ? d <= s : d < s, today = !claimed && d === s, next = claimed && d === (s % 7) + 1;
      return '<div class="cal-d' + (done ? ' done' : '') + (today ? ' today' : '') + (next ? ' next' : '') + (d === 7 ? ' big' : '') + '" style="--k:' + i + '"><small>დღე ' + d + '</small>' +
        (d === 7 ? '<span class="cal-ic gift"><svg><use href="#i-gift"/></svg></span>' : '<span class="cal-ic"><svg><use href="#i-borj"/></svg></span>') +
        '<b class="num">' + Z.fmt(Z.calAmt(d)) + '</b>' + (d === 7 ? '<small>+ ყუთი</small>' : '<small>×' + f + '</small>') +
        (today ? '<button class="btn primary sm" id="calClaim">აღება</button>' : done ? '<span class="cal-ok">✓</span>' : '') + '</div>';
    }).join(''));
  }
  $('#calGrid').addEventListener('click', async (e) => {
    const b = e.target.closest('#calClaim'); if (!b) return;
    b.disabled = true;
    const r = await Z.claimDaily();
    if (r && r.amt) {
      Z.toast('დღე ' + r.s + ': +' + Z.fmt(r.amt) + ' კოინი' + (r.box ? ' და საჩუქრად ყუთი!' : ''), 'win');
      Z.coinFly(b, $('#balPill'), 10);
      if (r.box) Z.celebrate(b, 400);
      const p = S.players.get(S.myId); if (p) p.login = { d: Z.cycleOf(Z.now()), s: r.s, n: ((p.login || {}).n || 0) + 1 };
      Z.emit();
    } else b.disabled = false;
  });

  /* =================== bank deposits =================== */
  let bankDays = Z.store.get('zar-bank-d', 7);
  const bankCfg = () => Object.assign({ 3: 8, 7: 22, 30: 110, pen: 5 }, S.config.bank || {});
  function bankForm() {
    const c = bankCfg();
    setHTML($('#bankDays'), [3, 7, 30].map((d) => '<button type="button" data-d="' + d + '" class="' + (d === bankDays ? 'on' : '') + '"><b>' + d + ' დღე</b><small>+' + c[d] + '%</small></button>').join(''));
    const a = Math.floor(+$('#bankAmt').value || 0);
    $('#bankGain').innerHTML = a > 0 ? 'ვადის ბოლოს: <b class="num pos">' + Z.fmt(a + Math.floor((a * c[bankDays]) / 100)) + '</b>' : '';
    $('#bankNote').textContent = 'ანაბარი დაცულია: თანხა არ იკარგება. ვადამდე დახურვისას პროცენტი არ ერიცხება და ' + c.pen + '% ჯარიმა ჩამოიჭრება. მინიმუმ 10 კოინი.';
    const go = $('#bankGo');
    go.disabled = !S.me || !(a >= 10) || a > Z.dispBal();
    go.textContent = a > Z.dispBal() ? 'ბალანსი არ გყოფნის' : 'ანაბრის გახსნა · ' + bankDays + ' დღე';
  }
  $('#bankDays').addEventListener('click', (e) => { const b = e.target.closest('[data-d]'); if (!b) return; bankDays = +b.dataset.d; Z.store.set('zar-bank-d', bankDays); bankForm(); });
  $('#bankAmt').addEventListener('input', bankForm);
  $('#bankGo').addEventListener('click', async (e) => {
    const a = Math.floor(+$('#bankAmt').value || 0), b = e.currentTarget;
    b.disabled = true;
    const d = await Z.bankOpen(a, bankDays);
    if (d) { S.deposits = [d].concat(S.deposits.filter((x) => x.id !== d.id)); Z.toast('ანაბარი გაიხსნა: ' + Z.fmt(a) + ' კოინი, ' + bankDays + ' დღე', 'win'); Z.coinFly(b, $('#depList'), 8); Z.emit(); }
    bankForm();
  });
  function renderBank() {
    if (Z.view !== 'invest') return;
    bankForm();
    const pen = bankCfg().pen;
    const list = S.deposits.slice(0, 12);
    const keepArmed = $('#depList [data-armed="1"]');
    if (keepArmed) return;
    setHTML($('#depList'), list.length ? list.map((d, i) => {
      const act = d.status === 'active', tot = +d.ends - +d.start, done = Z.clamp((Z.now() - +d.start) / tot, 0, 1);
      const gain = Math.floor((+d.a * +d.rate) / 100);
      const st = act ? 'დარჩა <span class="dep-left" data-ends="' + d.ends + '">' + left(+d.ends - Z.now()) + '</span>' : d.status === 'done' ? 'დასრულდა · მიიღე ' + Z.fmt(d.paid) : d.status === 'closed' ? 'ვადამდე დაიხურა · დაბრუნდა ' + Z.fmt(d.paid) : 'გაუქმდა';
      return '<li class="dep' + (act ? ' act' : '') + '" style="--k:' + i + '"><div class="dep-top"><b class="num">' + Z.fmt(d.a) + '</b><small>' + d.days + ' დღე · +' + d.rate + '% = <span class="pos">+' + Z.fmt(gain) + '</span></small></div>' +
        (act ? '<span class="dep-bar"><i style="width:' + (done * 100).toFixed(1) + '%"></i></span>' : '') +
        '<div class="dep-foot"><small class="muted">' + st + '</small>' + (act ? '<button class="link danger-link" data-dclose="' + d.id + '">ვადამდე დახურვა (−' + pen + '%)</button>' : '') + '</div></li>';
    }).join('') : '<li class="muted empty-li">ანაბარი ჯერ არ გაქვს. თანხა უსაფრთხოდ იზრდება ვადის ბოლომდე.</li>');
  }
  $('#depList').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-dclose]'); if (!b) return;
    if (b.dataset.armed !== '1') { b.dataset.armed = '1'; const t = b.textContent; b.textContent = 'დაადასტურე: პროცენტი დაიკარგება'; setTimeout(() => { b.dataset.armed = ''; b.textContent = t; }, 3500); return; }
    b.dataset.armed = '';
    const r = await Z.bankClose(+b.dataset.dclose);
    if (r != null && r !== false) { Z.toast('ანაბარი დაიხურა: დაბრუნდა ' + Z.fmt(r) + ' კოინი'); const d = S.deposits.find((x) => x.id === +b.dataset.dclose); if (d) { d.status = 'closed'; d.paid = r; } Z.emit(); }
  });
  setInterval(() => { $$('.dep-left').forEach((el) => (el.textContent = left(+el.dataset.ends - Z.now()))); }, 1000);

  /* =================== holiday: banner + tokens to catch =================== */
  const HOL = {
    halloween: { name: 'ჰელოუინი', tok: 'გოგრა', key: 'pump', item: 'fr-pumpkin', desc: 'გვერდზე დროდადრო გოგრები ჩნდება: დაიჭირე და მიიღე კოინები. 30 გოგრაზე გელოდება „გოგრის ჩარჩო“, მაღაზიაში კი დღესასწაულის ნივთებია.' },
    newyear: { name: 'ახალი წელი', tok: 'ფიფქი', key: 'snow', item: 'fr-snow', desc: 'გვერდზე დროდადრო ფიფქები ჩნდება: დაიჭირე და მიიღე კოინები. 30 ფიფქზე გელოდება „თოვლის ჩარჩო“, მაღაზიაში კი დღესასწაულის ნივთებია.' },
  };
  const TOK_SVG = {
    halloween: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 12c-2-4 1-7 4-8" stroke="#3f6b2a" stroke-width="3" fill="none" stroke-linecap="round"/><ellipse cx="17" cy="28" rx="10" ry="13" fill="#e9731b"/><ellipse cx="31" cy="28" rx="10" ry="13" fill="#e9731b"/><ellipse cx="24" cy="28" rx="9" ry="14" fill="#f58a2a"/><path d="M17 25l3-4 3 4zM25 25l3-4 3 4z" fill="#3a1d05"/><path d="M15 32q9 8 18 0l-3 1-3-2-3 2-3-2-3 2z" fill="#3a1d05"/></svg>',
    newyear: '<svg viewBox="0 0 48 48" aria-hidden="true"><g stroke="#7fd3ff" stroke-width="3" stroke-linecap="round" fill="none"><path d="M24 4v40M6.7 14l34.6 20M6.7 34l34.6-20"/><path d="M24 10l-4-4M24 10l4-4M24 38l-4 4M24 38l4 4M11 16.5l-5.5-.5M11 16.5l-1.5-5.3M37 31.5l5.5.5M37 31.5l1.5 5.3M11 31.5l-1.5 5.3M11 31.5l-5.5.5M37 16.5l1.5-5.3M37 16.5l5.5-.5"/></g><circle cx="24" cy="24" r="4" fill="#dff4ff"/></svg>',
  };
  function renderHoliday() {
    const h = Z.holiday(), el = $('#holiday');
    if (!h || !S.ready || Z.view !== 'home') { el.hidden = true; return; }
    const H = HOL[h], st = (S.me && S.me.st) || {}, n = +st[H.key] || 0, got = S.inv.some((i) => i.item === H.item);
    el.hidden = false;
    setHTML(el, '<span class="hol-ic">' + TOK_SVG[h] + '</span><div><b>' + H.name + ' ზარაფხანაში!</b><small>' + H.desc + '</small></div>' +
      '<div class="hol-prog"><small>' + H.tok + ': <b class="num">' + Math.min(n, 30) + '</b> / 30</small><span class="qbar"><i style="width:' + Math.min(100, (n / 30) * 100) + '%"></i></span>' + (got ? '<small class="pos">ჩარჩო მიღებულია ✓</small>' : '') + '</div>' +
      '<button class="btn sm" data-go="shop">მაღაზია</button>');
  }
  // tokens: one appears every ~2 minutes while the page is open; the server limits to 20 a day, 90 s apart
  let tokTimer = null, tokDone = Z.store.get('zar-tok-done', -1), tokEl = null;
  function scheduleToken(ms) { clearTimeout(tokTimer); tokTimer = setTimeout(spawnToken, ms); }
  function spawnToken() {
    const h = Z.holiday();
    if (!h || !S.ready || !S.me || tokDone === Z.cycleOf(Z.now()) || document.visibilityState !== 'visible' || (S.me && S.me.frozen)) { scheduleToken(60e3); return; }
    if (tokEl) tokEl.remove();
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'token ' + h; b.innerHTML = TOK_SVG[h];
    b.setAttribute('aria-label', 'დაიჭირე: ' + HOL[h].tok);
    const x = 8 + Math.random() * 80, y = 18 + Math.random() * 64;
    b.style.left = x + 'vw'; b.style.top = y + 'vh';
    if (!reduce()) b.style.setProperty('--dx', (Math.random() < 0.5 ? -1 : 1) * (20 + Math.random() * 40) + 'px');
    $('#tokenLayer').appendChild(b);
    tokEl = b;
    const gone = setTimeout(() => { b.classList.add('out'); setTimeout(() => b.remove(), 400); tokEl = null; }, 14000);
    b.addEventListener('click', async () => {
      clearTimeout(gone);
      b.disabled = true; b.classList.add('caught');
      try {
        const r = await Z.collectToken();
        Z.toast(HOL[h].tok + ' დაიჭირე! +' + Z.fmt(r.amt) + ' კოინი · ' + Math.min(30, r.cnt) + ' / 30' + (r.item ? ' · მიიღე ' + Z.itemName(r.item) + '!' : ''), 'win');
        Z.coinFly(b, $('#balPill'), 6);
        if (r.item) Z.celebrate(b, 400);
        if (r.left <= 0) { tokDone = Z.cycleOf(Z.now()); Z.store.set('zar-tok-done', tokDone); }
        Z.refreshMine(['profiles'], 600);
      } catch (e) {
        const c = Z.errCode(e);
        if (c === 'limit') { tokDone = Z.cycleOf(Z.now()); Z.store.set('zar-tok-done', tokDone); Z.toast('დღევანდელი ' + HOL[h].tok + 'ები უკვე დაიჭირე. ხვალ გააგრძელე!'); }
        else if (c !== 'wait') Z.toast(Z.errText(e), 'loss');
      }
      setTimeout(() => b.remove(), 500); tokEl = null;
    });
    scheduleToken(100e3 + Math.random() * 60e3);
  }
  scheduleToken(25e3);

  Z.extraRenders.push(() => { renderCal(); renderBank(); renderHoliday(); });
})();
