/* ზარაფხანა — UI helpers, effects, theme, navigation, clock, home */
(function () {
  const Z = window.Z;
  const S = Z.state;
  const $ = (Z.$ = (s, r = document) => r.querySelector(s));
  const $$ = (Z.$$ = (s, r = document) => Array.from(r.querySelectorAll(s)));
  const root = document.documentElement;
  const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const cssv = (v) => getComputedStyle(root).getPropertyValue(v).trim();

  Z.TIER_LETTER = { g: 'გ', l: 'დ', m: 'ს', h: 'მ' };
  Z.tierVar = (k) => 'var(--t-' + k + ')';

  /* ---------- small helpers ---------- */
  Z.setHTML = (el, html) => { if (!el || el._h === html) return false; el._h = html; el.innerHTML = html; return true; };
  Z.eqOf = (pid, cat) => ((S.players.get(pid) || {}).eq || {})[cat] || null;
  Z.av = (id, extra = '') => {
    const url = Z.avatarOf(id);
    const nm = Z.realName(id);
    const fr = Z.eqOf(id, 'frame');
    const pa = ' data-pid="' + Z.esc(id) + '"';
    const cls = 'av ' + extra + (fr ? ' ' + fr : '');
    if (url) return '<span class="' + cls + '"' + pa + ' style="background-image:url(&quot;' + Z.esc(url) + '&quot;)"></span>';
    const ch = (nm || '?').replace(/[^\p{L}]/gu, '').slice(0, 1) || '•';
    return '<span class="' + cls + '"' + pa + ' style="background-color:' + Z.esc(Z.colorOf(id)) + '" translate="no">' + Z.esc(ch) + '</span>';
  };
  Z.clanOf = (pid) => { const p = S.players.get(pid); return p && p.clan_id && !p.clan_pending ? S.clans.get(p.clan_id) || null : null; };
  Z.clanTag = (pid) => { const c = Z.clanOf(pid); return c ? '<span class="ctag" style="--cc:' + Z.esc(c.color) + '">' + Z.esc(c.tag) + '</span>' : ''; };
  Z.nm = (pid) => { const c = Z.eqOf(pid, 'color'); return '<span class="pn' + (c ? ' ' + c : '') + '" translate="no">' + Z.esc(Z.nameOf(pid)) + '</span>' + Z.clanTag(pid); };
  Z.nmReal = (pid) => { const c = Z.eqOf(pid, 'color'); return '<span class="pn' + (c ? ' ' + c : '') + '" translate="no">' + Z.esc(Z.realName(pid)) + '</span>' + Z.clanTag(pid); };
  Z.titleOf = (pid) => { const it = S.items.get(Z.eqOf(pid, 'title')); return it ? it.title : ''; };
  Z.bubClass = (pid) => Z.eqOf(pid, 'chat') || '';
  Z.wealthOf = (pid) => { const p = S.players.get(pid) || {}; return Z.bal(pid) + Z.locked(pid) + +(p.dep || 0) + +(p.lent || 0) + (Z.stockValue ? Z.stockValue(pid) : 0); };
  Z.ago = (t) => {
    const s = Math.max(0, (Z.now() - t) / 1000);
    if (s < 60) return 'ახლახან';
    if (s < 3600) return Math.floor(s / 60) + ' წთ წინ';
    if (s < 86400) return Math.floor(s / 3600) + ' სთ წინ';
    return Math.floor(s / 86400) + ' დღის წინ';
  };
  const MONTHS = ['იანვარი', 'თებერვალი', 'მარტი', 'აპრილი', 'მაისი', 'ივნისი', 'ივლისი', 'აგვისტო', 'სექტემბერი', 'ოქტომბერი', 'ნოემბერი', 'დეკემბერი'];
  Z.fdate = (t) => {
    const d = new Date(t + 4 * 3600e3); // Tbilisi, UTC+4 all year
    return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ', ' + String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
  };
  Z.hms = (ms) => {
    ms = Math.max(0, ms);
    const h = Math.floor(ms / 3600e3), m = Math.floor((ms % 3600e3) / 60e3), s = Math.floor((ms % 60e3) / 1000);
    return [h, m, s].map((x) => String(x).padStart(2, '0')).join(':');
  };
  Z.countTo = (el, to, signed) => {
    if (!el) return;
    to = Math.round(to || 0);
    const from = el._v == null ? to : el._v;
    el._v = to;
    const show = (v) => { el.textContent = signed ? Z.sfmt(v) : Z.fmt(v); if (signed) { el.classList.toggle('pos', v > 0); el.classList.toggle('neg', v < 0); } };
    if (from === to || reduce()) { show(to); return; }
    const t0 = performance.now(), dur = 750;
    cancelAnimationFrame(el._raf);
    const step = (now) => {
      const t = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - t, 3);
      show(from + (to - from) * e);
      if (t < 1) el._raf = requestAnimationFrame(step);
    };
    el._raf = requestAnimationFrame(step);
  };
  Z.empty = (text, btn) => '<div class="empty"><span class="ring"></span><span>' + text + '</span>' + (btn || '') + '</div>';

  /* ---------- toasts ---------- */
  Z.toast = (text, kind = '') => {
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.innerHTML = '<i></i><span></span>';
    el.lastChild.textContent = text;
    $('#toasts').appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 380); }, 3800);
  };

  /* ---------- fx canvas: coin bursts and flights ---------- */
  const fx = $('#fx'), fc = fx.getContext('2d');
  let parts = [], running = false;
  function fxSize() {
    const d = Math.min(2, devicePixelRatio || 1);
    fx.width = innerWidth * d; fx.height = innerHeight * d;
    fc.setTransform(d, 0, 0, d, 0, 0);
  }
  fxSize();
  addEventListener('resize', fxSize);
  function drawCoin(x, y, r, rot) {
    const sx = Math.max(0.12, Math.abs(Math.cos(rot)));
    fc.save(); fc.translate(x, y); fc.scale(sx, 1);
    const g = fc.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.1, 0, 0, r);
    g.addColorStop(0, '#FBE3A1'); g.addColorStop(0.55, '#E0A93F'); g.addColorStop(1, '#9A6412');
    fc.fillStyle = g; fc.beginPath(); fc.arc(0, 0, r, 0, Math.PI * 2); fc.fill();
    fc.strokeStyle = 'rgba(255,255,255,.35)'; fc.lineWidth = 1; fc.beginPath(); fc.arc(0, 0, r * 0.72, 0, Math.PI * 2); fc.stroke();
    fc.restore();
  }
  function loop() {
    fc.clearRect(0, 0, innerWidth, innerHeight);
    parts = parts.filter((p) => p.step());
    for (const p of parts) p.draw();
    if (parts.length) requestAnimationFrame(loop); else { running = false; fc.clearRect(0, 0, innerWidth, innerHeight); }
  }
  function add(list) { parts.push(...list); if (!running) { running = true; requestAnimationFrame(loop); } }
  const center = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  Z.celebrate = (el, amount = 50) => {
    bumpBal();
    Z.sfx && Z.sfx('win');
    if (reduce() || !el) return;
    const c = center(el);
    const n = Z.clamp(Math.round(amount / 8), 14, 60);
    const colors = [cssv('--t-g'), cssv('--t-l'), cssv('--t-m'), cssv('--t-h'), cssv('--gold-hi')];
    const list = [];
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4, sp = 5 + Math.random() * 8;
      const coin = i % 3 !== 0;
      const p = { x: c.x, y: c.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, rot: Math.random() * 6, vr: 0.15 + Math.random() * 0.25, life: 1, r: coin ? 6 + Math.random() * 5 : 4, coin, col: colors[i % colors.length] };
      p.step = () => { p.x += p.vx; p.y += p.vy; p.vy += 0.32; p.vx *= 0.985; p.rot += p.vr; p.life -= 0.012; return p.life > 0 && p.y < innerHeight + 30; };
      p.draw = () => {
        fc.globalAlpha = Math.min(1, p.life * 2);
        if (p.coin) drawCoin(p.x, p.y, p.r, p.rot);
        else { fc.save(); fc.translate(p.x, p.y); fc.rotate(p.rot); fc.fillStyle = p.col; fc.fillRect(-p.r, -p.r / 2.5, p.r * 2, p.r / 1.2); fc.restore(); }
        fc.globalAlpha = 1;
      };
      list.push(p);
    }
    add(list);
  };
  Z.coinFly = (fromEl, toEl, n = 8) => {
    if (!fromEl || !toEl) return;
    Z.sfx && Z.sfx('coin');
    if (reduce()) { bumpBal(); return; }
    const a = center(fromEl), b = center(toEl);
    const list = [];
    for (let i = 0; i < n; i++) {
      const delay = i * 4, dur = 46 + Math.random() * 10;
      const cx = (a.x + b.x) / 2 + (Math.random() - 0.5) * 160, cy = Math.min(a.y, b.y) - 80 - Math.random() * 80;
      const p = { t: -delay, rot: Math.random() * 6 };
      p.step = () => {
        p.t++; p.rot += 0.3;
        if (p.t === Math.round(dur) && i === n - 1) bumpBal(toEl);
        return p.t < dur;
      };
      p.draw = () => {
        if (p.t < 0) return;
        const k = p.t / dur, e = k * k * (3 - 2 * k);
        const x = (1 - e) * (1 - e) * a.x + 2 * (1 - e) * e * cx + e * e * b.x;
        const y = (1 - e) * (1 - e) * a.y + 2 * (1 - e) * e * cy + e * e * b.y;
        drawCoin(x, y, 7, p.rot);
      };
      list.push(p);
    }
    add(list);
  };
  function bumpBal(el) {
    const pill = el && el.classList && el.classList.contains('bal-pill') ? el : $('#balPill');
    pill.classList.remove('bump'); void pill.offsetWidth; pill.classList.add('bump');
  }

  /* ---------- ripple ---------- */
  document.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('.btn');
    if (!b || b.disabled || reduce()) return;
    const r = b.getBoundingClientRect(), s = Math.max(r.width, r.height);
    const sp = document.createElement('span');
    sp.className = 'ripple';
    sp.style.cssText = 'width:' + s + 'px;height:' + s + 'px;left:' + (e.clientX - r.left - s / 2) + 'px;top:' + (e.clientY - r.top - s / 2) + 'px';
    b.appendChild(sp);
    setTimeout(() => sp.remove(), 650);
  });

  /* ---------- theme ---------- */
  const themeFns = new Set();
  Z.onTheme = (fn) => themeFns.add(fn);
  Z.isDark = () => (root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches);
  const savedTheme = Z.store.get('zar-theme', null);
  if (savedTheme === 'dark' || savedTheme === 'light') root.dataset.theme = savedTheme;
  const fireTheme = () => setTimeout(() => themeFns.forEach((f) => { try { f(); } catch (e) {} }), 30);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', fireTheme);
  new MutationObserver(fireTheme).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  $('#themeBtn').addEventListener('click', (e) => {
    const next = Z.isDark() ? 'light' : 'dark';
    const apply = () => { root.dataset.theme = next; Z.store.set('zar-theme', next); const b = $('#themeBtn'); b.innerHTML = b.innerHTML; };
    if (!document.startViewTransition || reduce()) { apply(); return; }
    const x = e.clientX || innerWidth - 40, y = e.clientY || 30;
    const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    const t = document.startViewTransition(apply);
    t.ready.then(() => {
      root.animate({ clipPath: ['circle(0px at ' + x + 'px ' + y + 'px)', 'circle(' + r + 'px at ' + x + 'px ' + y + 'px)'] },
        { duration: 650, easing: 'cubic-bezier(.2,.8,.2,1)', pseudoElement: '::view-transition-new(root)' });
    }).catch(() => {});
  });

  /* ---------- navigation ---------- */
  const VIEWS = ['home', 'invest', 'games', 'market', 'leaders', 'shop', 'me', 'admin'];
  Z.VIEWS = VIEWS;
  Z.view = 'home';
  Z.renderers = {};
  function moveInk() {
    const t = $('.tab.on'), ink = $('#tabInk');
    if (!t || !ink) return;
    ink.style.left = t.offsetLeft + 'px';
    ink.style.width = t.offsetWidth + 'px';
  }
  Z.go = (v, opts = {}) => {
    if (!VIEWS.includes(v)) v = 'home';
    if (v === 'admin' && !S.isAdmin && S.ready) v = 'home';
    Z.view = v;
    for (const id of VIEWS) { const el = $('#v-' + id); el.hidden = id !== v; }
    $$('[data-go]').forEach((b) => b.classList.toggle('on', b.dataset.go === v && (b.classList.contains('tab') || b.parentElement.id === 'bottomNav' || b.parentElement.id === 'moreSheet')));
    $('#moreBtn').classList.toggle('on', ['leaders', 'shop', 'me', 'admin'].includes(v));
    closeMore();
    moveInk();
    // never wipe a sign-in redirect (tokens arrive in the hash) before Supabase has read it
    if (!/access_token|refresh_token|error_description|type=/.test(location.hash)) { try { history.replaceState(null, '', '#' + v); } catch (e) {} }
    if (!opts.keepScroll) scrollTo({ top: 0, behavior: reduce() ? 'auto' : 'smooth' });
    Z.render();
  };
  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-go]');
    if (!g) return;
    e.preventDefault();
    Z.go(g.dataset.go);
  });
  // phones: a "more" sheet holds the less frequent sections
  const more = $('#moreSheet'), moreBtn = $('#moreBtn');
  function closeMore() { more.hidden = true; moreBtn.setAttribute('aria-expanded', 'false'); }
  moreBtn.addEventListener('click', (e) => { e.stopPropagation(); const open = more.hidden; more.hidden = !open; moreBtn.setAttribute('aria-expanded', String(open)); });
  document.addEventListener('click', (e) => { if (!more.hidden && !e.target.closest('#moreSheet, #moreBtn')) closeMore(); });
  addEventListener('resize', moveInk);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(moveInk);

  /* ---------- the minted round clock ---------- */
  const TICKS = 120;
  const reed = $('#reed');
  (function buildReed() {
    const ns = 'http://www.w3.org/2000/svg';
    let html = '<circle class="rim" cx="160" cy="160" r="126"/><circle class="sweep" cx="160" cy="160" r="156"/>';
    for (let i = 0; i < TICKS; i++) {
      const a = (i / TICKS) * Math.PI * 2 - Math.PI / 2;
      const r1 = 134, r2 = i % 10 === 0 ? 152 : 146;
      html += '<line class="tk" x1="' + (160 + Math.cos(a) * r1).toFixed(2) + '" y1="' + (160 + Math.sin(a) * r1).toFixed(2) + '" x2="' + (160 + Math.cos(a) * r2).toFixed(2) + '" y2="' + (160 + Math.sin(a) * r2).toFixed(2) + '"/>';
    }
    reed.innerHTML = html;
    void ns;
  })();
  const tks = $$('.tk', reed);
  let litPrev = -1, lastCycle = null;
  function clock() {
    const now = Z.now(), cur = Z.cycleOf(now), end = Z.cycleEnd(cur);
    const frac = (now - Z.cycleStart(cur)) / Z.DAY;
    const lit = Math.floor(frac * TICKS);
    if (lit !== litPrev) {
      tks.forEach((t, i) => { t.classList.toggle('on', i < lit); t.classList.toggle('head', i === lit); });
      litPrev = lit;
    }
    $('#countdown').textContent = Z.hms(end - now);
    $('#roundNo').textContent = Z.roundNo(cur);
    const open = now < end - Z.closeMs();
    const chip = $('#roundState');
    chip.className = 'chip ' + (open ? 'open' : 'closed');
    chip.textContent = open ? 'მიღება ღიაა' : 'მიღება დახურულია';
    $$('.rnd').forEach((e) => (e.textContent = Z.roundNo(cur)));
    $$('.enroll-note').forEach((e) => (e.textContent = open ? 'მიღება ღიაა ' + Z.hms(end - Z.closeMs() - now) : 'ახალი ჩადებები გადადის რაუნდ #' + Z.roundNo(cur + 1) + '-ში'));
    $$('.closeMin').forEach((e) => (e.textContent = S.config.closeMin ?? 60));
    // bonus countdown
    const bb = $('#bonusBtn');
    if (!bb.hidden && bb.classList.contains('used')) $('#bonusTxt').textContent = 'შემდეგი ბონუსი ' + Z.hms(end - now) + '-ში';
    const cs = $('#calSub'); if (cs && cs.dataset.wait) cs.textContent = 'შემდეგი დღე ' + Z.hms(end - now) + '-ში';
    if (lastCycle != null && cur !== lastCycle) { Z.cycleTurned(); Z.render(); }
    lastCycle = cur;
  }
  clock();
  setInterval(clock, 1000);

  /* ---------- gold dust behind the clock ---------- */
  (function dust() {
    const cv = $('#dust'), cx = cv.getContext('2d');
    let W = 0, H = 0, ps = [];
    function size() {
      const r = cv.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1);
      W = r.width; H = r.height; cv.width = W * d; cv.height = H * d; cx.setTransform(d, 0, 0, d, 0, 0);
      ps = Array.from({ length: 30 }, () => ({ x: Math.random() * W, y: Math.random() * H, r: 0.6 + Math.random() * 1.8, vy: 0.08 + Math.random() * 0.25, ph: Math.random() * 6 }));
    }
    new ResizeObserver(size).observe(cv);
    function frame(t) {
      if (Z.view === 'home' && document.visibilityState === 'visible' && !reduce() && W) {
        cx.clearRect(0, 0, W, H);
        const col = cssv('--gold');
        for (const p of ps) {
          p.y -= p.vy; if (p.y < -4) { p.y = H + 4; p.x = Math.random() * W; }
          cx.globalAlpha = 0.25 + 0.45 * (0.5 + 0.5 * Math.sin(t / 700 + p.ph));
          cx.fillStyle = col; cx.beginPath(); cx.arc(p.x + Math.sin(t / 1500 + p.ph) * 6, p.y, p.r, 0, Math.PI * 2); cx.fill();
        }
        cx.globalAlpha = 1;
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  })();

  /* ---------- top bar ---------- */
  function renderTop() {
    const tb = $('#topBal');
    if (!S.ready) tb.textContent = '—';
    else Z.countTo(tb, Z.dispBal());
    $$('.admin-only').forEach((e) => (e.hidden = !S.isAdmin));
    const av = $('#meAvatar');
    if (S.myId) {
      const url = Z.avatarOf(S.myId);
      if (url) { av.style.backgroundImage = 'url("' + url + '")'; av.textContent = ''; }
      else { av.style.backgroundImage = ''; av.style.backgroundColor = Z.colorOf(S.myId); av.textContent = (Z.realName(S.myId) || 'შ').slice(0, 1); }
    }
    const bn = $('#banner'), me = S.players.get(S.myId);
    if (me && me.frozen) { bn.hidden = false; bn.innerHTML = '<span><b>ანგარიში გაყინულია.</b> შეგიძლია ნახო ყველაფერი, მაგრამ ქმედებები დროებით შეზღუდულია. დაუკავშირდი ადმინს.</span>'; }
    else bn.hidden = true;
  }

  /* ---------- home ---------- */
  function lastRoundWithEntries() {
    const keys = [...S.cycles.keys()].sort((a, b) => b - a);
    for (const k of keys) if ((S.cycles.get(k).e || []).length) return S.cycles.get(k);
    return keys.length ? S.cycles.get(keys[0]) : null;
  }
  Z.aggregate = (res) => {
    const m = new Map();
    for (const x of res.e || []) {
      const a = m.get(x.p) || { p: x.p, d: 0, s: 0, tiers: new Set(), w: 0, l: 0 };
      a.d += +x.d; a.s += +x.s; a.tiers.add(x.t); x.w ? a.w++ : a.l++;
      m.set(x.p, a);
    }
    return [...m.values()];
  };
  Z.tierDots = (set) => [...set].map((k) => '<span class="tdot" style="--tc:' + Z.tierVar(k) + '" title="' + Z.esc(Z.tier(k).name) + '"></span>').join('');
  Z.miniRank = (list, kind) =>
    '<ol class="mini-rank">' + (list.length ? list.map((a, i) => '<li style="--k:' + i + '">' + Z.av(a.p) + '<span class="nm">' + Z.nm(a.p) + '</span>' + Z.tierDots(a.tiers) + '<span class="v ' + (a.d >= 0 ? 'pos' : 'neg') + '">' + Z.sfmt(a.d) + '</span></li>').join('')
      : '<li class="muted" style="font-size:.85rem">' + (kind === 'w' ? 'მოგებული არ არის' : 'წაგებული არ არის') + '</li>') + '</ol>';
  function invRowsCompact(invs) {
    return '<div class="inv-list">' + invs.map((v, i) => {
      const st = Z.invStatus(v);
      return '<div class="inv-row" style="--tc:' + Z.tierVar(v.t) + ';--k:' + i + '"><span class="ti">' + Z.TIER_LETTER[v.t] + '</span>' +
        '<div class="mid"><b>' + Z.fmt(v.ls) + '</b> <small>' + Z.esc(Z.tier(v.t).name) + ' · ' + (v.sa == null ? 'ავტო-გაგრძელება' : 'ერთი რაუნდი') + (v.ins ? ' · დაზღვეული' : '') + '</small></div>' +
        '<span class="chip ' + (st === 'queued' ? 'queued' : 'open') + '">' + (st === 'queued' ? 'რაუნდი #' + Z.roundNo(v.cur) : 'მიმდინარე') + '</span></div>';
    }).join('') + '</div>';
  }
  Z.invRowsCompact = invRowsCompact;

  Z.renderers.home = () => {
    const me = S.me, myId = S.myId;
    const nm = Z.realName(myId);
    $('#greet').innerHTML = (me ? 'გამარჯობა, <span translate="no">' + Z.esc(nm.split(' ')[0]) + '</span>' : 'გამარჯობა') + ' <span class="greet-sub">· ხელმისაწვდომი ბალანსი</span>';
    const loading = !S.ready || !me;
    if (loading) { $('#heroBal').textContent = '—'; }
    else {
      Z.countTo($('#heroBal'), Z.dispBal());
      Z.countTo($('#lockedBal'), Z.locked(myId));
      Z.countTo($('#totalBal'), Z.wealthOf(myId) - Z.balHold);
      Z.countTo($('#invNet'), +(me.st || {}).inv || 0, true);
      Z.countTo($('#gameNet'), +(me.st || {}).game || 0, true);
    }
    const bb = $('#bonusBtn'), cur = Z.cycleOf(Z.now()), base = S.config.bonus || 0;
    bb.hidden = loading || !base;
    if (!loading && base) {
      const used = me.bonusC === cur;
      bb.classList.toggle('used', used);
      bb.disabled = used;
      if (!used) $('#bonusTxt').textContent = 'დღიური ბონუსი';
    }
    // last round
    const lr = $('#lastRound');
    if (loading) lr.innerHTML = '<div class="skeleton" style="height:9rem"></div>';
    else {
      const res = lastRoundWithEntries();
      if (!res) Z.setHTML(lr, Z.empty('ჯერ არცერთი რაუნდი არ დასრულებულა. პირველი შედეგები გამოცხადდება 00:00-ზე.'));
      else {
        const ag = Z.aggregate(res);
        const win = ag.filter((a) => a.d > 0).sort((a, b) => b.d - a.d).slice(0, 3);
        const lose = ag.filter((a) => a.d < 0).sort((a, b) => a.d - b.d).slice(0, 3);
        const e = res.e || [], nl = e.filter((x) => !x.w).length;
        Z.setHTML(lr, '<div class="lr-head"><b>რაუნდი #' + Z.roundNo(res.c) + '</b><span class="time">' + Z.fdate(Z.cycleEnd(res.c)) + ' · ' + e.length + ' ინვესტიცია · ' + nl + ' წაგებული</span></div>' +
          (e.length ? '<div class="lr-cols"><div><h4>ტოპ მოგებულები</h4>' + Z.miniRank(win, 'w') + '</div><div><h4>ტოპ წაგებულები</h4>' + Z.miniRank(lose, 'l') + '</div></div>'
            : Z.empty('ამ რაუნდში მონაწილე არ ყოფილა.')));
      }
    }
    // my investments
    const hi = $('#homeInvs');
    if (loading) hi.innerHTML = '<div class="skeleton" style="height:9rem"></div>';
    else {
      const act = (me.invs || []).filter((v) => v.end == null);
      Z.setHTML(hi, act.length ? invRowsCompact(act.slice(0, 5)) : Z.empty('აქტიური ინვესტიცია არ გაქვს.', '<button class="btn primary" data-go="invest">პირველი ინვესტიცია</button>'));
    }
    // live feed
    const top = S.feed.slice(0, 9);
    Z.setHTML($('#feed'), loading ? '<div class="skeleton" style="height:12rem"></div>' : top.length
      ? top.map((f, i) => '<li style="--k:' + i + '">' + Z.av(f.user_id) + '<span class="who"><b>' + Z.nm(f.user_id) + '</b><small>' + Z.esc(Z.feedText(f)) + ' · ' + Z.ago(+f.at) + '</small></span><span class="amt ' + (+f.d > 0 ? 'pos' : +f.d < 0 ? 'neg' : '') + '">' + (+f.d ? Z.sfmt(+f.d) : '★') + '</span></li>').join('')
      : Z.empty('აქ გამოჩნდება მოთამაშეების დიდი მოგებები და ამბები.'));
    // my history
    const mine = loading ? [] : me.hist;
    Z.setHTML($('#myHist'), loading ? '<div class="skeleton" style="height:12rem"></div>' : mine.length
      ? mine.slice(0, 9).map((h, i) => '<li style="--k:' + i + '"><span class="av" style="background:' + (h.d >= 0 ? 'var(--win)' : 'var(--loss)') + '">' + (h.d >= 0 ? '+' : '−') + '</span><span class="who"><b>' + Z.esc(Z.histText(h)) + '</b><small>' + Z.ago(h.at) + '</small></span><span class="amt ' + (h.d > 0 ? 'pos' : h.d < 0 ? 'neg' : '') + '">' + Z.sfmt(h.d) + '</span></li>').join('')
      : Z.empty('ჯერ არაფერი მომხდარა.'));
  };

  $('#bonusBtn').addEventListener('click', async () => {
    const r = await Z.claimDaily();
    if (r && r.amt) {
      Z.toast('შესვლის კალენდარი, დღე ' + r.s + ': +' + Z.fmt(r.amt) + ' კოინი' + (r.box ? ' და საჩუქრად ყუთი!' : ''), 'win');
      Z.coinFly($('#bonusBtn'), $('#balPill'), 10);
    }
  });

  /* ---------- render loop ---------- */
  Z.render = () => {
    renderTop();
    const r = Z.renderers[Z.view];
    if (r) r();
    for (const f of Z.extraRenders || []) { try { f(); } catch (e) { console.error(e); } }
  };
  Z.on(Z.render);
})();
