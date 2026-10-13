/* ზარაფხანა — admin panel: grants, players, rates, bulk grants, schedule, economy settings, poker tables, health */
(function () {
  const Z = window.Z;
  const S = Z.state;
  const { $, $$ } = Z;
  const setHTML = Z.setHTML;

  /* ---------- players (with e-mails) from the server ---------- */
  let admin = [], adminAt = 0, adminBusy = false;
  async function loadAdmin(force) {
    if (adminBusy || (!force && Date.now() - adminAt < 30000)) return;
    adminBusy = true; adminAt = Date.now();
    try {
      admin = (await Z.api('admin_players', {}, { quiet: true })) || [];
      if (admin.some((x) => !S.players.has(x.id))) Z.refreshMine(['profiles'], 10);
      renderPlayers(true); renderPick();
      if (!sRes.hidden) doSearch();
    } catch (e) { console.warn(e); }
    adminBusy = false;
  }
  const emailOf = (id) => (admin.find((x) => x.id === id) || {}).email || '';
  const grantedOf = (id) => +((admin.find((x) => x.id === id) || {}).granted || 0);

  /* ---------- grant to one player ---------- */
  let admPick = null;
  const sIn = $('#admSearch'), sRes = $('#admResults');
  function doSearch() {
    loadAdmin();
    const q = sIn.value.trim().toLowerCase();
    const all = new Map(admin.map((x) => [x.id, x.name]));
    for (const p of S.players.values()) all.set(p.id, p.name);
    const ids = [...all.entries()].filter(([id, n]) => !q || String(n).toLowerCase().includes(q) || emailOf(id).toLowerCase().includes(q)).slice(0, 12).map((x) => x[0]);
    sRes.innerHTML = ids.length ? ids.map((id) => '<li><button type="button" data-id="' + Z.esc(id) + '">' + Z.av(id) + '<span><span translate="no">' + Z.esc(S.players.has(id) ? Z.realName(id) : (admin.find((x) => x.id === id) || {}).name) + '</span>' + (emailOf(id) ? '<br><small class="muted" translate="no">' + Z.esc(emailOf(id)) + '</small>' : '') + '</span><small class="muted" style="margin-left:auto">' + Z.fmt(Z.bal(id)) + '</small></button></li>').join('')
      : '<li class="muted" style="padding:10px">ვერ მოიძებნა</li>';
    sRes.hidden = false;
  }
  sIn.addEventListener('focus', doSearch);
  sIn.addEventListener('input', doSearch);
  document.addEventListener('click', (e) => { if (!e.target.closest('#v-admin .search-wrap')) sRes.hidden = true; });
  Z.adminPick = (id) => { admPick = id; sIn.value = ''; sRes.hidden = true; renderPick(); $('#admAmt').focus(); };
  sRes.addEventListener('click', (e) => { const b = e.target.closest('[data-id]'); if (b) Z.adminPick(b.dataset.id); });
  function renderPick() {
    setHTML($('#admPick'), admPick ? Z.av(admPick) + '<span><b>' + Z.nm(admPick) + '</b><br><small class="muted">ბალანსი ' + Z.fmt(Z.bal(admPick)) + ' · დარიცხული ' + Z.fmt(grantedOf(admPick)) + (emailOf(admPick) ? ' · <span translate="no">' + Z.esc(emailOf(admPick)) + '</span>' : '') + '</small></span>'
      : '<span class="muted">ადამიანი არ არის არჩეული</span>');
  }
  $$('#v-admin [data-amt]').forEach((b) => b.addEventListener('click', () => ($('#admAmt').value = b.dataset.amt)));
  async function grantPicked(sign, btn) {
    if (!admPick) { Z.toast('ჯერ აირჩიე ადამიანი.', 'loss'); sIn.focus(); return; }
    const v = Math.floor(+$('#admAmt').value || 0);
    if (!(v > 0)) { Z.toast('ჩაწერე კოინების რაოდენობა.', 'loss'); return; }
    btn.disabled = true;
    const ok = await Z.grant(admPick, sign * v, $('#admNote').value.trim());
    btn.disabled = false;
    if (ok != null) {
      Z.toast((sign > 0 ? 'დაერიცხა ' : 'ჩამოეჭრა ') + Z.fmt(v) + ' კოინი: ' + Z.realName(admPick), sign > 0 ? 'win' : '');
      if (sign > 0) Z.coinFly(btn, $('#admPick'), 8);
      $('#admNote').value = '';
      Z.refreshMine(['profiles'], 200); loadAdmin(true);
    }
  }
  $('#admGive').addEventListener('click', (e) => grantPicked(1, e.currentTarget));
  $('#admTake').addEventListener('click', (e) => grantPicked(-1, e.currentTarget));

  /* ---------- players table ---------- */
  let sortK = 'wealth';
  $('#admPlayers').addEventListener('click', async (e) => {
    const s = e.target.closest('[data-sort]'); if (s) { sortK = s.dataset.sort; renderPlayers(true); return; }
    const q = e.target.closest('[data-q]');
    if (q) { const id = q.dataset.p, v = +q.dataset.q; q.disabled = true; if (await Z.grant(id, v, 'სწრაფი დარიცხვა') != null) { Z.toast((v > 0 ? '+' : '') + Z.fmt(v) + ' · ' + Z.realName(id), v > 0 ? 'win' : ''); Z.refreshMine(['profiles'], 200); loadAdmin(true); } q.disabled = false; return; }
    const f = e.target.closest('[data-flag]');
    if (f) {
      const id = f.dataset.p, k = f.dataset.flag, cur = !!(S.players.get(id) || {})[k];
      if (id === S.myId && k !== 'muted') { Z.toast('საკუთარ თავს ამას ვერ შეუცვლი.', 'loss'); return; }
      if (f.dataset.armed !== '1' && !cur && (k === 'frozen' || k === 'is_admin')) { f.dataset.armed = '1'; f.classList.add('armed'); setTimeout(() => { f.dataset.armed = ''; f.classList.remove('armed'); }, 3000); Z.toast('დააჭირე კიდევ ერთხელ დასადასტურებლად'); return; }
      f.disabled = true;
      if (await Z.adminUser(id, k, !cur)) { const p = S.players.get(id); if (p) p[k] = !cur; Z.toast('შენახულია', 'win'); renderPlayers(true); }
      f.disabled = false;
      return;
    }
    const pr = e.target.closest('[data-prof]'); if (pr) Z.openProfile(pr.dataset.prof);
  });
  function renderPlayers(force) {
    if (Z.view !== 'admin' || !S.isAdmin) return;
    const ps = [...S.players.values()];
    let free = 0, lk = 0, dep = 0, lent = 0, act = 0;
    for (const p of ps) { free += +p.balance; lk += +p.locked; dep += +p.dep; lent += +p.lent; }
    for (const v of S.invs.values()) if (v.end == null) act++;
    const gr = admin.reduce((a, x) => a + +x.granted, 0);
    const stat = (l, v) => '<div class="stat"><small>' + l + '</small><b>' + v + '</b></div>';
    setHTML($('#admStats'), stat('მოთამაშე', ps.length) + stat('თავისუფალი კოინი', Z.fmt(free)) + stat('ინვესტიციებში', Z.fmt(lk)) + stat('ბანკში', Z.fmt(dep)) + stat('სესხებში', Z.fmt(lent)) + stat('სულ დარიცხული', Z.fmt(gr)) + stat('აქტიური ინვესტიცია', act));
    $('#admCount').textContent = ps.length + ' ადამიანი · ონლაინ ბოლო 10 წთ: ' + ps.filter((p) => p.seen_at && Z.now() - +p.seen_at < 600e3).length;
    const key = { wealth: (p) => -Z.wealthOf(p.id), bal: (p) => -+p.balance, name: (p) => p.name.toLowerCase(), seen: (p) => -(+p.seen_at || 0), joined: (p) => -+p.joined_at, game: (p) => -(+(p.st || {}).game || 0) }[sortK];
    const rows = ps.slice().sort((a, b) => { const x = key(a), y = key(b); return x < y ? -1 : x > y ? 1 : 0; });
    const th = (k, l) => '<th><button type="button" class="link' + (sortK === k ? ' on' : '') + '" data-sort="' + k + '">' + l + '</button></th>';
    const flag = (p, k, on, off) => '<button type="button" class="flag' + (p[k] ? ' on ' + k : '') + '" data-flag="' + k + '" data-p="' + Z.esc(p.id) + '" title="' + (p[k] ? on : off) + '">' + (p[k] ? on : off) + '</button>';
    setHTML($('#admPlayers'), '<thead><tr>' + th('name', 'მოთამაშე') + th('bal', 'ბალანსი') + th('wealth', 'ქონება') + '<th>დარიცხული</th><th>ინვ. შედეგი</th>' + th('game', 'თამაშები') + th('seen', 'ბოლოს') + '<th>სტატუსი</th><th>სწრაფი</th></tr></thead><tbody>' +
      (rows.length ? rows.map((p, i) => {
        const st = p.st || {};
        return '<tr style="--k:' + Math.min(i, 20) + '"' + (p.frozen ? ' class="frozen"' : '') + '><td><span class="who" data-prof="' + Z.esc(p.id) + '">' + Z.av(p.id, 'no-profile') + '<span>' + Z.nm(p.id) + ' ' + Z.lvChip(p.id) + (emailOf(p.id) ? '<br><small class="muted" translate="no">' + Z.esc(emailOf(p.id)) + '</small>' : '') + '</span></span></td>' +
          '<td class="num">' + Z.fmt(p.balance) + '</td><td class="num">' + Z.fmt(Z.wealthOf(p.id)) + '</td><td class="num">' + Z.fmt(grantedOf(p.id)) + '</td>' +
          '<td class="num ' + ((+st.inv || 0) >= 0 ? 'pos' : 'neg') + '">' + Z.sfmt(+st.inv || 0) + '</td><td class="num ' + ((+st.game || 0) >= 0 ? 'pos' : 'neg') + '">' + Z.sfmt(+st.game || 0) + ' <small class="muted">(' + (st.games || 0) + ')</small></td>' +
          '<td><small class="muted">' + (p.seen_at ? Z.ago(+p.seen_at) : '—') + '</small></td>' +
          '<td class="flags">' + flag(p, 'frozen', 'გაყინული', 'გაყინვა') + flag(p, 'muted', 'დადუმებული', 'დადუმება') + flag(p, 'is_admin', 'ადმინი', 'ადმინად') + '</td>' +
          '<td><button class="qbtn" data-p="' + Z.esc(p.id) + '" data-q="100">+100</button><button class="qbtn" data-p="' + Z.esc(p.id) + '" data-q="1000">+1 000</button><button class="qbtn" data-p="' + Z.esc(p.id) + '" data-q="-100">−100</button></td></tr>';
      }).join('') : '<tr><td colspan="9">' + Z.empty('ჯერ არავინ დარეგისტრირებულა. გაუზიარე საიტის ბმული.') + '</td></tr>') + '</tbody>');
    void force;
  }

  /* ---------- rates ---------- */
  const rf = $('#admRates');
  rf.innerHTML = Z.TIERS.map((T) => '<div class="rate-row" style="--tc:' + Z.tierVar(T.k) + '"><label for="rate-' + T.k + '"><span><span class="tdot"></span>' + T.name + '</span><small>აგებს ' + T.lose + '% · <span data-evf="' + T.k + '"></span></small></label><input type="number" id="rate-' + T.k + '" min="0" max="10000" step="1" inputmode="numeric"></div>').join('') +
    '<div class="rate-row"><label for="rate-bonus"><span>დღიური ბონუსი (კალენდრის საბაზო)</span><small>0 = გამორთული · მე-7 დღეს ×10</small></label><input type="number" id="rate-bonus" min="0" step="1" inputmode="numeric"></div>' +
    '<p class="muted" id="ratesNote" style="margin:0;font-size:.8rem"></p><button class="btn primary" type="submit">შენახვა</button>';
  let ratesDirty = false;
  const fillRates = (force) => {
    if (ratesDirty && !force) return;
    const r = Z.ratesFor(S.config, Z.cycleOf(Z.now()) + 1);
    for (const T of Z.TIERS) $('#rate-' + T.k).value = r[T.k];
    $('#rate-bonus').value = S.config.bonus ?? 0;
    evNote();
  };
  function evNote() {
    for (const T of Z.TIERS) {
      const r = +$('#rate-' + T.k).value || 0;
      const ev = ((100 - T.lose) / 100) * (1 + r / 100) - 1;
      $('[data-evf="' + T.k + '"]', rf).textContent = 'საშუალოდ ' + (ev >= 0 ? '+' : '−') + Math.abs(ev * 100).toFixed(1) + '% დღეში';
    }
    const cur = Z.cycleOf(Z.now()), now = Z.ratesFor(S.config, cur), nx = Z.ratesFor(S.config, cur + 1);
    const changed = Z.TIERS.some((T) => now[T.k] !== nx[T.k]);
    $('#ratesNote').textContent = 'ცვლილება ძალაში შედის შემდეგი რაუნდიდან (#' + Z.roundNo(cur + 1) + '). ' + (changed ? 'მიმდინარე რაუნდი: ' + Z.TIERS.map((T) => T.name + ' +' + now[T.k] + '%').join(', ') + '.' : '');
  }
  rf.addEventListener('input', () => { ratesDirty = true; evNote(); });
  rf.addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = {};
    for (const T of Z.TIERS) r[T.k] = Math.max(0, Math.floor(+$('#rate-' + T.k).value || 0));
    const from = await Z.saveRates(r, Math.max(0, Math.floor(+$('#rate-bonus').value || 0)));
    if (from) { ratesDirty = false; Z.toast('შენახულია. ახალი პროცენტები: რაუნდ #' + Z.roundNo(from) + '-დან.', 'win'); }
  });

  /* ---------- bulk grants ---------- */
  $('#bulkGo').addEventListener('click', async (e) => {
    const lines = $('#bulkIn').value.split(/\n+/).map((l) => l.trim()).filter(Boolean).map((l) => {
      const parts = l.split(/[,;\t]/).map((x) => x.trim());
      return { who: parts[0], amount: Math.floor(+String(parts[1] || '').replace(/[\s ]/g, '') || 0), note: parts.slice(2).join(', ') || 'ჯგუფური დარიცხვა' };
    });
    if (!lines.length) { Z.toast('ჩაწერე მინიმუმ ერთი ხაზი.', 'loss'); return; }
    const b = e.currentTarget; b.disabled = true;
    const res = await Z.bulkGrant(lines);
    b.disabled = false;
    if (!res) return;
    const ok = res.filter((x) => x.ok);
    const ERR = { not_found: 'ვერ მოიძებნა', bad_amount: 'თანხა არასწორია' };
    setHTML($('#bulkRes'), res.map((x) => '<li class="' + (x.ok ? 'ok' : 'bad') + '"><span translate="no">' + Z.esc(x.ok ? x.name : x.who) + '</span><b>' + (x.ok ? Z.sfmt(x.amount) : ERR[x.err] || x.err) + '</b></li>').join(''));
    Z.toast('დაერიცხა ' + ok.length + ' / ' + res.length + ' მოთამაშეს', ok.length ? 'win' : 'loss');
    if (ok.length === res.length) $('#bulkIn').value = '';
    loadAdmin(true);
  });

  /* ---------- event schedule ---------- */
  const DOWS = ['ყოველდღე', 'ორშაბათი', 'სამშაბათი', 'ოთხშაბათი', 'ხუთშაბათი', 'პარასკევი', 'შაბათი', 'კვირა'];
  const evName = (k) => (Z.EVENTS.find((x) => x.k === k) || { name: k }).name;
  function renderSched() {
    if (Z.view !== 'admin' || !S.isAdmin) return;
    const list = S.config.sched || [];
    const keep = document.activeElement && document.activeElement.closest && document.activeElement.closest('#schedAdmin');
    if (keep) return;
    setHTML($('#schedAdmin'), '<ul class="sched-list">' + (list.length ? list.map((e, i) => '<li><b>' + Z.esc(evName(e.k)) + '</b><small>' + DOWS[(e.dow ?? -1) + 1] + ' · ' + String(e.h || 0).padStart(2, '0') + ':00-დან · ' + (e.dur || 1) + ' სთ</small><button type="button" class="link danger-link" data-sdel="' + i + '">წაშლა</button></li>').join('') : '<li class="muted empty-li">განრიგი ცარიელია</li>') + '</ul>' +
      '<div class="sched-form"><select id="scK">' + Z.EVENTS.map((e) => '<option value="' + e.k + '">' + Z.esc(e.name) + '</option>').join('') + '</select>' +
      '<select id="scD">' + DOWS.map((d, i) => '<option value="' + (i - 1) + '"' + (i === 6 ? ' selected' : '') + '>' + d + '</option>').join('') + '</select>' +
      '<label class="inl">საათი <input id="scH" type="number" min="0" max="23" value="20" inputmode="numeric"></label><label class="inl">ხანგრძლ. (სთ) <input id="scU" type="number" min="1" max="72" value="3" inputmode="numeric"></label>' +
      '<button type="button" class="btn sm primary" id="scAdd">დამატება</button></div><p class="muted note">დრო თბილისის მიხედვით. ივენთი ავტომატურად ჩაირთვება განსაზღვრულ დროს.</p>');
  }
  $('#schedAdmin').addEventListener('click', async (e) => {
    const d = e.target.closest('[data-sdel]'), a = e.target.closest('#scAdd');
    if (!d && !a) return;
    let list = (S.config.sched || []).slice();
    if (d) list.splice(+d.dataset.sdel, 1);
    if (a) {
      if (list.length >= 20) { Z.toast('მაქსიმუმ 20 ჩანაწერი.', 'loss'); return; }
      list.push({ k: $('#scK').value, dow: +$('#scD').value, h: Z.clamp(Math.floor(+$('#scH').value || 0), 0, 23), dur: Z.clamp(+$('#scU').value || 1, 1, 72) });
    }
    if (await Z.saveConfigPatch({ sched: list })) { S.config.sched = list; $('#schedAdmin')._h = ''; document.activeElement && document.activeElement.blur && document.activeElement.blur(); renderSched(); Z.toast('განრიგი შენახულია', 'win'); }
  });

  /* ---------- economy settings ---------- */
  const ef = $('#admEcon');
  const num = (id, label, hint, attrs) => '<div class="rate-row"><label for="' + id + '"><span>' + label + '</span>' + (hint ? '<small>' + hint + '</small>' : '') + '</label><input type="number" id="' + id + '" step="1" min="0" inputmode="numeric"' + (attrs || '') + '></div>';
  const chk = (id, label, hint) => '<label class="check"><input type="checkbox" id="' + id + '"><span class="switch"></span><span><b>' + label + '</b>' + (hint ? '<small>' + hint + '</small>' : '') + '</span></label>';
  ef.innerHTML =
    '<fieldset><legend>ზოგადი</legend>' + num('ecWelcome', 'მისასალმებელი კოინები', 'ახალ მოთამაშეს რეგისტრაციისას') + num('ecClose', 'მიღების დახურვა (წთ)', 'რაუნდის ბოლომდე') + num('ecMaxBet', 'მაქსიმალური ფსონი', '0 = შეზღუდვის გარეშე') + num('ecQuest', 'დავალებების ჯილდოს მამრავლი', '1 = ჩვეულებრივი', ' step="0.1"') +
    '<div class="rate-row"><label for="ecTheme"><span>დღესასწაულის თემა</span><small>ავტომატური: 24 ოქტ – 2 ნოე, 20 დეკ – 7 იან</small></label><select id="ecTheme"><option value="">ავტომატური</option><option value="none">გამორთული</option><option value="halloween">ჰელოუინი</option><option value="newyear">ახალი წელი</option></select></div></fieldset>' +
    '<fieldset><legend>ბანკი</legend>' + num('ecB3', '3 დღე (%)') + num('ecB7', '7 დღე (%)') + num('ecB30', '30 დღე (%)') + num('ecBpen', 'ვადამდე დახურვის ჯარიმა (%)') + '</fieldset>' +
    '<fieldset><legend>ინვესტიციის დაზღვევა</legend>' + num('ecIl', 'დაბალი: შენატანი (%)') + num('ecIm', 'საშუალო: შენატანი (%)') + num('ecIh', 'მაღალი: შენატანი (%)') + num('ecIb', 'წაგებისას ბრუნდება (%)') + '</fieldset>' +
    '<fieldset><legend>ლატარია</legend>' + chk('ecLot', 'კვირის ლატარია') + num('ecLp', 'ბილეთის ფასი') + num('ecLc', 'იწვება (%)', 'ფონდიდან') + '</fieldset>' +
    '<fieldset><legend>მოწვევები</legend>' + chk('ecRef', 'მოწვევის ბონუსი') + num('ecRa', 'ბონუსი ორივეს') + num('ecRx', 'საჭირო XP', 'მოწვეულმა რომ დააგროვოს') + '</fieldset>' +
    '<fieldset><legend>ქონების გადასახადი</legend>' + chk('ecTax', 'კვირის გადასახადი', 'ყოველ ორშაბათს, ზღვარს ზემოთ ქონებაზე') + num('ecTt', 'ზღვარი') + num('ecTp', 'განაკვეთი (%)', '', ' step="0.1"') + '</fieldset>' +
    '<fieldset><legend>კლანები</legend>' + num('ecCp', 'კვირის საუკეთესო კლანის პრიზი', 'თითო აქტიურ წევრს') + chk('ecCw', 'კლანების ომი') + num('ecCwp', 'ომის პრიზი', 'გამარჯვებულის ხაზინაში') + '</fieldset>' +
    '<fieldset><legend>ბინგო და პოკერი</legend>' + chk('ecBg', 'ბინგო') + num('ecBgp', 'ბარათის ფასი') + num('ecBgs', 'საწყისი ფონდი') + num('ecBge', 'სიხშირე (წთ)', '', ' min="5"') + chk('ecPk', 'პოკერი') + num('ecPkr', 'საკომისიო (%)', 'მხოლოდ ფლოპის შემდეგ, მაქს. 10 დიდი ბლაინდი', ' step="0.5"') + num('ecAf', 'აუქციონის საკომისიო (%)') + '</fieldset>' +
    '<div class="btn-row"><button class="btn primary" type="submit">შენახვა</button></div>';
  let econDirty = false;
  ef.addEventListener('input', () => (econDirty = true));
  function fillEcon(force) {
    if (econDirty && !force) return;
    const c = S.config, set = (id, v) => { const el = $('#' + id); if (el.type === 'checkbox') el.checked = !!v; else el.value = v ?? ''; };
    const b = Object.assign({ 3: 8, 7: 22, 30: 110, pen: 5 }, c.bank), ins = Object.assign({ l: 15, m: 30, h: 45, back: 50 }, c.ins), lot = Object.assign({ on: true, price: 20, cut: 10 }, c.lot), ref = Object.assign({ on: true, amt: 300, xp: 2000 }, c.ref);
    const tax = Object.assign({ on: false, threshold: 50000, pct: 2 }, c.tax), cw = Object.assign({ on: true, prize: 1000 }, c.clanWar), bg = Object.assign({ on: true, price: 25, seed: 100, every: 20 }, c.bingo), pk = Object.assign({ on: true, rake: 2 }, c.poker);
    set('ecWelcome', c.welcome ?? 500); set('ecClose', c.closeMin ?? 60); set('ecMaxBet', c.maxBet ?? 0); set('ecQuest', c.questMult ?? 1); $('#ecTheme').value = c.theme || '';
    set('ecB3', b[3]); set('ecB7', b[7]); set('ecB30', b[30]); set('ecBpen', b.pen);
    set('ecIl', ins.l); set('ecIm', ins.m); set('ecIh', ins.h); set('ecIb', ins.back);
    set('ecLot', lot.on); set('ecLp', lot.price); set('ecLc', lot.cut);
    set('ecRef', ref.on); set('ecRa', ref.amt); set('ecRx', ref.xp);
    set('ecTax', tax.on); set('ecTt', tax.threshold); set('ecTp', tax.pct);
    set('ecCp', c.clanPrize ?? 200); set('ecCw', cw.on); set('ecCwp', cw.prize);
    set('ecBg', bg.on); set('ecBgp', bg.price); set('ecBgs', bg.seed); set('ecBge', bg.every); set('ecPk', pk.on); set('ecPkr', pk.rake); set('ecAf', (c.auction || {}).fee ?? 5);
  }
  ef.addEventListener('submit', async (e) => {
    e.preventDefault();
    const n = (id, d) => { const v = +$('#' + id).value; return Number.isFinite(v) && $('#' + id).value !== '' ? Math.max(0, v) : d; };
    const ck = (id) => $('#' + id).checked;
    const patch = {
      welcome: Math.floor(n('ecWelcome', 500)), closeMin: Z.clamp(Math.floor(n('ecClose', 60)), 0, 600), maxBet: Math.floor(n('ecMaxBet', 0)), questMult: n('ecQuest', 1), theme: $('#ecTheme').value || null,
      bank: { 3: n('ecB3', 8), 7: n('ecB7', 22), 30: n('ecB30', 110), pen: n('ecBpen', 5) },
      ins: { l: n('ecIl', 15), m: n('ecIm', 30), h: n('ecIh', 45), back: Z.clamp(n('ecIb', 50), 0, 100) },
      lot: { on: ck('ecLot'), price: Math.max(1, Math.floor(n('ecLp', 20))), cut: Z.clamp(n('ecLc', 10), 0, 100) },
      ref: { on: ck('ecRef'), amt: Math.floor(n('ecRa', 300)), xp: Math.floor(n('ecRx', 2000)) },
      tax: { on: ck('ecTax'), threshold: Math.floor(n('ecTt', 50000)), pct: Z.clamp(n('ecTp', 2), 0, 50) },
      clanPrize: Math.floor(n('ecCp', 200)), clanWar: { on: ck('ecCw'), prize: Math.floor(n('ecCwp', 1000)) },
      bingo: { on: ck('ecBg'), price: Math.max(1, Math.floor(n('ecBgp', 25))), seed: Math.floor(n('ecBgs', 100)), every: Math.max(5, Math.floor(n('ecBge', 20))) },
      poker: { on: ck('ecPk'), rake: Z.clamp(n('ecPkr', 2), 0, 10) }, auction: { fee: Z.clamp(n('ecAf', 5), 0, 50) },
    };
    const b = ef.querySelector('[type=submit]'); b.disabled = true;
    if (await Z.saveConfigPatch(patch)) { econDirty = false; Object.assign(S.config, patch); Z.toast('ეკონომიკის პარამეტრები შენახულია', 'win'); }
    b.disabled = false;
  });

  /* ---------- poker tables ---------- */
  let lobby = [], lobbyAt = 0;
  async function loadLobby() { lobbyAt = Date.now(); try { lobby = (await Z.api('poker_lobby', {}, { quiet: true })) || []; $('#pkAdmin')._h = ''; renderPk(); } catch (e) {} }
  function renderPk() {
    if (Z.view !== 'admin' || !S.isAdmin) return;
    if (Date.now() - lobbyAt > 30000) loadLobby();
    if (document.activeElement && document.activeElement.closest && document.activeElement.closest('#pkAdmin')) return;
    setHTML($('#pkAdmin'), '<ul class="sched-list">' + (lobby.length ? lobby.map((x) => '<li><b translate="no">' + Z.esc(x.t.name) + '</b><small>ბლაინდები ' + Z.fmt(x.t.sb) + '/' + Z.fmt(x.t.bb) + ' · შესვლა ' + Z.fmt(x.t.min_buy) + '–' + Z.fmt(x.t.max_buy) + ' · ' + x.n + '/' + x.t.seats + ' ზის</small>' + (x.n ? '' : '<button type="button" class="link danger-link" data-pkdel="' + x.t.id + '">წაშლა</button>') + '</li>').join('') : '<li class="muted empty-li">მაგიდები არ არის</li>') + '</ul>' +
      '<div class="sched-form"><input id="pkN" type="text" maxlength="30" placeholder="სახელი" value="ახალი მაგიდა"><label class="inl">პატარა ბლაინდი <input id="pkSb" type="number" min="1" value="10" inputmode="numeric"></label><label class="inl">დიდი <input id="pkBb" type="number" min="1" value="20" inputmode="numeric"></label>' +
      '<label class="inl">მინ. შესვლა <input id="pkMin" type="number" min="1" value="400" inputmode="numeric"></label><label class="inl">მაქს. <input id="pkMax" type="number" min="1" value="2000" inputmode="numeric"></label><label class="inl">ადგილი <input id="pkSeats" type="number" min="2" max="9" value="6" inputmode="numeric"></label>' +
      '<button type="button" class="btn sm primary" id="pkAdd">დამატება</button></div><p class="muted note">მინიმალური შესვლა უნდა იყოს მინიმუმ 10 დიდი ბლაინდი. მაგიდის წაშლა მხოლოდ ცარიელისაა შესაძლებელი.</p>');
  }
  $('#pkAdmin').addEventListener('click', async (e) => {
    const d = e.target.closest('[data-pkdel]');
    if (d) { if (await Z.act('admin_poker_delete', { tid: +d.dataset.pkdel }, { quiet: true })) { Z.toast('მაგიდა წაიშალა'); loadLobby(); } return; }
    if (e.target.closest('#pkAdd')) {
      const v = (id) => Math.floor(+$('#' + id).value || 0);
      const r = await Z.act('admin_poker_table', { name: $('#pkN').value.trim() || 'მაგიდა', sb: v('pkSb'), bb: v('pkBb'), min_buy: v('pkMin'), max_buy: v('pkMax'), seats: v('pkSeats') }, { quiet: true });
      if (r) { Z.toast('მაგიდა დაემატა', 'win'); document.activeElement.blur(); loadLobby(); }
    }
  });

  /* ---------- system health ---------- */
  let health = null, healthAt = 0;
  async function loadHealth() { healthAt = Date.now(); try { health = await Z.api('admin_health', {}, { quiet: true }); renderHealth(true); } catch (e) { setHTML($('#healthBody'), '<p class="muted">' + Z.esc(Z.errText(e)) + '</p>'); } }
  $('#healthReload').addEventListener('click', loadHealth);
  function renderHealth(force) {
    if (Z.view !== 'admin' || !S.isAdmin) return;
    if (!health || Date.now() - healthAt > 60000) { if (Date.now() - healthAt > 10000) loadHealth(); if (!health) return; }
    if (!force && $('#healthBody')._h) return;
    const tickAgo = health.tick_at ? (+health.now - +health.tick_at) / 1000 : null;
    const ok = tickAgo != null && tickAgo < 180;
    const te = health.tick_err || null, errs = te && te.e && te.e.length ? te.e : null;
    const row = (l, v, cls) => '<li><span>' + l + '</span><b class="' + (cls || '') + '">' + v + '</b></li>';
    setHTML($('#healthBody'), '<ul class="health">' +
      row('ავტომატური დამგეგმავი (pg_cron)', tickAgo == null ? 'ჯერ არ გაშვებულა' : ok ? 'მუშაობს · ' + Math.round(tickAgo) + ' წმ წინ' : 'ჩერდება? ბოლოს ' + Math.round(tickAgo / 60) + ' წთ წინ', ok ? 'pos' : 'neg') +
      row('ბოლო დათვლილი რაუნდი', health.settled != null ? '#' + Z.roundNo(+health.settled) : '—', +health.settled >= +health.cur - 1 ? 'pos' : 'neg') +
      row('მიმდინარე რაუნდი', '#' + Z.roundNo(+health.cur)) +
      row('ბოლო კვირის დახურვა', health.week_done != null ? Z.fdate(Z.cycleStart(+health.week_done)).split(',')[0] : '—') +
      row('სერვერის დრო', Z.fdate(+health.now) + ' · სხვაობა ' + Math.round(Z.skew / 1000) + ' წმ') +
      row('Realtime', S.rt === 'SUBSCRIBED' ? 'დაკავშირებულია' : 'გამორთულია (მუშაობს გამოკითხვით)', S.rt === 'SUBSCRIBED' ? 'pos' : '') +
      '</ul>' + (errs ? '<div class="health-err"><b>ბოლო შეცდომები (' + Z.ago(+te.at) + '):</b><ul>' + errs.slice(0, 6).map((x) => '<li><code>' + Z.esc(x) + '</code></li>').join('') + '</ul></div>' : '') +
      (!ok ? '<p class="note neg">თუ დამგეგმავი არ მუშაობს, Supabase-ში ჩართე გაფართოება pg_cron (Database → Extensions) და ხელახლა გაუშვი ბოლო მიგრაცია. მანამდე საიტი თავად „უბიძგებს“ სერვერს, როცა ვინმე შემოდის.</p>' : '') +
      '<button class="btn sm" id="tickNow">დამგეგმავის ხელით გაშვება</button>');
  }
  $('#healthBody').addEventListener('click', async (e) => {
    if (e.target.id !== 'tickNow') return;
    e.target.disabled = true;
    try { const r = await Z.api('zar_tick', {}, { quiet: true }); Z.toast(r && r.skip ? 'დამგეგმავი ახლახან გაეშვა, სცადე 15 წამში.' : r && r.errors && r.errors.length ? 'შეცდომა: ' + r.errors[0] : 'შესრულდა' + (r && r.done && r.done.length ? ': ' + r.done.join(', ') : ''), r && r.errors && r.errors.length ? 'loss' : 'win'); } catch (err) { Z.toast(Z.errText(err), 'loss'); }
    loadHealth(); Z.refreshMine(['rounds', 'config'], 300);
  });

  /* ---------- render ---------- */
  Z.renderers.admin = () => {
    if (!S.isAdmin) return;
    loadAdmin();
    renderPlayers(false); fillRates(false); renderPick(); renderSched(); fillEcon(false); renderPk(); renderHealth(false);
  };
})();
