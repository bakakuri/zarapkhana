/* ზარაფხანა — profiles, notifications, guide, quests, lottery, shop, boxes, tier stats, fame, admin tools, charts */
(function () {
  const Z = window.Z;
  const S = Z.state;
  const { $, $$ } = Z;
  const root = document.documentElement;
  const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const setHTML = Z.setHTML;

  /* ---------- holidays (same rule as the server) ---------- */
  Z.holiday = () => {
    const t = S.config.theme;
    if (t === 'halloween' || t === 'newyear') return t;
    if (t === 'none') return null;
    const d = new Date(Z.now() + 4 * 3600e3), md = (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
    if (md >= 1024 && md <= 1102) return 'halloween';
    if (md >= 1220 || md <= 107) return 'newyear';
    return null;
  };

  /* ---------- skins ---------- */
  function applySkin() {
    const sk = S.myId ? Z.eqOf(S.myId, 'skin') : null;
    if (sk) { if (root.dataset.skin !== sk) root.dataset.skin = sk; } else if (root.dataset.skin) delete root.dataset.skin;
    const h = Z.holiday();
    if (h) { if (root.dataset.holiday !== h) root.dataset.holiday = h; } else if (root.dataset.holiday) delete root.dataset.holiday;
  }

  /* ---------- sound toggle ---------- */
  const snd = $('#sndBtn');
  const syncSnd = () => { snd.classList.toggle('off', !Z.soundOn()); snd.setAttribute('aria-pressed', String(Z.soundOn())); snd.title = Z.soundOn() ? 'ხმა ჩართულია' : 'ხმა გამორთულია'; };
  snd.addEventListener('click', () => { Z.setSound(!Z.soundOn()); syncSnd(); Z.toast(Z.soundOn() ? 'ხმა ჩართულია' : 'ხმა გამორთულია'); });
  syncSnd();
  Z.syncSnd = syncSnd;

  /* ---------- announcement bar ---------- */
  function renderAnn() {
    const a = S.config.ann, bar = $('#annBar');
    const seen = Z.store.get('zar-ann-seen', 0);
    if (!a || !a.t || a.at <= seen || !S.ready) { bar.hidden = true; return; }
    if (bar.dataset.at === String(a.at) && !bar.hidden) return;
    bar.dataset.at = String(a.at);
    bar.innerHTML = '<span class="ann-ic"><svg><use href="#i-bell"/></svg></span><p translate="no"></p><button class="icon-btn" id="annX" aria-label="დახურვა"><svg><use href="#i-close"/></svg></button>';
    bar.querySelector('p').textContent = a.t;
    bar.hidden = false;
    $('#annX').addEventListener('click', () => { Z.store.set('zar-ann-seen', a.at); bar.hidden = true; });
  }

  /* ---------- charts (SVG, hover tooltip) ---------- */
  const tip = $('#chartTip');
  function showTip(x, y, html) { tip.innerHTML = html; tip.hidden = false; const w = tip.offsetWidth; tip.style.left = Math.min(innerWidth - w - 8, Math.max(8, x - w / 2)) + 'px'; tip.style.top = Math.max(8, y - tip.offsetHeight - 14) + 'px'; }
  function hideTip() { tip.hidden = true; }
  Z.showTip = showTip; Z.hideTip = hideTip;
  const niceStep = (v) => { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; };
  // series: [{name, cls, values:[{x, y, label}]}]
  Z.lineChart = (el, series, opts = {}) => {
    const W = Math.max(300, Math.round(el.clientWidth || 640)), H = opts.h || 220, pad = { l: 56, r: 16, t: 14, b: 26 };
    const pts = series[0].values;
    if (!pts.length) { el.innerHTML = Z.empty(opts.empty || 'მონაცემები ჯერ არ არის.'); return; }
    const all = series.flatMap((s) => s.values.map((v) => v.y));
    const mn = Math.min(...all), mxv = Math.max(...all);
    const lo = opts.zero === false ? mn - (mxv - mn) * 0.08 : Math.min(0, mn);
    const stepV = niceStep((mxv * 1.05 - lo) / 4 || 1);
    const lo2 = opts.zero === false ? Math.floor(lo / stepV) * stepV : lo;
    const hi = lo2 + Math.ceil((mxv * 1.05 - lo2) / stepV) * stepV || 1;
    const n = pts.length, X = (i) => pad.l + (n === 1 ? (W - pad.l - pad.r) / 2 : (i / (n - 1)) * (W - pad.l - pad.r));
    const Y = (v) => pad.t + (1 - (v - lo2) / (hi - lo2 || 1)) * (H - pad.t - pad.b);
    let svg = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + Z.esc(opts.label || 'გრაფიკი') + '">';
    for (let v = lo2; v <= hi + 1e-9; v += stepV) { const y = Y(v); svg += '<line class="gl" x1="' + pad.l + '" x2="' + (W - pad.r) + '" y1="' + y + '" y2="' + y + '"/><text class="ax" x="' + (pad.l - 8) + '" y="' + (y + 4) + '" text-anchor="end">' + Z.fmt(v) + '</text>'; }
    const step = Math.max(1, Math.ceil(n / 6));
    pts.forEach((p, i) => { if (i % step === 0 || i === n - 1) svg += '<text class="ax" x="' + X(i) + '" y="' + (H - 6) + '" text-anchor="middle">' + Z.esc(p.x) + '</text>'; });
    series.forEach((s, si) => {
      const d = s.values.map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v.y).toFixed(1)).join(' ');
      const base = Y(Math.max(lo2, Math.min(0, hi)));
      if (si === 0 && opts.area !== false) svg += '<path class="area ' + s.cls + '" d="' + d + ' L' + X(n - 1) + ' ' + base + ' L' + X(0) + ' ' + base + 'Z"/>';
      svg += '<path class="ln ' + s.cls + '" d="' + d + '" pathLength="1"/>';
      const lv = s.values[n - 1];
      svg += '<circle class="dot ' + s.cls + '" cx="' + X(n - 1) + '" cy="' + Y(lv.y) + '" r="4.5"/>';
    });
    svg += '<line class="xh" x1="0" x2="0" y1="' + pad.t + '" y2="' + (H - pad.b) + '" style="opacity:0"/><rect class="hit" x="' + pad.l + '" y="0" width="' + (W - pad.l - pad.r) + '" height="' + H + '"/></svg>';
    const legend = series.length > 1 ? '<div class="legend">' + series.map((s) => '<span><i class="sw ' + s.cls + '"></i>' + Z.esc(s.name) + ' <b>' + Z.fmt(s.values[n - 1].y) + '</b></span>').join('') + '</div>' : '';
    el.innerHTML = legend + '<div class="chart-wrap">' + svg + '</div>';
    const sv = el.querySelector('svg'), xh = el.querySelector('.xh');
    const move = (e) => {
      const r = sv.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * W;
      const i = Z.clamp(Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (n - 1)), 0, n - 1);
      xh.setAttribute('x1', X(i)); xh.setAttribute('x2', X(i)); xh.style.opacity = 1;
      showTip(r.left + (X(i) / W) * r.width, r.top + (Y(series[0].values[i].y) / H) * r.height,
        '<b>' + Z.esc(pts[i].label || pts[i].x) + '</b>' + series.map((s) => '<span><i class="sw ' + s.cls + '"></i>' + Z.esc(s.name) + ': ' + Z.fmt(s.values[i].y) + '</span>').join(''));
    };
    sv.addEventListener('pointermove', move);
    sv.addEventListener('pointerleave', () => { xh.style.opacity = 0; hideTip(); });
  };
  Z.barChart = (el, vals, opts = {}) => {
    const W = 300, H = opts.h || 84, pad = { t: 6, b: 6 };
    if (!vals.length) { el.innerHTML = '<p class="muted note">' + (opts.empty || 'რაუნდები ჯერ არ არის') + '</p>'; return; }
    const mx = Math.max(1, ...vals.map((v) => Math.abs(v.y)));
    const pos = vals.every((v) => v.y >= 0);
    const bw = W / vals.length, Y0 = pos ? H - pad.b : H / 2, k = (pos ? H - pad.t - pad.b : H / 2 - pad.t) / mx;
    let svg = '<svg class="bars" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="' + Z.esc(opts.label || '') + '"><line class="zero" x1="0" x2="' + W + '" y1="' + Y0 + '" y2="' + Y0 + '"/>';
    vals.forEach((v, i) => {
      const h = Math.max(1.5, Math.abs(v.y) * k), y = v.y >= 0 ? Y0 - h : Y0;
      svg += '<rect class="b ' + (v.y >= 0 ? 'up' : 'dn') + '" data-i="' + i + '" x="' + (i * bw + 1.5) + '" y="' + y + '" width="' + Math.max(1, bw - 3) + '" height="' + h + '" rx="2" style="--k:' + i + '"/>';
    });
    svg += '</svg>';
    el.innerHTML = svg;
    const sv = el.querySelector('svg');
    sv.addEventListener('pointermove', (e) => {
      const r = sv.getBoundingClientRect(), i = Z.clamp(Math.floor(((e.clientX - r.left) / r.width) * vals.length), 0, vals.length - 1);
      sv.querySelectorAll('.b').forEach((b) => b.classList.toggle('hl', +b.dataset.i === i));
      showTip(e.clientX, r.top, vals[i].tip);
    });
    sv.addEventListener('pointerleave', () => { sv.querySelectorAll('.b').forEach((b) => b.classList.remove('hl')); hideTip(); });
  };

  /* ---------- profile ---------- */
  Z.openProfile = (pid) => {
    if (!pid) return;
    const p = Z.player(pid), me = pid === S.myId, st = (p && p.st) || {};
    const title = Z.titleOf(pid);
    const stat = (l, v, cls) => '<div><small>' + l + '</small><b class="num ' + (cls || '') + '">' + v + '</b></div>';
    const ach = (p && p.ach) || {};
    const got = Z.ACH.filter((a) => ach[a.k]);
    const clan = Z.clanOf(pid);
    const cw = Z.curWeek(), wk = S.weekly.get(cw + '|' + pid) || {}, lw = S.weekly.get(cw - 7 + '|' + pid) || {};
    Z.openModal('<div class="profile">' +
      '<div class="pf-head">' + Z.av(pid, 'xl') + '<div><h2 id="modalTitle">' + Z.nm(pid) + '</h2>' +
      '<div class="pf-tags">' + (p ? Z.lvChip(pid) : '') + (title ? '<span class="title-chip">' + Z.esc(title) + '</span>' : '') +
      (p && p.muted ? '<span class="chip lost">დადუმებული</span>' : '') + (p && p.frozen ? '<span class="chip lost">გაყინული</span>' : '') + (p && p.is_admin ? '<span class="chip open">ადმინი</span>' : '') + '</div>' +
      (p ? '<small class="muted">შემოვიდა ' + Z.fdate(p.joinedAt || Z.now()).split(',')[0] + (clan ? ' · კლანი „' + Z.esc(clan.name) + '“' : '') + (p.seen_at ? ' · ბოლოს ' + Z.ago(+p.seen_at) : '') + '</small>' : '<small class="muted">მოთამაშე ვერ მოიძებნა</small>') + '</div></div>' +
      (p ? '<div class="pf-stats">' + stat('ბალანსი', Z.fmt(Z.bal(pid))) + stat('სრული ქონება', Z.fmt(Z.wealthOf(pid))) + stat('ინვესტიციების შედეგი', Z.sfmt(st.inv || 0), (st.inv || 0) >= 0 ? 'pos' : 'neg') +
        stat('თამაშების შედეგი', Z.sfmt(st.game || 0), (st.game || 0) >= 0 ? 'pos' : 'neg') + stat('თამაშები', Z.fmt(st.games || 0)) + stat('საუკეთესო მოგება', Z.fmt(st.best || 0)) +
        stat('მოგების სერია', st.maxStreak || 0) + stat('დუელში მოგება', st.duelW || 0) + stat('პოკერის ხელები', Z.fmt(st.pokerH || 0)) + stat('აქციების შედეგი', Z.sfmt(st.stockPnl || 0), (st.stockPnl || 0) >= 0 ? 'pos' : 'neg') + '</div>' +
        '<div class="pf-week"><div><small>ეს კვირა</small><b class="num ' + ((+wk.net || 0) >= 0 ? 'pos' : 'neg') + '">' + Z.sfmt(+wk.net || 0) + '</b><small>' + (wk.n || 0) + ' თამაში · ბრუნვა ' + Z.fmt(+wk.vol || 0) + '</small></div>' +
        '<div><small>წინა კვირა</small><b class="num ' + ((+lw.net || 0) >= 0 ? 'pos' : 'neg') + '">' + Z.sfmt(+lw.net || 0) + '</b><small>' + (lw.n || 0) + ' თამაში · ბრუნვა ' + Z.fmt(+lw.vol || 0) + '</small></div></div>' +
        '<div class="pf-ach"><h4>მიღწევები · ' + got.length + ' / ' + Z.ACH.length + '</h4><div class="pf-medals">' + (got.length ? got.map((a) => '<span title="' + Z.esc(a.name + ': ' + a.desc) + '">' + Z.medal(a, 1) + '</span>').join('') : '<span class="muted">ჯერ არცერთი</span>') + '</div></div>' : '') +
      '<div class="btn-row pf-acts">' +
      (me ? '<button class="btn primary" data-go="me" data-close>ჩემი გვერდი</button><button class="btn ghost" data-go="shop" data-close>მაღაზია</button><button class="btn ghost" id="pfGuide">გაცნობის თავიდან ნახვა</button>'
        : (p && S.me ? (S.config.tx !== false ? '<button class="btn primary" id="pfTx">გადარიცხვა</button>' : '') + '<button class="btn ghost" id="pfDuel">დუელში გამოწვევა</button><button class="btn ghost" id="pfLoan">სესხის შეთავაზება</button>' : '')) +
      '</div>' +
      (S.isAdmin && p ? '<div class="pf-admin"><h4>ადმინი</h4><div class="btn-row">' +
        '<button class="btn sm" id="pfGrant">დარიცხვა</button>' +
        (!me ? '<button class="btn sm ' + (p.muted ? '' : 'danger') + '" data-adm="muted">' + (p.muted ? 'დადუმების მოხსნა' : 'ჩატში დადუმება') + '</button>' +
          '<button class="btn sm ' + (p.frozen ? '' : 'danger') + '" data-adm="frozen">' + (p.frozen ? 'გაყინვის მოხსნა' : 'ანგარიშის გაყინვა') + '</button>' +
          '<button class="btn sm ghost" data-adm="is_admin">' + (p.is_admin ? 'ადმინობის მოხსნა' : 'ადმინად დანიშვნა') + '</button>' : '') +
        (p.pic ? '<button class="btn sm ghost" data-adm="pic_hidden">' + (p.pic_hidden ? 'ფოტოს გამოჩენა' : 'ფოტოს დამალვა') + '</button>' : '') +
        '<button class="btn sm ghost" id="pfLedger">ოპერაციები</button></div><div id="pfLedgerBox"></div></div>' : '') +
      '</div>');
    const on = (id, fn) => { const b = $('#' + id); if (b) b.addEventListener('click', fn); };
    on('pfGuide', () => { Z.closeModal(); Z.go('home'); setTimeout(startGuide, 400); });
    on('pfTx', () => Z.openTransfer(pid));
    on('pfDuel', () => { Z.closeModal(); Z.go('games'); Z.showGame('duel'); setTimeout(() => Z.setDuelTarget && Z.setDuelTarget(pid), 60); });
    on('pfLoan', () => { Z.closeModal(); Z.go('market'); Z.mkTab && Z.mkTab('loans'); setTimeout(() => Z.setLoanTarget && Z.setLoanTarget(pid), 60); });
    on('pfGrant', () => { Z.closeModal(); Z.go('admin'); setTimeout(() => Z.adminPick && Z.adminPick(pid), 60); });
    $$('#modalBody [data-adm]').forEach((b) => b.addEventListener('click', async () => {
      const f = b.dataset.adm, cur = !!(S.players.get(pid) || {})[f];
      b.disabled = true;
      if (await Z.adminUser(pid, f, !cur)) { const pp = S.players.get(pid); if (pp) pp[f] = !cur; Z.toast('შენახულია', 'win'); Z.openProfile(pid); }
      b.disabled = false;
    }));
    on('pfLedger', async () => {
      const box = $('#pfLedgerBox');
      box.innerHTML = '<div class="skeleton" style="height:6rem"></div>';
      try {
        const rows = await Z.api('admin_ledger', { who: pid, lim: 60 }, { quiet: true });
        const hist = Z.histOf(rows || []);
        box.innerHTML = '<ul class="feed mini">' + (hist.length ? hist.map((h) => '<li><span class="who"><b>' + Z.esc(Z.histText(h)) + '</b><small>' + Z.fdate(h.at) + ' · ბალანსი ' + Z.fmt(+((rows.find((r) => r.id === h.id) || {}).bal || 0)) + '</small></span><span class="amt ' + (h.delta > 0 ? 'pos' : h.delta < 0 ? 'neg' : '') + '">' + Z.sfmt(h.delta) + '</span></li>').join('') : '<li class="muted">ოპერაციები არ არის</li>') + '</ul>';
      } catch (e) { box.innerHTML = '<p class="muted">' + Z.esc(Z.errText(e)) + '</p>'; }
    });
  };
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-pid]');
    if (!a || e.target.closest('button[data-id], .search-res, .picked, .guide, .duel-show, .pk-table, .no-profile')) return;
    e.preventDefault();
    Z.openProfile(a.dataset.pid);
  });
  const meAv = $('#meAvatar');
  meAv.addEventListener('click', () => S.myId && Z.openProfile(S.myId));
  meAv.setAttribute('role', 'button'); meAv.setAttribute('tabindex', '0');
  meAv.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); S.myId && Z.openProfile(S.myId); } });

  /* ---------- notifications bell ---------- */
  const bellBtn = $('#bellBtn'), pop = $('#bellPop');
  let lastUnread = -1;
  const NOTE_IC = { duel: 'VS', ann: '!', a: '+', ach: '★', lvl: '↑', round: '◷', creq: '?', lnoffer: '₾', aout: '⚑', awon: '⚑', asold: '⚑', aexp: '⚑' };
  function notes() {
    const out = [];
    for (const n of S.notes || []) out.push({ at: +n.at, k: n.k, t: Z.noteText(n), d: n.d == null ? 0 : +n.d, a: n.k === 'ach' ? Z.achDef((n.meta || {}).a) : null, unread: !n.seen,
      act: n.k === 'duel' ? 'duel' : n.k === 'lnoffer' ? 'loans' : n.k === 'creq' ? 'clan' : ['aout', 'awon', 'asold', 'aexp'].includes(n.k) ? 'auction' : n.k === 'round' ? 'invest' : null });
    for (const d of S.duels.values()) if (d.st === 'open' && d.to === S.myId && !out.some((x) => x.k === 'duel' && Math.abs(x.at - d.at) < 3000)) out.push({ at: d.at, k: 'duel', t: 'დუელში გიწვევს: ' + Z.nameOf(d.f) + ' · ' + Z.fmt(d.s) + ' კოინი', act: 'duel', unread: true });
    const ann = S.config.ann;
    if (ann && ann.t) out.push({ at: ann.at, k: 'ann', t: 'განცხადება: ' + ann.t, unread: ann.at > Z.store.get('zar-bell-ann', 0) });
    return out.sort((a, b) => b.at - a.at).slice(0, 30);
  }
  function renderBell() {
    if (!S.ready) return;
    const list = notes();
    const unread = list.filter((n) => n.unread).length;
    const b = $('#bellBadge');
    b.hidden = !unread; b.textContent = unread > 9 ? '9+' : unread;
    if (lastUnread >= 0 && unread > lastUnread) { bellBtn.classList.remove('ring'); void bellBtn.offsetWidth; bellBtn.classList.add('ring'); Z.sfx && Z.sfx('bell'); }
    lastUnread = unread;
    if (pop.hidden) return;
    const ic = (n) => n.a ? Z.medal(n.a, 1) : '<span class="bn-ic ' + (n.d > 0 ? 'pos' : n.d < 0 ? 'neg' : '') + '">' + (NOTE_IC[n.k] || (n.d >= 0 ? '+' : '−')) + '</span>';
    const changed = setHTML($('#bellList'), list.length ? list.map((n, i) => '<li class="' + (n.unread ? 'new' : '') + '" style="--k:' + i + '"' + (n.act ? ' data-act="' + n.act + '"' : '') + '>' + ic(n) + '<span class="bn-t"><b></b><small>' + Z.ago(n.at) + '</small></span>' + (n.d ? '<span class="num ' + (n.d > 0 ? 'pos' : 'neg') + '">' + Z.sfmt(n.d) + '</span>' : '') + '</li>').join('') : '<li class="muted empty-li">შეტყობინებები ჯერ არ არის</li>');
    if (changed && list.length) $$('#bellList li .bn-t b').forEach((el, i) => (el.textContent = list[i].t));
  }
  async function markRead() {
    Z.store.set('zar-bell-ann', Z.now());
    if ((S.notes || []).some((n) => !n.seen)) {
      S.notes.forEach((n) => (n.seen = true));
      try { await Z.api('notes_seen', {}, { quiet: true }); } catch (e) {}
    }
    renderBell();
  }
  function toggleBell(force) {
    const open = force != null ? force : pop.hidden;
    pop.hidden = !open;
    bellBtn.setAttribute('aria-expanded', String(open));
    renderBell();
    if (open) setTimeout(() => { if (!pop.hidden) markRead(); }, 2000);
  }
  bellBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleBell(); });
  $('#bellRead').addEventListener('click', markRead);
  /* ---------- settings menu: theme, sound, language ---------- */
  const setBtn = $('#setBtn'), setPop = $('#setPop');
  const toggleSet = (force) => { const open = force != null ? force : setPop.hidden; setPop.hidden = !open; setBtn.setAttribute('aria-expanded', String(open)); };
  setBtn.addEventListener('click', (e) => { e.stopPropagation(); if (!pop.hidden) toggleBell(false); toggleSet(); });
  bellBtn.addEventListener('click', () => toggleSet(false));
  document.addEventListener('click', (e) => { if (!setPop.hidden && !e.target.closest('#setPop, #setBtn')) toggleSet(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !setPop.hidden) { toggleSet(false); setBtn.focus(); } });
  document.addEventListener('click', (e) => {
    if (!pop.hidden && !e.target.closest('#bellPop, #bellBtn')) toggleBell(false);
    const li = e.target.closest('#bellList [data-act]');
    if (!li) return;
    toggleBell(false);
    const a = li.dataset.act;
    if (a === 'duel') { Z.go('games'); Z.showGame('duel'); }
    else if (a === 'loans') { Z.go('market'); Z.mkTab && Z.mkTab('loans'); }
    else if (a === 'auction') { Z.go('market'); Z.mkTab && Z.mkTab('auction'); }
    else if (a === 'clan') Z.go('leaders');
    else if (a === 'invest') Z.go('invest');
  });

  /* ---------- first-visit guide ---------- */
  const guide = $('#guide'), spot = $('#guideSpot'), gbox = $('#guideBox');
  const wide = () => innerWidth >= 900;
  const STEPS = [
    { sel: () => '#heroBal', t: 'ეს შენი ბალანსია', d: 'მისასალმებელ კოინებს უკვე მიიღებდი. კოინებს იყენებ ინვესტიციებში, თამაშებში, ბანკში, აქციებსა და მაღაზიაში.' },
    { sel: () => '#calPanel', t: 'შესვლის კალენდარი', d: 'შემოდი ყოველდღე: 7 დღის სერიაზე ჯილდო იზრდება, მე-7 დღეს კი ყუთს იღებ.' },
    { sel: () => (wide() ? '.tab[data-go="invest"]' : '#bottomNav [data-go="invest"]'), t: 'ინვესტიციები', d: '4 დონე, შედეგები ყოველდღე 00:00-ზე. შეგიძლია დააზღვიო ან ბანკში ანაბარი გახსნა.' },
    { sel: () => (wide() ? '.tab[data-go="games"]' : '#bottomNav [data-go="games"]'), t: 'თამაშები', d: 'რაკეტა, პოკერი, ბინგო, დუელები და კიდევ 12 თამაში. ყოველი შედეგის შემოწმება შეგიძლია.' },
    { sel: () => '#questPanel', t: 'დღის დავალებები', d: 'ყოველდღე 3 ახალი დავალება. შეასრულე და აიღე კოინები და XP.' },
    { sel: () => '#bellBtn', t: 'შეტყობინებები', d: 'აქ ჩანს რაუნდის შედეგები, გადარიცხვები, ბეჯები, დუელები და აუქციონი.' },
    { sel: () => '#chatFab', t: 'ჩატი', d: 'ისაუბრე სხვებთან. ნებისმიერ ავატარზე დაჭერით მოთამაშის პროფილი გაიხსნება.' },
  ];
  let gi = 0;
  function placeGuide() {
    const st = STEPS[gi], el = document.querySelector(st.sel());
    if (!el || el.offsetParent === null) { if (gi < STEPS.length - 1) { gi++; return placeGuide(); } return endGuide(); }
    el.scrollIntoView({ block: 'center', behavior: reduce() ? 'auto' : 'smooth' });
    setTimeout(() => {
      const r = el.getBoundingClientRect(), padd = 8;
      Object.assign(spot.style, { left: r.left - padd + 'px', top: r.top - padd + 'px', width: r.width + padd * 2 + 'px', height: r.height + padd * 2 + 'px' });
      gbox.innerHTML = '<small>' + (gi + 1) + ' / ' + STEPS.length + '</small><h3></h3><p></p><div class="btn-row"><button class="btn ghost" id="gSkip">გამოტოვება</button><button class="btn primary" id="gNext">' + (gi === STEPS.length - 1 ? 'დასრულება' : 'შემდეგი') + '</button></div>';
      gbox.querySelector('h3').textContent = Z.t ? Z.t(st.t) : st.t; gbox.querySelector('p').textContent = Z.t ? Z.t(st.d) : st.d;
      const bw = Math.min(340, innerWidth - 32);
      const below = r.bottom + 16 + 190 < innerHeight;
      Object.assign(gbox.style, { width: bw + 'px', left: Z.clamp(r.left + r.width / 2 - bw / 2, 16, innerWidth - bw - 16) + 'px', top: (below ? r.bottom + 16 : Math.max(16, r.top - 16 - gbox.offsetHeight)) + 'px' });
      gbox.classList.remove('in'); void gbox.offsetWidth; gbox.classList.add('in');
      $('#gSkip').addEventListener('click', endGuide);
      $('#gNext').addEventListener('click', () => { gi++; if (gi >= STEPS.length) endGuide(); else placeGuide(); });
      $('#gNext').focus();
    }, reduce() ? 0 : 380);
  }
  function startGuide() { gi = 0; guide.hidden = false; placeGuide(); }
  function endGuide() { guide.hidden = true; Z.store.set('zar-guide-done', 1); }
  Z.startGuide = startGuide;
  let guideChecked = false;
  function maybeGuide() {
    if (guideChecked || !S.ready || !S.me || Z.view !== 'home') return;
    guideChecked = true;
    if (!Z.store.get('zar-guide-done', 0)) setTimeout(startGuide, 1400);
  }
  addEventListener('resize', () => { if (!guide.hidden) placeGuide(); });

  /* ---------- daily quests (home) ---------- */
  Z.QUESTS = [
    { k: 'play5', t: 'ითამაშე 5 თამაში', goal: 5, rew: 60 },
    { k: 'play15', t: 'ითამაშე 15 თამაში', goal: 15, rew: 150 },
    { k: 'win3', t: 'მოიგე 3 თამაში', goal: 3, rew: 80 },
    { k: 'crash2', t: 'რაკეტაში აიღე ×2 ან მეტი', goal: 1, rew: 70 },
    { k: 'wager', t: 'დადე ჯამში 500 კოინის ფსონი', goal: 500, rew: 120 },
    { k: 'inv1', t: 'ჩადე ინვესტიცია', goal: 1, rew: 60 },
    { k: 'invmh', t: 'ჩადე საშუალო ან მაღალ დონეზე', goal: 1, rew: 100 },
    { k: 'chat', t: 'დაწერე ჩატში', goal: 1, rew: 40 },
    { k: 'duel', t: 'მიიღე მონაწილეობა დუელში', goal: 1, rew: 100 },
    { k: 'ticket', t: 'იყიდე ლატარიის ბილეთი', goal: 1, rew: 50 },
    { k: 'bj3', t: 'ითამაშე ბლექჯეკის 3 ხელი', goal: 3, rew: 70 },
    { k: 'plinko10', t: 'გააგდე 10 ბურთი Plinko-ში', goal: 10, rew: 70 },
    { k: 'bonus', t: 'აიღე დღიური ბონუსი', goal: 1, rew: 30 },
    { k: 'tx', t: 'გადაურიცხე ვინმეს კოინები', goal: 1, rew: 50 },
    { k: 'poker3', t: 'ითამაშე პოკერის 3 ხელი', goal: 3, rew: 90 },
    { k: 'bingo1', t: 'იყიდე ბინგოს ბარათი', goal: 1, rew: 50 },
    { k: 'stock1', t: 'იყიდე ან გაყიდე აქცია', goal: 1, rew: 60 },
    { k: 'box1', t: 'გახსენი სიურპრიზ-ყუთი', goal: 1, rew: 60 },
    { k: 'bank1', t: 'გახსენი ანაბარი ბანკში', goal: 1, rew: 60 },
  ];
  Z.questReward = (q) => Math.floor(q.rew * (S.config.questMult ?? 1) * (Z.evOn('quest2') ? 2 : 1));
  $('#questGrid').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-claim]');
    if (!b) return;
    b.disabled = true;
    const amt = await Z.claimQuest(b.dataset.claim);
    if (amt) { Z.toast('დავალება შესრულდა: +' + Z.fmt(amt) + ' კოინი', 'win'); Z.coinFly(b, $('#balPill'), 8); if (S.quests) S.quests.cl = (S.quests.cl || []).concat(b.dataset.claim); Z.emit(); }
    else b.disabled = false;
  });
  function questLeft() { const c = Z.cycleOf(Z.now()), el = $('#questLeft'); if (el) el.textContent = 'განახლდება ' + Z.hms(Z.cycleEnd(c) - Z.now()) + '-ში'; }
  function renderQuests() {
    if (Z.view !== 'home' || !S.ready) return;
    questLeft();
    const q = S.quests;
    if (!q || !q.qs) { setHTML($('#questGrid'), '<div class="skeleton" style="height:6rem"></div>'); return; }
    if (q.day !== Z.cycleOf(Z.now())) { Z.loadQuests(); }
    setHTML($('#questGrid'), q.qs.map((k, i) => {
      const d = Z.QUESTS.find((x) => x.k === k) || { k, t: k, goal: 1, rew: 0 };
      const v = +((q.p || {})[k] || 0), done = v >= d.goal, cl = (q.cl || []).includes(k);
      return '<div class="quest' + (cl ? ' claimed' : done ? ' ready' : '') + '" style="--k:' + i + '"><b>' + Z.esc(d.t) + '</b>' +
        '<span class="qbar"><i style="width:' + Math.min(100, (v / d.goal) * 100) + '%"></i></span>' +
        '<div class="qfoot"><small class="num">' + Z.fmt(Math.min(v, d.goal)) + ' / ' + Z.fmt(d.goal) + '</small><small>+' + Z.fmt(Z.questReward(d)) + ' კოინი · +25 XP</small></div>' +
        (cl ? '<span class="chip won">აღებულია</span>' : done ? '<button class="btn primary sm" data-claim="' + k + '">ჯილდოს აღება</button>' : '') + '</div>';
    }).join(''));
  }
  setInterval(() => { if (Z.view === 'home' && S.ready) questLeft(); }, 1000);
  // refresh quest progress now and then while on home (games, chat, etc. move it)
  setInterval(() => { if (Z.view === 'home' && S.ready && document.visibilityState === 'visible') Z.loadQuests(); }, 30000);

  /* ---------- weekly lottery (games) ---------- */
  const lotCfg = () => Object.assign({ on: true, price: 20, cut: 10 }, S.config.lot || {});
  Z.lotCfg = lotCfg;
  $('#lotCard').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-tix]');
    if (!b) return;
    const n = +b.dataset.tix, cfg = lotCfg();
    if (n * cfg.price > Z.dispBal()) { Z.toast('ბალანსი არ გყოფნის.', 'loss'); return; }
    b.disabled = true;
    const r = await Z.buyTickets(n);
    b.disabled = false;
    if (r) {
      const w = Z.curWeek(), k = w + '|' + S.myId, cur = S.lotTix.get(k) || { w, user_id: S.myId, n: 0, s: 0 };
      S.lotTix.set(k, Object.assign({}, cur, { n: r.n, s: +cur.s + +r.cost }));
      const L = S.lottery.get(w) || { w, pool: 0, bonus: 0, t: 0 };
      S.lottery.set(w, Object.assign({}, L, { pool: +L.pool + +r.cost, t: +L.t + n }));
      Z.toast('ნაყიდია ' + n + ' ბილეთი', 'win'); Z.coinFly(b, $('#lotPool'), Math.min(10, 3 + n)); Z.emit();
    }
  });
  const leftTxt = (ms) => (Math.floor(ms / Z.DAY) ? Math.floor(ms / Z.DAY) + 'დ ' : '') + Z.hms(ms % Z.DAY);
  function renderLottery() {
    if (Z.view !== 'games') return;
    const card = $('#lotCard'), cfg = lotCfg();
    card.hidden = !cfg.on;
    if (!cfg.on) return;
    const w = Z.curWeek(), L = S.lottery.get(w) || { pool: 0, bonus: 0, t: 0 };
    const T = +L.t || 0;
    const mine = +((S.lotTix.get(w + '|' + S.myId) || {}).n || 0);
    const last = [...S.lottery.values()].filter((x) => x.w < w && x.at).sort((a, b) => b.w - a.w)[0];
    const prize = Math.floor((+L.pool * (100 - cfg.cut)) / 100) + +(L.bonus || 0);
    const ms = Z.weekEnd(w) - Z.now();
    const html = '<div class="tour-head"><div><p class="eyebrow">კვირის ლატარია · ბილეთი ' + Z.fmt(cfg.price) + ' კოინი</p><h3>მოსაგები ფონდი</h3></div>' +
      '<div class="tour-left"><small>გათამაშებამდე</small><b class="num" id="lotLeft">' + leftTxt(ms) + '</b></div></div>' +
      '<div class="lot-pool"><b class="num" id="lotPool">0</b><span>კოინი</span></div>' +
      '<div class="lot-me"><span>შენი ბილეთები: <b class="num">' + mine + '</b></span><span>შანსი: <b class="num">' + (T ? ((mine / T) * 100).toFixed(1) : '0') + '%</b></span><span>სულ ბილეთი: <b class="num">' + T + '</b></span></div>' +
      '<div class="chips lot-buy">' + [1, 5, 10, 25].map((n) => '<button type="button" class="chip-btn" data-tix="' + n + '"' + (mine + n > 100 ? ' disabled' : '') + '>+' + n + ' · ' + Z.fmt(n * cfg.price) + '</button>').join('') + '</div>' +
      '<p class="lot-last">' + (last && last.winner ? 'წინა გათამაშების გამარჯვებული: ' + Z.av(last.winner) + ' <b>' + Z.nm(last.winner) + '</b> · ' + Z.fmt(last.prize) + ' კოინი (ბილეთი #' + last.ticket + ' / ' + last.t + ')' : 'წინა კვირაში გამარჯვებული არ ყოფილა.') + '</p>' +
      '<p class="muted note">გამარჯვებულს სერვერი შემთხვევით ირჩევს ბილეთების რაოდენობის მიხედვით და ორშაბათს ერიცხება ფონდის ' + (100 - cfg.cut) + '%. დანარჩენი ' + cfg.cut + '% იწვება, რომ კოინები არ გაუფასურდეს. კვირაში მაქსიმუმ 100 ბილეთი.</p>';
    const key = html.replace(/id="lotLeft">[^<]*/, '');
    if (card._key === key) return;
    card._key = key;
    card.innerHTML = html;
    const pe = $('#lotPool');
    pe._v = card._pool || 0;
    Z.countTo(pe, prize);
    card._pool = prize;
  }
  setInterval(() => { const el = $('#lotLeft'); if (el) el.textContent = leftTxt(Z.weekEnd(Z.curWeek()) - Z.now()); }, 1000);

  /* ---------- tier statistics (invest) ---------- */
  function renderTierStats() {
    if (Z.view !== 'invest') return;
    const ks = [...S.cycles.keys()].sort((a, b) => a - b).slice(-14);
    const key = ks.join(',') + '|' + ks.map((c) => (S.cycles.get(c).e || []).length).join(',');
    if ($('#tsGrid')._key === key) return;
    $('#tsGrid')._key = key;
    $('#tsGrid').innerHTML = Z.TIERS.map((T) => '<div class="ts" style="--tc:' + Z.tierVar(T.k) + '"><div class="ts-h"><b><span class="tdot"></span>' + T.name + '</b><small id="tss-' + T.k + '"></small></div><div class="ts-c" id="tsc-' + T.k + '"></div></div>').join('');
    for (const T of Z.TIERS) {
      let n = 0, lost = 0, net = 0;
      const vals = ks.map((c) => {
        const xs = (S.cycles.get(c).e || []).filter((x) => x.t === T.k);
        const s = xs.reduce((a, x) => a + +x.d, 0), l = xs.filter((x) => !x.w).length;
        n += xs.length; lost += l; net += s;
        return { y: s, tip: '<b>რაუნდი #' + Z.roundNo(c) + '</b><span>' + xs.length + ' მონაწილე · ' + l + ' წააგო</span><span>წმინდა: ' + Z.sfmt(s) + '</span>' };
      });
      $('#tss-' + T.k).innerHTML = n ? 'ფაქტობრივად წააგო ' + Math.round((lost / n) * 100) + '% (წესი: ' + T.lose + '%) · ჯამი <b class="' + (net >= 0 ? 'pos' : 'neg') + '">' + Z.sfmt(net) + '</b>' : 'ჯერ მონაწილე არ ყოფილა';
      Z.barChart($('#tsc-' + T.k), n ? vals : [], { label: T.name + ': წმინდა შედეგი რაუნდების მიხედვით' });
    }
  }

  /* ---------- shop, boxes, collection ---------- */
  const SKIN_SW = { 'sk-emerald': ['#0E9F6E', '#6EE7B7'], 'sk-amethyst': ['#7C3AED', '#C4B5FD'], 'sk-rose': ['#B76E79', '#F5C6CB'], 'sk-midnight': ['#0B1026', '#7C8CFF'], 'sk-night': ['#1A0F24', '#FF7A1A'], 'sk-frost': ['#DDF3FF', '#3BA6D9'] };
  const RARITY = ['', 'ჩვეულებრივი', 'იშვიათი', 'ეპიკური', 'ლეგენდარული'];
  const CATS = [{ k: 'frame', name: 'ავატარის ჩარჩოები' }, { k: 'color', name: 'სახელის ფერები' }, { k: 'chat', name: 'ჩატის ეფექტები' }, { k: 'title', name: 'ტიტულები' }, { k: 'skin', name: 'საიტის თემები' }];
  Z.SHOP_CATS = CATS;
  Z.discount = () => Z.levelOf(S.me ? +S.me.xp : 0).i * 5;
  Z.priceOf = (it) => Math.floor((+it.price * (100 - Z.discount())) / 100);
  const myName = () => Z.realName(S.myId) || 'შენი სახელი';
  Z.itemPreview = (it) => {
    switch (it.cat) {
      case 'frame': return '<span class="av lg ' + it.id + '" style="background-color:' + Z.colorOf(S.myId || 'x') + '">' + Z.esc(myName().slice(0, 1)) + '</span>';
      case 'color': return '<span class="pn big ' + it.id + '">' + Z.esc(myName()) + '</span>';
      case 'chat': return '<span class="bub demo ' + it.id + '">გამარჯობა ყველას!</span>';
      case 'title': return '<span class="title-chip big">' + Z.esc(it.title) + '</span>';
      case 'skin': { const sw = SKIN_SW[it.id] || ['#999', '#ccc']; return '<span class="skin-sw"><i style="background:' + sw[0] + '"></i><i style="background:' + sw[1] + '"></i></span>'; }
      case 'box': return '<span class="box-ic ' + it.id + '"><svg><use href="#i-gift"/></svg></span>';
      default: return '';
    }
  };
  const owned = (id) => S.inv.filter((i) => i.item === id && !i.listed);
  async function boxReveal(box, btn) {
    const r = await Z.openBox(box);
    if (!r) return;
    const it = S.items.get(r.item) || { id: r.item, name: r.item, cat: '' };
    Z.sfx && Z.sfx(r.rarity >= 3 ? 'win' : 'coin');
    Z.openModal('<div class="box-open r' + r.rarity + '"><div class="bo-burst"></div><p class="eyebrow">' + RARITY[r.rarity] + '</p><div class="bo-prev">' + Z.itemPreview(it) + '</div><h2 id="modalTitle">' + Z.esc(Z.itemName(it.id)) + '</h2>' +
      (r.dup ? '<p class="muted">ეს ნივთი უკვე გქონდა, ამიტომ მიიღე <b>' + Z.fmt(r.refund) + '</b> კოინი.</p>' : '<p class="muted">ნივთი დაემატა შენს კოლექციას.</p>') +
      '<div class="btn-row">' + (!r.dup && it.cat ? '<button class="btn primary" id="boEq">ახლავე ჩაცმა</button>' : '') + (owned(box).length > 1 ? '<button class="btn ghost" id="boMore">კიდევ ერთის გახსნა</button>' : '') + '<button class="btn ghost" data-close>დახურვა</button></div></div>');
    if (r.rarity >= 3) Z.celebrate($('#modalBody .bo-prev'), r.rarity * 120);
    const eqb = $('#boEq'); if (eqb) eqb.addEventListener('click', async () => { await Z.equip(it.id, true); Z.closeModal(); });
    const mb = $('#boMore'); if (mb) mb.addEventListener('click', () => boxReveal(box, btn));
  }
  Z.boxReveal = boxReveal;
  $('#v-shop').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-buy], [data-eq], [data-uneq], [data-open], [data-sell]');
    if (!b) return;
    if (b.dataset.buy) {
      const it = S.items.get(b.dataset.buy);
      if (Z.priceOf(it) > Z.dispBal()) { Z.toast('ბალანსი არ გყოფნის.', 'loss'); return; }
      b.disabled = true;
      const r = await Z.buyItem(it.id);
      b.disabled = false;
      if (r) { Z.toast('ნაყიდია: ' + Z.itemName(it.id), 'win'); Z.celebrate(b.closest('.shop-item, .box-card'), 200); }
    } else if (b.dataset.open) { b.disabled = true; await boxReveal(b.dataset.open, b); b.disabled = false; }
    else if (b.dataset.eq) Z.equip(b.dataset.eq, true);
    else if (b.dataset.uneq) Z.equip(b.dataset.uneq, false);
    else if (b.dataset.sell) Z.openSell && Z.openSell(+b.dataset.sell);
  });
  function renderShop() {
    if (Z.view !== 'shop') return;
    const disc = Z.discount(), st = (S.me || {}).st || {}, hol = Z.holiday();
    setHTML($('#shopHead'), '<div class="shop-me">' + (S.myId ? Z.av(S.myId, 'lg') : '') + '<div><b class="pn-wrap">' + (S.myId ? Z.nmReal(S.myId) : 'შენ') + '</b>' + (S.myId && Z.titleOf(S.myId) ? ' <span class="title-chip">' + Z.esc(Z.titleOf(S.myId)) + '</span>' : '') +
      '<span class="bub demo ' + (S.myId ? Z.bubClass(S.myId) : '') + '">ასე გამოიყურება ჩემი შეტყობინება</span></div></div>' +
      '<div class="shop-stats"><div><small>ბალანსი</small><b class="num">' + (S.me ? Z.fmt(Z.dispBal()) : '—') + '</b></div><div><small>VIP ფასდაკლება</small><b class="num">' + disc + '%</b></div><div><small>ნაყიდი ნივთები</small><b class="num">' + Z.fmt(st.shopN || 0) + '</b></div><div><small>გახსნილი ყუთები</small><b class="num">' + Z.fmt(st.boxN || 0) + '</b></div></div>');
    const items = [...S.items.values()].sort((a, b) => a.ord - b.ord);
    // boxes
    const boxes = items.filter((it) => it.cat === 'box');
    const odds = { 'box-common': '70% · 24% · 5% · 1%', 'box-premium': '35% · 40% · 20% · 5%' };
    setHTML($('#shopBoxes'), boxes.map((it, i) => {
      const n = owned(it.id).length, price = Z.priceOf(it);
      return '<div class="box-card ' + it.id + '" style="--k:' + i + '">' + Z.itemPreview(it) + '<div><b>' + Z.esc(it.name) + '</b><small class="muted">შანსები: ' + odds[it.id] + ' (ჩვეულებრივი · იშვიათი · ეპიკური · ლეგენდარული)</small>' +
        '<small class="muted">განმეორებული ნივთი კოინებად გადაიცვლება.</small></div><div class="btn-col">' +
        '<button class="btn primary sm" data-buy="' + it.id + '">' + (disc ? '<s>' + Z.fmt(it.price) + '</s> ' : '') + Z.fmt(price) + ' კოინი</button>' +
        (n ? '<button class="btn sm" data-open="' + it.id + '">გახსნა · ' + n + '</button>' : '') + '</div></div>';
    }).join(''));
    // shop items
    setHTML($('#shopCats'), CATS.map((c, ci) => {
      const list = items.filter((it) => it.cat === c.k && it.src === 'shop' && it.price != null && (!it.ev || it.ev === hol));
      if (!list.length) return '';
      return '<section class="shop-cat r" style="--i:' + (ci + 3) + '"><h3>' + c.name + '</h3><div class="shop-grid">' +
        list.map((it, i) => {
          const own = owned(it.id).length > 0, eq = S.myId && Z.eqOf(S.myId, it.cat) === it.id, price = Z.priceOf(it);
          const left = it.supply != null ? it.supply - it.sold : null;
          return '<div class="shop-item' + (eq ? ' eq' : '') + (it.ev ? ' holiday' : '') + '" style="--k:' + i + '"><div class="si-prev">' + Z.itemPreview(it) + '</div><b>' + Z.esc(it.title ? '„' + it.title + '“' : it.name) + '</b>' +
            (left != null ? '<small class="ltd">ლიმიტირებული · დარჩა ' + left + ' / ' + it.supply + '</small>' : '') + (it.ev ? '<small class="ltd">დღესასწაულის ნივთი</small>' : '') +
            (own ? (eq ? '<button class="btn ghost sm" data-uneq="' + it.id + '">მოხსნა</button>' : '<button class="btn sm" data-eq="' + it.id + '">ჩაცმა</button>')
              : left === 0 ? '<span class="chip lost">გაიყიდა</span>' : '<button class="btn primary sm" data-buy="' + it.id + '">' + (disc ? '<s>' + Z.fmt(it.price) + '</s> ' : '') + Z.fmt(price) + ' კოინი</button>') +
            (eq ? '<span class="chip won">ჩაცმულია</span>' : '') + '</div>';
        }).join('') + '</div></section>';
    }).join(''));
    // collection
    const mine = S.inv.filter((i) => (S.items.get(i.item) || {}).cat !== 'box');
    setHTML($('#shopInv'), mine.length ? mine.map((iv, i) => {
      const it = S.items.get(iv.item) || { id: iv.item, cat: '' };
      const eq = Z.eqOf(S.myId, it.cat) === it.id;
      return '<div class="inv-item' + (eq ? ' eq' : '') + (iv.listed ? ' listed' : '') + ' rar' + (it.rarity || 0) + '" style="--k:' + i + '"><div class="si-prev">' + Z.itemPreview(it) + '</div><b>' + Z.esc(Z.itemName(it.id)) + '</b>' +
        '<small class="muted">' + (it.rarity ? RARITY[it.rarity] : 'მაღაზიიდან') + (iv.serial ? ' · #' + iv.serial : '') + '</small>' +
        (iv.listed ? '<span class="chip queued">აუქციონზეა</span>' : '<div class="btn-row">' + (eq ? '<button class="btn ghost sm" data-uneq="' + it.id + '">მოხსნა</button>' : '<button class="btn sm" data-eq="' + it.id + '">ჩაცმა</button>') +
          '<button class="btn ghost sm" data-sell="' + iv.id + '">აუქციონზე გატანა</button></div>') + '</div>';
    }).join('') : Z.empty('კოლექცია ჯერ ცარიელია. იყიდე ნივთი ან გახსენი ყუთი.'));
  }

  /* ---------- hall of fame (leaders) ---------- */
  function renderFame() {
    if (Z.view !== 'leaders') return;
    const f = (S.config.fame || []).slice().reverse();
    const sea = S.config.season || {};
    setHTML($('#fameList'), '<p class="muted note" style="margin:0 0 10px">ახლა მიმდინარეობს სეზონი #' + ((sea.id || 0) + 1) + (sea.at ? ', დაიწყო ' + Z.fdate(sea.at).split(',')[0] : '') + '.</p>' +
      (f.length ? f.map((s, i) => '<div class="fame-s" style="--k:' + i + '"><h4>სეზონი #' + (s.id + 1) + ' <small class="muted">დასრულდა ' + Z.fdate(s.at).split(',')[0] + '</small></h4><ol>' +
        (s.top || []).slice(0, 3).map((x, j) => '<li><span class="medal ' + ['r3', 'r2', 'r1'][j] + '"><span>' + (j + 1) + '</span></span>' + Z.av(x.p) + '<span class="nm">' + Z.nm(x.p) + '</span><b class="num">' + Z.fmt(x.w) + '</b></li>').join('') + '</ol></div>').join('')
        : Z.empty('ჯერ არცერთი სეზონი არ დასრულებულა.')));
  }

  /* ---------- admin tools: grant all, announcement, moderation, season, economy ---------- */
  let gaArm = 0;
  $('#gaBtn').addEventListener('click', async (e) => {
    const amt = Math.floor(+$('#gaAmt').value || 0), n = S.players.size, b = e.currentTarget;
    if (!(amt > 0)) { Z.toast('ჩაწერე თანხა.', 'loss'); return; }
    if (Date.now() - gaArm > 4000) { gaArm = Date.now(); b.textContent = 'დაადასტურე: ' + n + ' × ' + Z.fmt(amt); b.classList.add('danger'); setTimeout(() => { b.textContent = 'ყველას ერთნაირად'; b.classList.remove('danger'); }, 4000); return; }
    gaArm = 0; b.disabled = true; b.textContent = 'ირიცხება…';
    const done = await Z.grantAll(amt, 'ყველასთვის');
    b.disabled = false; b.textContent = 'ყველას ერთნაირად'; b.classList.remove('danger');
    if (done != null) { Z.toast('დაერიცხა ' + done + ' მოთამაშეს · ' + Z.fmt(amt) + ' კოინი', 'win'); Z.coinFly(b, $('#balPill'), 10); }
  });
  $('#annSet').addEventListener('click', async () => { const t = $('#annIn').value.trim(); if (!t) { Z.toast('ჩაწერე განცხადების ტექსტი.', 'loss'); return; } if (await Z.setAnn(t)) Z.toast('განცხადება გამოქვეყნდა', 'win'); });
  $('#annClear').addEventListener('click', async () => { if (await Z.setAnn(null)) { $('#annIn').value = ''; Z.toast('განცხადება მოიხსნა'); } });
  $('#muteList').addEventListener('click', async (e) => { const b = e.target.closest('[data-unmute]'); if (b && await Z.adminUser(b.dataset.unmute, 'muted', false)) Z.toast('დადუმება მოიხსნა'); });
  $('#frozenList').addEventListener('click', async (e) => { const b = e.target.closest('[data-unfreeze]'); if (b && await Z.adminUser(b.dataset.unfreeze, 'frozen', false)) Z.toast('გაყინვა მოიხსნა'); });
  $('#seaGo').addEventListener('click', () => {
    const base = Math.floor(+$('#seaBase').value || 0), reset = $('#seaReset').checked;
    $('#seaConfirmT').textContent = 'დაიწყოს სეზონი #' + (Z.seasonId() + 2) + '? ' + (reset ? 'ყველა მოთამაშის ბალანსი გახდება ' + Z.fmt(base) + ' კოინი, აქტიური ინვესტიციები, ანაბრები, აქციები და სესხები გაუქმდება.' : 'ბალანსები უცვლელი დარჩება, ტოპ-5 ჩაიწერება დიდების დარბაზში, სეზონის საშვი თავიდან დაიწყება.');
    $('#seaConfirm').hidden = false;
  });
  $('#seaNo').addEventListener('click', () => ($('#seaConfirm').hidden = true));
  $('#seaYes').addEventListener('click', async () => {
    $('#seaConfirm').hidden = true;
    if (await Z.startSeason({ base: +$('#seaBase').value || 0, reset: $('#seaReset').checked })) { Z.toast('ახალი სეზონი დაიწყო', 'win'); Z.celebrate($('#seaGo'), 400); Z.refreshMine(['pass', 'holdings', 'deposits', 'loans', 'rounds']); }
  });
  const CAT_NAMES = { admin: 'ადმინის დარიცხვა', welcome: 'მისასალმებელი', game: 'თამაშები', inv: 'ინვესტიციები', bonus: 'შესვლის კალენდარი', quest: 'დავალებები', lot: 'ლატარია', duel: 'დუელები', shop: 'მაღაზია', box: 'ყუთები',
    prize: 'ტურნირის პრიზები', tx: 'გადარიცხვები', reset: 'სეზონის განულება', bank: 'ბანკი', ins: 'დაზღვევა', auction: 'აუქციონი', pass: 'სეზონის საშვი', token: 'დღესასწაულის ჟეტონები', stock: 'აქციები',
    pred: 'პროგნოზები', clan: 'კლანები', loan: 'სესხები', ref: 'მოწვევები', poker: 'პოკერი', bingo: 'ბინგო', tax: 'ქონების გადასახადი', event: 'ივენთის ქეშბექი' };
  Z.CAT_NAMES = CAT_NAMES;
  let ecoAt = 0, eco = [], flows = {};
  async function loadEco() {
    ecoAt = Date.now();
    try {
      const [e, f] = await Promise.all([Z.sb.from('eco').select('*').order('c').limit(60), Z.api('admin_flows', { days: null }, { quiet: true })]);
      eco = (e && e.data) || []; flows = f || {};
      renderAdminTools(true);
    } catch (err) { console.warn(err); }
  }
  function renderAdminTools(force) {
    if (Z.view !== 'admin' || !S.isAdmin) return;
    if (Date.now() - ecoAt > 60000) loadEco();
    const ps = [...S.players.values()];
    const muted = ps.filter((p) => p.muted), frozen = ps.filter((p) => p.frozen);
    setHTML($('#muteList'), muted.length ? muted.map((p) => '<span class="mute-chip">' + Z.av(p.id) + Z.nm(p.id) + '<button type="button" class="link" data-unmute="' + Z.esc(p.id) + '">მოხსნა</button></span>').join('') : '<span class="muted">არავინ</span>');
    setHTML($('#frozenList'), frozen.length ? frozen.map((p) => '<span class="mute-chip">' + Z.av(p.id) + Z.nm(p.id) + '<button type="button" class="link" data-unfreeze="' + Z.esc(p.id) + '">მოხსნა</button></span>').join('') : '<span class="muted">არავინ</span>');
    const sea = S.config.season || {};
    $('#seaInfo').textContent = 'მიმდინარე: #' + ((sea.id || 0) + 1) + (sea.at ? ' · ' + Z.fdate(sea.at).split(',')[0] : '');
    if (document.activeElement !== $('#annIn') && S.config.ann && !$('#annIn').value) $('#annIn').value = S.config.ann.t;
    // economy chart: one point per round, plus "now"
    const tot = ps.reduce((a, p) => a + +p.balance + +p.locked + +p.dep + +p.lent, 0), lk = ps.reduce((a, p) => a + +p.locked + +p.dep, 0);
    const pts = eco.map((x) => ({ c: x.c, tot: +x.tot, lk: +x.lk }));
    const cn = Z.cycleOf(Z.now());
    if (!pts.length || pts[pts.length - 1].c !== cn) pts.push({ c: cn, tot, lk }); else pts[pts.length - 1] = { c: cn, tot, lk };
    const box = $('#ecoChart'), ekey = JSON.stringify(pts);
    if (box.offsetParent !== null && (box._key !== ekey || force)) {
      box._key = ekey;
      Z.lineChart(box, [
        { name: 'სულ კოინი', cls: 's1', values: pts.map((x) => ({ x: '#' + Z.roundNo(x.c), y: x.tot, label: 'რაუნდი #' + Z.roundNo(x.c) })) },
        { name: 'ინვესტიციებსა და ანაბრებში', cls: 's2', values: pts.map((x) => ({ x: '#' + Z.roundNo(x.c), y: x.lk })) },
      ], { h: 220, label: 'კოინები ბრუნვაში', area: true });
    }
    const items = Object.entries(flows).map(([k, v]) => [CAT_NAMES[k] || k, +v]).filter((x) => x[1]).sort((a, b) => b[1] - a[1]);
    const mx = Math.max(1, ...items.map((x) => Math.abs(x[1])));
    setHTML($('#ecoFlows'), '<h4>საიდან მოდის და სად მიდის კოინები (სულ)</h4>' + (items.length ? items.map(([n, v], i) => '<div class="flow" style="--k:' + i + '"><span>' + Z.esc(n) + '</span><span class="fbar"><i class="' + (v >= 0 ? 'up' : 'dn') + '" style="width:' + (Math.abs(v) / mx) * 100 + '%"></i></span><b class="num ' + (v >= 0 ? 'pos' : 'neg') + '">' + Z.sfmt(v) + '</b></div>').join('') : '<p class="muted">ჯერ არაფერი</p>') +
      '<p class="muted note">დადებითი = მოთამაშეებს დაემატა, უარყოფითი = საიტმა „დაწვა“. ყველა ოპერაცია სერვერის ჟურნალშია, ამიტომ ბალანსები ყოველთვის ემთხვევა ჯამს.</p>');
  }

  Z.extraRenders.push(() => { applySkin(); renderAnn(); renderBell(); renderQuests(); renderLottery(); renderTierStats(); renderShop(); renderFame(); renderAdminTools(); maybeGuide(); });
})();
