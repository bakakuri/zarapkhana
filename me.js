/* ზარაფხანა — my page: profile card, season pass, personal stats, referrals, play limits, provable fairness */
(function () {
  const Z = window.Z;
  const S = Z.state;
  const { $, $$ } = Z;
  const setHTML = Z.setHTML;
  const left = (ms) => { ms = Math.max(0, ms); const d = Math.floor(ms / Z.DAY); return (d ? d + 'დ ' : '') + Z.hms(ms % Z.DAY); };

  /* =================== profile card =================== */
  async function picFromFile(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const s = Math.min(img.naturalWidth, img.naturalHeight), cv = document.createElement('canvas');
      cv.width = cv.height = 256;
      cv.getContext('2d').drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, 256, 256);
      return await new Promise((res) => cv.toBlob((b) => res(b), 'image/webp', 0.85));
    } finally { URL.revokeObjectURL(url); }
  }
  function renderCard() {
    const me = S.me;
    if (!me) return;
    $('#meEmail').textContent = S.email || '';
    const L = Z.levelOf(+me.xp), title = Z.titleOf(S.myId), clan = Z.clanOf(S.myId);
    const html = '<div class="me-top">' + Z.av(S.myId, 'xl no-profile') + '<div class="me-id"><h2>' + Z.nmReal(S.myId) + '</h2>' +
      '<div class="pf-tags">' + Z.lvChip(S.myId) + (title ? '<span class="title-chip">' + Z.esc(title) + '</span>' : '') + (clan ? '<span class="chip"><span>კლანი „<span translate="no">' + Z.esc(clan.name) + '</span>“</span></span>' : '') + (me.is_admin ? '<span class="chip open">ადმინი</span>' : '') + '</div>' +
      '<small class="muted">რეგისტრაცია: ' + Z.fdate(me.joinedAt).split(',')[0] + ' · ' + Z.fmt(+me.xp) + ' XP · VIP ' + L.name + '</small></div></div>' +
      '<div class="me-edit"><div class="field"><label class="field-lbl" for="meName">სახელი</label><div class="bet-row"><input id="meName" type="text" maxlength="24" value="' + Z.esc(me.name) + '" autocomplete="nickname"><button type="button" class="btn sm" id="meNameGo">შეცვლა</button></div></div>' +
      '<div class="btn-row"><label class="btn ghost file-btn">ფოტოს ატვირთვა<input type="file" accept="image/*" id="mePic" hidden></label>' + (me.pic ? '<button class="btn ghost" id="mePicDel">ფოტოს წაშლა</button>' : '') +
      '<button class="btn ghost" id="meSnd">' + (Z.soundOn() ? 'ხმის გამორთვა' : 'ხმის ჩართვა') + '</button><button class="btn ghost" id="meLang" translate="no">' + (Z.lang === 'en' ? 'ქართული' : 'English') + '</button>' +
      '<button class="btn ghost" id="meCsv">ისტორია (CSV)</button><button class="btn ghost" id="meGuide">გაცნობა</button><button class="btn danger" id="meOut">გასვლა</button></div></div>';
    const keep = $('#meName') && document.activeElement === $('#meName') ? $('#meName').value : null;
    if (setHTML($('#meCard'), html) && keep != null) { $('#meName').value = keep; $('#meName').focus(); }
  }
  $('#meCard').addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'meNameGo') {
      const n = $('#meName').value.trim();
      if (n.length < 2) { Z.toast('სახელი ძალიან მოკლეა.', 'loss'); return; }
      b.disabled = true; if (await Z.setName(n)) { const p = S.players.get(S.myId); if (p) p.name = n; Z.toast('სახელი შეიცვალა', 'win'); Z.emit(); } b.disabled = false;
    }
    if (b.id === 'mePicDel') { if (await Z.removePic()) { const p = S.players.get(S.myId); if (p) p.pic = null; Z.emit(); } }
    if (b.id === 'meSnd') { Z.setSound(!Z.soundOn()); Z.syncSnd && Z.syncSnd(); $('#meCard')._h = ''; renderCard(); }
    if (b.id === 'meLang') Z.setLang && Z.setLang(Z.lang === 'en' ? 'ka' : 'en');
    if (b.id === 'meCsv') Z.downloadCSV();
    if (b.id === 'meGuide') { Z.go('home'); setTimeout(Z.startGuide, 400); }
    if (b.id === 'meOut') {
      if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'დაადასტურე გასვლა'; setTimeout(() => { b.dataset.armed = ''; b.textContent = 'გასვლა'; }, 3500); return; }
      Z.auth.signOut();
    }
  });
  $('#meCard').addEventListener('change', async (e) => {
    if (e.target.id !== 'mePic') return;
    const f = e.target.files[0]; if (!f) return;
    if (f.size > 15e6) { Z.toast('ფაილი ძალიან დიდია.', 'loss'); return; }
    try {
      Z.toast('ფოტო იტვირთება…');
      const blob = await picFromFile(f);
      if (await Z.uploadPic(blob)) { Z.toast('ფოტო განახლდა', 'win'); Z.refreshMine(['profiles'], 200); }
    } catch (err) { Z.toast('ფოტო ვერ წავიკითხე. სცადე JPG ან PNG.', 'loss'); }
  });

  /* =================== season pass =================== */
  const PASS_ITEMS = { 10: 'fr-pass', 20: 'nc-pass', 30: 'ti-pass' };
  const passReward = (t) => { const r = [Z.fmt(t * 50) + ' კოინი']; if (t % 5 === 0) r.push(t === 15 || t === 25 ? 'პრემიუმ ყუთი' : 'ყუთი'); if (PASS_ITEMS[t]) r.push(Z.itemName(PASS_ITEMS[t])); return r; };
  function renderPass() {
    const me = S.me; if (!me) return;
    const sxp = +me.sxp || 0, tier = Math.min(30, Math.floor(sxp / 1000)), sea = S.config.season || {};
    const avail = []; for (let t = 1; t <= tier; t++) if (!S.pass.has(t)) avail.push(t);
    $('#passSub').textContent = 'სეზონი #' + ((sea.id || 0) + 1) + ' · ' + Z.fmt(sxp) + ' სეზონის XP · საფეხური ' + tier + ' / 30';
    const html = '<div class="pass-head"><div class="xpbar"><i style="width:' + (tier >= 30 ? 100 : ((sxp % 1000) / 10).toFixed(1)) + '%"></i></div><small class="muted">' + (tier >= 30 ? 'ყველა საფეხური გახსნილია!' : Z.fmt(1000 - (sxp % 1000)) + ' XP შემდეგ საფეხურამდე') + '</small>' +
      (avail.length ? '<button class="btn primary sm" id="passAll">ყველას აღება · ' + avail.length + '</button>' : '') + '</div>' +
      '<div class="pass-track">' + Array.from({ length: 30 }, (_, i) => {
        const t = i + 1, open = t <= tier, got = S.pass.has(t), big = t % 5 === 0;
        return '<div class="pt' + (open ? ' open' : '') + (got ? ' got' : '') + (big ? ' big' : '') + (PASS_ITEMS[t] ? ' item' : '') + '" style="--k:' + i + '"><small>' + t + '</small>' +
          (PASS_ITEMS[t] ? '<span class="pt-prev">' + Z.itemPreview(S.items.get(PASS_ITEMS[t]) || { cat: '' }) + '</span>' : big ? '<span class="pt-ic"><svg><use href="#i-gift"/></svg></span>' : '<span class="pt-ic"><svg><use href="#i-borj"/></svg></span>') +
          '<b>' + passReward(t).join(' + ') + '</b>' + (got ? '<span class="cal-ok">✓</span>' : open ? '<button class="btn primary sm" data-pass="' + t + '">აღება</button>' : '') + '</div>';
      }).join('') + '</div><p class="muted note">სეზონის XP გროვდება ისევე, როგორც ჩვეულებრივი XP: ყოველი დადებული და ჩადებული კოინი. ახალი სეზონის დაწყებისას საშვი თავიდან იწყება.</p>';
    const tr = $('#passTrack'), sl = tr.querySelector('.pass-track') ? tr.querySelector('.pass-track').scrollLeft : null;
    if (setHTML(tr, html)) {
      const pt = tr.querySelector('.pass-track');
      if (sl != null) pt.scrollLeft = sl; else { const cur = pt.children[Math.max(0, tier - 2)]; if (cur) pt.scrollLeft = cur.offsetLeft - 16; }
    }
  }
  async function claimPass(t, btn) {
    const r = await Z.claimPass(t);
    if (!r) return false;
    S.pass.add(t);
    Z.toast('საფეხური ' + t + ': +' + Z.fmt(r.coins) + ' კოინი' + (r.box ? ' + ყუთი' : '') + (r.item ? ' + ' + Z.itemName(r.item) : ''), 'win');
    if (btn) Z.coinFly(btn, $('#balPill'), 6);
    if (r.item && btn) Z.celebrate(btn, 300);
    return true;
  }
  $('#passTrack').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-pass], #passAll'); if (!b) return;
    b.disabled = true;
    if (b.id === 'passAll') {
      const tier = Math.min(30, Math.floor((+S.me.sxp || 0) / 1000));
      for (let t = 1; t <= tier; t++) if (!S.pass.has(t)) { if (!(await claimPass(t, null))) break; }
      Z.coinFly(b, $('#balPill'), 10);
    } else await claimPass(+b.dataset.pass, b);
    Z.emit();
  });

  /* =================== personal statistics =================== */
  let stats = null, statsAt = 0, statsBusy = false;
  async function loadStats() {
    if (statsBusy) return;
    statsBusy = true; statsAt = Date.now();
    try { stats = await Z.api('my_stats', {}, { quiet: true }); renderStats(true); } catch (e) { setHTML($('#statsBody'), '<p class="muted">' + Z.esc(Z.errText(e)) + '</p>'); }
    statsBusy = false;
  }
  $('#statsReload').addEventListener('click', loadStats);
  const DOW = ['ორშ', 'სამ', 'ოთხ', 'ხუთ', 'პარ', 'შაბ', 'კვი'];
  function renderStats(force) {
    if (!stats) { if (Date.now() - statsAt > 5000) loadStats(); return; }
    const box = $('#statsBody');
    if (!force && box._done) return;
    box._done = true;
    const games = stats.games || [], days = stats.days || [], heat = stats.heat || [], cats = stats.cats || {};
    const tot = games.reduce((a, g) => ({ n: a.n + +g.n, w: a.w + +g.wager, net: a.net + +g.net, wins: a.wins + +g.wins }), { n: 0, w: 0, net: 0, wins: 0 });
    const tile = (l, v, cls) => '<div class="stat"><small>' + l + '</small><b class="' + (cls || '') + '">' + v + '</b></div>';
    const hmax = Math.max(1, ...heat.map((x) => +x.n));
    const hm = {}; heat.forEach((x) => (hm[x.dw + '|' + x.h] = +x.n));
    const catRows = Object.entries(cats).map(([k, v]) => [k, +v]).filter((x) => x[1]).sort((a, b) => b[1] - a[1]);
    const cmax = Math.max(1, ...catRows.map((x) => Math.abs(x[1])));
    box.innerHTML = '<div class="stat-row">' + tile('თამაშები', Z.fmt(tot.n)) + tile('დადებული', Z.fmt(tot.w)) + tile('წმინდა შედეგი', Z.sfmt(tot.net), tot.net >= 0 ? 'pos' : 'neg') + tile('მოგების წილი', tot.n ? Math.round((tot.wins / tot.n) * 100) + '%' : '—') + tile('RTP', tot.w ? (((tot.w + tot.net) / tot.w) * 100).toFixed(1) + '%' : '—') + '</div>' +
      '<div class="grid-2 st-grid"><div><h4>ბალანსი ბოლო 30 დღეში</h4><div class="chart-box" id="stBal"></div></div><div><h4>დღის შედეგი (ადმინის დარიცხვის გარეშე)</h4><div class="chart-box bars-box" id="stNet"></div></div></div>' +
      '<h4>თამაშების მიხედვით</h4><div class="table-wrap"><table class="ptable"><thead><tr><th>თამაშის სახეობა</th><th>რაოდენობა</th><th>დადებული</th><th>შედეგი</th><th>მოგება</th><th>საუკეთესო ×</th></tr></thead><tbody>' +
      (games.length ? games.map((g) => '<tr><td>' + Z.esc(Z.gameName(g.g)) + '</td><td class="num">' + Z.fmt(g.n) + '</td><td class="num">' + Z.fmt(g.wager) + '</td><td class="num ' + (+g.net >= 0 ? 'pos' : 'neg') + '">' + Z.sfmt(+g.net) + '</td><td class="num">' + Math.round((+g.wins / +g.n) * 100) + '%</td><td class="num">' + (g.best != null ? '×' + (+g.best).toFixed(2) : '—') + '</td></tr>').join('') : '<tr><td colspan="6" class="muted">ჯერ არ გითამაშია</td></tr>') + '</tbody></table></div>' +
      '<div class="grid-2 st-grid"><div><h4>როდის თამაშობ (60 დღე)</h4><div class="heat">' + '<span></span>' + Array.from({ length: 24 }, (_, h) => '<small>' + (h % 6 === 0 ? h : '') + '</small>').join('') +
      DOW.map((d, i) => '<small>' + d + '</small>' + Array.from({ length: 24 }, (_, h) => { const n = hm[i + 1 + '|' + h] || 0; return '<i style="--a:' + (n ? (0.15 + 0.85 * (n / hmax)).toFixed(2) : 0) + '" title="' + d + ' ' + h + ':00 · ' + n + '"></i>'; }).join('')).join('') + '</div></div>' +
      '<div><h4>სად მოდის და მიდის ჩემი კოინები</h4>' + (catRows.length ? catRows.map(([k, v], i) => '<div class="flow" style="--k:' + i + '"><span>' + Z.esc((Z.CAT_NAMES || {})[k] || k) + '</span><span class="fbar"><i class="' + (v >= 0 ? 'up' : 'dn') + '" style="width:' + (Math.abs(v) / cmax) * 100 + '%"></i></span><b class="num ' + (v >= 0 ? 'pos' : 'neg') + '">' + Z.sfmt(v) + '</b></div>').join('') : '<p class="muted">ჯერ არაფერი</p>') + '</div></div>';
    const lbl = (c) => Z.fdate(Z.cycleStart(c) + 3600e3).split(',')[0];
    Z.lineChart($('#stBal'), [{ name: 'ბალანსი', cls: 's1', values: days.map((d) => ({ x: lbl(d.c), y: +d.bal, label: lbl(d.c) })) }], { h: 170, label: 'ბალანსი დღეების მიხედვით', empty: 'მონაცემები ჯერ არ არის.' });
    Z.barChart($('#stNet'), days.map((d) => ({ y: +d.net || 0, tip: '<b>' + lbl(d.c) + '</b><span>' + Z.sfmt(+d.net || 0) + '</span>' })), { h: 170, label: 'დღის შედეგი', empty: 'მონაცემები ჯერ არ არის.' });
  }

  /* =================== referrals =================== */
  function renderRef() {
    const me = S.me; if (!me) return;
    const cfg = Object.assign({ on: true, amt: 300, xp: 2000 }, S.config.ref || {});
    const link = Z.siteUrl() + '?ref=' + me.ref_code;
    const mine = [...S.players.values()].filter((p) => p.ref_by === S.myId);
    const paid = mine.filter((p) => p.ref_paid).length;
    const html = cfg.on ? '<p class="muted note" style="margin-top:0">გაუზიარე ბმული მეგობარს. როცა ის დააგროვებს ' + Z.fmt(cfg.xp) + ' XP-ს, ორივე მიიღებთ <b>' + Z.fmt(cfg.amt) + '</b> კოინს.</p>' +
      '<div class="ref-link"><input type="text" readonly id="refLink" value="' + Z.esc(link) + '" aria-label="მოწვევის ბმული"><button class="btn primary sm" id="refCopy">კოპირება</button>' + (navigator.share ? '<button class="btn sm" id="refShare">გაზიარება</button>' : '') + '</div>' +
      '<div class="ref-code">შენი კოდი: <b translate="no">' + Z.esc(me.ref_code) + '</b></div>' +
      '<div class="stat-row mini">' + '<div class="stat"><small>მოწვეული</small><b>' + mine.length + '</b></div><div class="stat"><small>აქტიური გახდა</small><b>' + paid + '</b></div><div class="stat"><small>მიღებული ბონუსი</small><b>' + Z.fmt(paid * cfg.amt) + '</b></div></div>' +
      (mine.length ? '<ul class="ref-list">' + mine.map((p) => { const pr = Math.min(100, (+p.xp / cfg.xp) * 100); return '<li>' + Z.av(p.id) + '<span class="nm">' + Z.nm(p.id) + '<span class="qbar"><i style="width:' + pr.toFixed(0) + '%"></i></span></span>' + (p.ref_paid ? '<span class="chip won">აქტიური ✓</span>' : '<small class="muted">' + Z.fmt(+p.xp) + ' / ' + Z.fmt(cfg.xp) + ' XP</small>') + '</li>'; }).join('') + '</ul>' : '')
      : '<p class="muted">მოწვევის ბონუსი ახლა გამორთულია.</p>';
    setHTML($('#refBody'), html);
  }
  $('#refBody').addEventListener('click', async (e) => {
    if (e.target.id === 'refCopy') { const v = $('#refLink').value; try { await navigator.clipboard.writeText(v); Z.toast('ბმული დაკოპირდა', 'win'); } catch (err) { $('#refLink').select(); Z.toast('მონიშნულია: დააკოპირე'); } }
    if (e.target.id === 'refShare') navigator.share({ title: 'ზარაფხანა', text: 'შემოდი ზარაფხანაში და ორივე მივიღებთ ბონუსს!', url: $('#refLink').value }).catch(() => {});
  });

  /* =================== play limits =================== */
  let limAt = 0;
  function renderLim() {
    if (!S.limits) { if (Date.now() - limAt > 8000) { limAt = Date.now(); Z.loadLimits(); } setHTML($('#limBody'), '<div class="skeleton" style="height:8rem"></div>'); return; }
    const L = S.limits.lim || {}, D = S.limits.day || {}, pend = L.pend || {};
    const pause = +L.pause || 0, paused = pause > Z.now();
    const lossUsed = Math.max(0, -(+D.n || 0)), wagUsed = +D.w || 0;
    const bar = (used, lim) => lim ? '<span class="qbar"><i style="width:' + Math.min(100, (used / lim) * 100).toFixed(0) + '%"></i></span><small class="muted">დღეს: ' + Z.fmt(used) + ' / ' + Z.fmt(lim) + '</small>' : '<small class="muted">დღეს: ' + Z.fmt(used) + ' · ლიმიტი არ არის</small>';
    const pn = (k) => pend[k] ? '<small class="pend">24 საათში შეიცვლება: ' + (pend[k].v == null ? 'მოიხსნება' : Z.fmt(pend[k].v)) + ' (' + left(+pend[k].at - Z.now()) + ')</small>' : '';
    const keep = { l: ($('#limLoss') || {}).value, w: ($('#limWag') || {}).value, f: document.activeElement && ['limLoss', 'limWag'].includes(document.activeElement.id) };
    if (keep.f) return;
    setHTML($('#limBody'), (paused ? '<div class="pause-on"><b>შესვენება აქტიურია</b><small>ფსონები და ინვესტიციები დაბლოკილია ' + Z.fdate(pause) + '-მდე (დარჩა ' + left(pause - Z.now()) + ').</small></div>' : '') +
      '<div class="field"><label class="field-lbl" for="limLoss">დღის წაგების ლიმიტი</label><div class="bet-row"><input id="limLoss" type="number" min="0" step="1" placeholder="ლიმიტის გარეშე" value="' + (L.loss ?? '') + '" inputmode="numeric"></div>' + bar(lossUsed, L.loss) + pn('loss') + '</div>' +
      '<div class="field"><label class="field-lbl" for="limWag">დღის ფსონების ლიმიტი</label><div class="bet-row"><input id="limWag" type="number" min="0" step="1" placeholder="ლიმიტის გარეშე" value="' + (L.wager ?? '') + '" inputmode="numeric"></div>' + bar(wagUsed, L.wager) + pn('wager') + '</div>' +
      '<button class="btn primary sm" id="limSave">ლიმიტების შენახვა</button>' +
      '<p class="muted note">ლიმიტის შემცირება მაშინვე მოქმედებს, გაზრდა ან მოხსნა კი მხოლოდ 24 საათის შემდეგ. ლიმიტი ითვლება ყოველდღე 00:00-დან.</p>' +
      '<div class="field"><span class="field-lbl">შესვენება თამაშისგან</span><div class="chips">' + [[24, '1 დღე'], [168, '1 კვირა'], [720, '30 დღე']].map(([h, l]) => '<button type="button" class="chip-btn" data-pause="' + h + '">' + l + '</button>').join('') + '</div><small class="muted">შესვენებას ვადამდე ვერ გააუქმებ. ამ დროს ფსონებს და ინვესტიციებს ვერ დადებ, მაგრამ საიტს ნახავ.</small></div>');
    if (keep.l != null && $('#limLoss').value === '' && keep.l) $('#limLoss').value = keep.l;
  }
  $('#limBody').addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'limSave') {
      const l = Math.floor(+$('#limLoss').value || 0) || null, w = Math.floor(+$('#limWag').value || 0) || null;
      b.disabled = true;
      if (await Z.setLimits(l, w)) { Z.toast('ლიმიტები შენახულია', 'win'); await Z.loadLimits(); $('#limBody')._h = ''; }
      b.disabled = false;
    }
    if (b.dataset.pause) {
      if (b.dataset.armed !== '1') { b.dataset.armed = '1'; const t = b.textContent; b.textContent = 'დაადასტურე'; setTimeout(() => { b.dataset.armed = ''; b.textContent = t; }, 3500); return; }
      if (await Z.pausePlay(+b.dataset.pause)) { Z.toast('შესვენება ჩაირთო', 'win'); await Z.loadLimits(); $('#limBody')._h = ''; }
    }
  });

  /* =================== provable fairness =================== */
  const enc = new TextEncoder();
  const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  Z.sha256 = async (s) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
  Z.fairFloats = async (seed, client, nonce, cnt) => {
    const key = await crypto.subtle.importKey('raw', enc.encode(seed), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const out = [];
    for (let r = 0; out.length < cnt; r++) {
      const h = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(client + ':' + nonce + ':' + r)));
      for (let j = 0; j < 8; j++) out.push(h[4 * j] / 256 + h[4 * j + 1] / 65536 + h[4 * j + 2] / 16777216 + h[4 * j + 3] / 4294967296);
    }
    return out.slice(0, cnt);
  };
  const shuffleTake = (f, n, k, base) => { const pool = Array.from({ length: n }, (_, i) => i + base), out = []; for (let i = 0; i < k; i++) { const j = Math.floor(f[i] * (n - i)); out.push(pool[j]); pool.splice(j, 1); } return out; };
  const SLOT_CUM = [1, 3, 6, 10, 15, 22];
  const WHEEL = [0, 1.5, 0.5, 2, 0, 1.2, 0.3, 3, 0, 1.2];
  const CARD = (v) => { const r = v % 13, s = Math.floor(v / 13); return ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'][r] + ['♠', '♥', '♦', '♣'][s]; };
  // what the result must be for these numbers, and what the server recorded
  const RULES = {
    flip: { n: () => 1, calc: (f) => (f[0] < 0.5 ? 'z' : 'b'), got: (r) => r.r, show: (v) => (v === 'z' ? 'ზურგი' : 'ბორჯღალი') },
    wheel: { n: () => 1, calc: (f) => Math.floor(f[0] * 10), got: (r) => r.idx, show: (v) => 'სექტორი ' + v + ' (×' + WHEEL[v] + ')' },
    dice: { n: () => 1, calc: (f) => Math.floor(f[0] * 10000) / 100, got: (r) => r.roll, show: (v) => (+v).toFixed(2), eq: (a, b) => Math.abs(a - b) < 1e-6 },
    plinko: { n: () => 10, calc: (f) => f.slice(0, 10).reduce((a, x) => a + (x >= 0.5 ? 1 : 0), 0), got: (r) => r.bin, show: (v) => 'უჯრა ' + v },
    roulette: { n: () => 1, calc: (f) => Math.floor(f[0] * 37), got: (r) => r.num, show: (v) => 'რიცხვი ' + v },
    slot: { n: () => 3, calc: (f) => f.slice(0, 3).map((x) => { const r = Math.floor(x * 22); let z = 0; while (r >= SLOT_CUM[z]) z++; return z; }), got: (r) => r.reels, show: (v) => (v || []).map((z) => (Z.SLOT_SYM && Z.SLOT_SYM[z] ? Z.SLOT_SYM[z].g : z)).join(' ') },
    keno: { n: () => 10, calc: (f) => shuffleTake(f, 40, 10, 1), got: (r) => r.drawn, show: (v) => (v || []).join(', ') },
    mines: { n: (g) => +g.params.mines, calc: (f, g) => shuffleTake(f, 25, +g.params.mines, 0).sort((a, b) => a - b), got: (r) => (r.bombs || []).slice().sort((a, b) => a - b), show: (v) => 'ნაღმები უჯრებში: ' + (v || []).map((x) => x + 1).join(', ') },
    tower: { n: () => 8, calc: (f, g) => f.slice(0, 8).map((x) => Math.floor(x * +g.params.n)), got: (r) => r.traps, show: (v) => 'ხაფანგები სართულებზე: ' + (v || []).map((x) => x + 1).join(', ') },
    hilo: { n: () => 60, calc: (f, g) => f.slice(0, 60).map((x) => Math.floor(x * 52)), got: (r, calc) => (r.cards ? r.cards : calc ? calc.slice(0, 1) : null), cmp: (calc, got) => got.every((x, i) => x === calc[i]), show: (v) => (v || []).slice(0, 8).map(CARD).join(' ') + ((v || []).length > 8 ? ' …' : '') },
    bj: { n: () => 24, calc: (f) => f.slice(0, 24).map((x) => Math.floor(x * 52)), got: (r) => r, cmp: (deck, r) => r.p[0] === deck[0] && r.p[1] === deck[2] && r.d[0] === deck[1] && r.d[1] === deck[3], show: (v) => (Array.isArray(v) ? 'მოთამაშე ' + CARD(v[0]) + ' ' + CARD(v[2]) + ' · დილერი ' + CARD(v[1]) + ' ' + CARD(v[3]) : 'მოთამაშე ' + (v.p || []).map(CARD).join(' ') + ' · დილერი ' + (v.d || []).map(CARD).join(' ')) },
    crash: { n: () => 1, calc: (f) => Math.min(10000, Math.max(1, Math.floor((97 / (100 * (1 - f[0]))) * 100) / 100)), got: (r) => r.cp, show: (v) => 'აფეთქდა ×' + (+v).toFixed(2), eq: (a, b) => Math.abs(a - b) < 1e-6 },
  };
  Z.FAIR_RULES = RULES;
  async function verifyGame(g, seed) {
    const rule = RULES[g.g];
    const out = { hashOk: (await Z.sha256(seed)) === g.hash, rule: !!rule };
    if (!rule) return out;
    const f = await Z.fairFloats(seed, g.client, g.nonce, rule.n(g));
    out.f = f;
    out.calc = rule.calc(f, g);
    out.got = g.res ? rule.got(g.res, out.calc) : null;
    if (out.got == null) out.ok = null;
    else if (rule.cmp) out.ok = rule.cmp(out.calc, out.got);
    else if (Array.isArray(out.calc)) out.ok = JSON.stringify(out.calc) === JSON.stringify(out.got);
    else out.ok = rule.eq ? rule.eq(+out.calc, +out.got) : out.calc === out.got;
    return out;
  }
  Z.verifyGame = verifyGame;
  let fairGames = [], fairSeeds = [], fairAt = 0;
  async function loadFair() {
    fairAt = Date.now();
    try {
      const [g, s] = await Promise.all([
        Z.sb.from('games').select('*').eq('user_id', S.myId).eq('status', 'done').not('hash', 'is', null).order('id', { ascending: false }).limit(25),
        Z.sb.from('fair_seeds').select('*').eq('user_id', S.myId).order('at', { ascending: false }).limit(20),
      ]);
      fairGames = (g && g.data) || []; fairSeeds = (s && s.data) || [];
      $('#fairBody')._h = ''; renderFair();
    } catch (e) { console.warn(e); }
  }
  Z.loadFair = loadFair;
  function renderFair() {
    if (Z.view !== 'me') return;
    if (Date.now() - fairAt > 30000) { loadFair(); }
    const f = S.fair;
    if (!f) { setHTML($('#fairBody'), '<div class="skeleton" style="height:8rem"></div>'); return; }
    const seedOf = (h) => (fairSeeds.find((s) => s.hash === h) || {}).seed;
    if (document.activeElement && document.activeElement.id === 'fairClient') return;
    setHTML($('#fairBody'), '<p class="muted note" style="margin-top:0">ყოველი თამაშის შედეგს სერვერი ითვლის ფორმულით <code>HMAC-SHA256(server_seed, "client_seed:nonce:round")</code>. სერვერის seed-ის hash წინასწარ ჩანს, თავად seed კი მისი შეცვლისას იხსნება, ასე რომ შედეგს ვერავინ შეცვლის უკან.</p>' +
      '<div class="fair-cur"><div><small>სერვერის seed-ის hash (მიმდინარე)</small><code class="hash" translate="no">' + Z.esc(f.hash) + '</code></div>' +
      '<div class="fair-row"><div class="field"><label class="field-lbl" for="fairClient">კლიენტის seed</label><div class="bet-row"><input id="fairClient" type="text" maxlength="32" value="' + Z.esc(f.client) + '" translate="no"><button type="button" class="btn sm" id="fairRot">seed-ის შეცვლა</button></div></div><div><small>შემდეგი თამაშის ნომერი</small><b class="num">' + Z.fmt(f.nonce) + '</b></div></div>' +
      '<small class="muted">შეცვლისას მიმდინარე სერვერის seed გამოჩნდება და ამ seed-ით ნათამაშები ყველა თამაშის შემოწმება შეგეძლება.</small></div>' +
      '<h4>ბოლო თამაშები</h4><ul class="fair-list">' + (fairGames.length ? fairGames.map((g) => { const sd = seedOf(g.hash); return '<li><span class="nm"><b>' + Z.esc(Z.gameName(g.g)) + '</b><small>#' + g.nonce + ' · ფსონი ' + Z.fmt(g.bet) + ' · ' + (g.pay > g.bet ? '<span class="pos">+' + Z.fmt(g.pay - g.bet) + '</span>' : '<span class="neg">' + Z.sfmt(+g.pay - +g.bet) + '</span>') + ' · ' + Z.ago(+g.at) + '</small></span>' + (sd ? '<button class="btn sm" data-fv="' + g.id + '">შემოწმება</button>' : '<small class="muted">seed ჯერ დამალულია</small>') + '</li>'; }).join('') : '<li class="muted empty-li">ჯერ არ გითამაშია</li>') + '</ul>' +
      (fairSeeds.length ? '<h4>გახსნილი seed-ები</h4><ul class="fair-seeds">' + fairSeeds.map((s) => '<li><small>hash</small><code translate="no">' + Z.esc(s.hash.slice(0, 24)) + '…</code><small>seed</small><code translate="no">' + Z.esc(s.seed) + '</code><small>' + Z.fmt(s.nonce || 0) + ' თამაში · კლიენტი <span translate="no">' + Z.esc(s.client || '') + '</span></small></li>').join('') + '</ul>' : '') +
      '<details class="fair-manual"><summary>ხელით შემოწმება</summary><div class="fair-form"><input id="fmSeed" placeholder="სერვერის seed" translate="no"><input id="fmClient" placeholder="კლიენტის seed" translate="no"><input id="fmNonce" type="number" placeholder="ნომერი" inputmode="numeric"><select id="fmGame">' + Object.keys(RULES).filter((k) => !['mines', 'tower'].includes(k)).map((k) => '<option value="' + k + '">' + Z.esc(Z.gameName(k)) + '</option>').join('') + '</select><button class="btn sm" id="fmGo">გამოთვლა</button></div><div id="fmOut"></div></details>');
  }
  async function showProof(g) {
    const seed = (fairSeeds.find((s) => s.hash === g.hash) || {}).seed;
    if (!seed) { Z.openModal('<div class="tx"><h2 id="modalTitle">' + Z.esc(Z.gameName(g.g)) + ' #' + g.nonce + '</h2><p>ეს თამაში ნათამაშებია მიმდინარე სერვერის seed-ით, რომლის hash-იც არის:</p><code class="hash" translate="no">' + Z.esc(g.hash) + '</code><p class="muted">შესამოწმებლად შეცვალე seed „ჩემი გვერდის“ სამართლიანი თამაშის განყოფილებაში. ძველი seed გამოჩნდება და შედეგს თავად გადაამოწმებ.</p><div class="btn-row"><button class="btn primary" data-go="me" data-close>გადასვლა</button></div></div>'); return; }
    const v = await verifyGame(g, seed);
    const rule = RULES[g.g];
    Z.openModal('<div class="tx proof"><h2 id="modalTitle">' + Z.esc(Z.gameName(g.g)) + ' #' + g.nonce + '</h2>' +
      '<dl class="proof-dl"><dt>სერვერის seed</dt><dd><code translate="no">' + Z.esc(seed) + '</code></dd><dt>მისი SHA-256</dt><dd><code translate="no">' + Z.esc(g.hash) + '</code> ' + (v.hashOk ? '<span class="chip won">ემთხვევა ✓</span>' : '<span class="chip lost">არ ემთხვევა ✗</span>') + '</dd>' +
      '<dt>კლიენტის seed · ნომერი</dt><dd><code translate="no">' + Z.esc(g.client) + ' · ' + g.nonce + '</code></dd>' +
      (v.f ? '<dt>პირველი რიცხვები</dt><dd><code>' + v.f.slice(0, 4).map((x) => x.toFixed(6)).join(', ') + (v.f.length > 4 ? ' …' : '') + '</code></dd>' : '') +
      (rule ? '<dt>გამოთვლილი შედეგი</dt><dd><b>' + Z.esc(rule.show(v.calc)) + '</b></dd><dt>სერვერმა ჩაწერა</dt><dd><b>' + Z.esc(v.got == null ? '—' : rule.show(v.got)) + '</b> ' + (v.ok === true ? '<span class="chip won">ემთხვევა ✓</span>' : v.ok === false ? '<span class="chip lost">არ ემთხვევა ✗</span>' : '') + '</dd>' : '<dt>შედეგი</dt><dd class="muted">ამ თამაშის ავტომატური შემოწმება ჯერ არ არის.</dd>') +
      '<dt>ფსონი · გადახდა</dt><dd>' + Z.fmt(g.bet) + ' · ' + Z.fmt(g.pay) + '</dd></dl>' +
      '<p class="muted note">გამოთვლა შესრულდა შენს ბრაუზერში, სერვერის დახმარების გარეშე.</p></div>');
  }
  $('#fairBody').addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'fairRot') {
      b.disabled = true;
      const r = await Z.fairRotate($('#fairClient').value.trim());
      if (r) { S.fair = r; Z.toast('seed შეიცვალა. ძველი seed გახსნილია.', 'win'); await loadFair(); }
      b.disabled = false;
    }
    if (b.dataset.fv) { const g = fairGames.find((x) => x.id === +b.dataset.fv); if (g) showProof(g); }
    if (b.id === 'fmGo') {
      const seed = $('#fmSeed').value.trim(), client = $('#fmClient').value.trim(), nonce = Math.floor(+$('#fmNonce').value || 0), k = $('#fmGame').value, rule = RULES[k];
      if (!seed || !client) { Z.toast('ჩაწერე seed-ები.', 'loss'); return; }
      const f = await Z.fairFloats(seed, client, nonce, rule.n({ params: {} }));
      $('#fmOut').innerHTML = '<p>hash: <code translate="no">' + (await Z.sha256(seed)) + '</code></p><p>შედეგი: <b>' + Z.esc(rule.show(rule.calc(f, { params: {} }))) + '</b></p>';
    }
  });
  // the "check this result" link under each game
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-fair-last]'); if (!b) return;
    const gk = (b.closest('.game-root') || {}).dataset ? b.closest('.game-root').dataset.g : null;
    const lg = gk && Z.lastGames && Z.lastGames[gk] ? { id: Z.lastGames[gk] } : gk && Z.lastGames ? null : Z.lastGame;
    if (!lg || !lg.id) { Z.openModal('<div class="tx"><h2 id="modalTitle">სამართლიანი თამაში</h2><p>ჯერ ითამაშე: ყოველი თამაშის შემდეგ აქ ნახავ მის მონაცემებს და შემოწმების გზას.</p><div class="btn-row"><button class="btn ghost" data-go="me" data-close>დეტალები</button></div></div>'); return; }
    const { data } = await Z.sb.from('games').select('*').eq('id', lg.id).limit(1);
    const g = data && data[0];
    if (!g) return;
    if (!fairSeeds.length) await loadFair();
    showProof(g);
  });

  /* =================== render =================== */
  Z.renderers.me = () => {
    if (!S.ready || !S.me) return;
    renderCard(); renderPass(); renderStats(false); renderRef(); renderLim(); renderFair();
  };
  setInterval(() => { if (Z.view === 'me' && S.limits && document.visibilityState === 'visible') { $('#limBody')._h = ''; renderLim(); } }, 30000);
})();
