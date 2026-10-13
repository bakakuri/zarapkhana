/* ზარაფხანა — games played on the server: coin flip, wheel, rocket, mines (house edge ≈ 3%) */
(function () {
  const Z = window.Z;
  const S = Z.state;
  const $ = (s, r = document) => r.querySelector(s);
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

  const ICONS = {
    flip: '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="12" rx="8.5" ry="8.5" fill="none" stroke="currentColor" stroke-width="1.8"/><ellipse cx="12" cy="12" rx="3.2" ry="8.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3.5 12h17" stroke="currentColor" stroke-width="1.2" opacity=".5"/></svg>',
    wheel: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12.5" r="8.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 4v17M3.5 12.5h17M6 6.5l12 12M18 6.5l-12 12" stroke="currentColor" stroke-width="1.2" opacity=".6"/><circle cx="12" cy="12.5" r="2.2" fill="currentColor"/><path d="M12 1.5l-2 3h4z" fill="currentColor"/></svg>',
    crash: '<svg viewBox="0 0 24 24"><path d="M3 20c6 0 11-3 15-13" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><circle cx="18.5" cy="6" r="2.6" fill="currentColor"/><path d="M3 21h18M3 3v18" stroke="currentColor" stroke-width="1.2" opacity=".45"/></svg>',
    mines: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7.5" height="7.5" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2" fill="currentColor" opacity=".35"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2" fill="currentColor" opacity=".35"/><circle cx="17.25" cy="17.25" r="3.2" fill="currentColor"/><path d="M17.25 12.5v1.5M22 17.25h-1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  };

  /* ---------- shared bet control and server calls ---------- */
  const betKey = (g) => 'zar-bet-' + g;
  function betField(g, label) {
    const v = Z.store.get(betKey(g), 50);
    return '<div class="field"><label class="field-lbl" for="bet-' + g + '">' + (label || 'ფსონი') + '</label>' +
      '<div class="bet-row"><input type="number" id="bet-' + g + '" min="1" step="1" inputmode="numeric" value="' + v + '">' +
      '<button type="button" data-b="half">½</button><button type="button" data-b="dbl">×2</button><button type="button" data-b="max">მაქს</button></div></div>';
  }
  function wireBet(root, g) {
    const inp = $('#bet-' + g, root);
    root.querySelectorAll('[data-b]').forEach((b) => b.addEventListener('click', () => {
      let v = Math.floor(+inp.value || 0);
      const max = Math.max(0, Math.floor(Z.dispBal()));
      if (b.dataset.b === 'half') v = Math.max(1, Math.floor(v / 2));
      if (b.dataset.b === 'dbl') v = Math.min(max || v * 2, v * 2);
      if (b.dataset.b === 'max') v = max;
      inp.value = v;
      Z.store.set(betKey(g), v);
    }));
    inp.addEventListener('change', () => Z.store.set(betKey(g), Math.floor(+inp.value || 0)));
    return () => Math.floor(+inp.value || 0);
  }
  function check(bet) {
    if (!S.me) { Z.toast('მონაცემები ჯერ იტვირთება.', 'loss'); return false; }
    if (!(bet > 0)) { Z.toast('ჩაწერე ფსონის თანხა.', 'loss'); return false; }
    if (bet > Z.dispBal()) { Z.toast('ბალანსი არ გყოფნის. ხელმისაწვდომია ' + Z.fmt(Z.dispBal()) + ' კოინი.', 'loss'); return false; }
    return true;
  }
  // every game move goes to the server; errors show as a toast and return null
  async function play(fn, args) {
    try { const r = await Z.api(fn, args, { lazy: true, also: ['quests'] }); if (r && r.id) { Z.lastGame = { id: r.id, g: fn }; Z.lastGames = Z.lastGames || {}; Z.lastGames[fn.replace(/^game_/, '').replace(/_(start|pick|cash|act|poll)$/, '')] = r.id; } return r; }
    catch (e) { Z.toast(Z.errText(e), 'loss'); return null; }
  }
  const hold = (amt) => { if (amt > 0) { Z.balHold += amt; Z.emit(); } };
  const release = (amt) => { if (amt > 0) { Z.balHold = Math.max(0, Z.balHold - amt); Z.emit(); } };
  function msg(el, text, kind) {
    if (kind === 'loss') Z.sfx && Z.sfx('lose');
    el.textContent = text;
    el.className = 'g-msg' + (kind ? ' ' + kind : '');
    void el.offsetWidth;
  }
  const head = (title, text) => '<div class="g-head"><h2>' + title + '</h2><p>' + text + '</p></div>';
  const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fairLink = () => '<button type="button" class="link fair-link" data-fair-last>შედეგის შემოწმება</button>';
  async function resume(g) { try { return await Z.api('game_resume', { g }, { quiet: true }); } catch (e) { return null; } }

  /* ---------- 1. coin flip ---------- */
  function mountFlip(root) {
    const MULT = 1.94;
    root.innerHTML = head('ქოინის აგდება', 'აირჩიე მხარე: ზ თუ ბორჯღალი. გამოიცნობ და ფსონი ×' + MULT + '-ით ბრუნდება.') +
      '<div class="g-layout"><div class="g-ctrl">' + betField('flip') +
      '<div class="field"><span class="field-lbl">მხარე</span><div class="pick-side" id="flPick">' +
      '<button type="button" data-s="z" class="on"><span class="ps">ზ</span>ზ</button>' +
      '<button type="button" data-s="b"><span class="ps"><svg><use href="#i-borj"/></svg></span>ბორჯღალი</button></div></div>' +
      '<button class="btn primary wide" id="flGo">აგდება</button>' +
      '<p class="muted" style="margin:0;font-size:.8rem">მოგება: ფსონი × ' + MULT + '</p>' + fairLink() + '</div>' +
      '<div class="g-board"><div class="flip-wrap"><div class="flip-stage"><div class="flip-coin" id="flCoin">' +
      '<div class="side heads">ზ</div><div class="side tails"><svg><use href="#i-borj"/></svg></div></div></div>' +
      '<div class="flip-shadow" id="flShadow"></div><div class="g-msg" id="flMsg">აირჩიე მხარე და ააგდე</div><div class="streak" id="flStreak"></div></div></div></div>';
    const getBet = wireBet(root, 'flip');
    let side = 'z', rot = 0, busy = false;
    const streak = [];
    root.querySelectorAll('#flPick button').forEach((b) => b.addEventListener('click', () => {
      side = b.dataset.s;
      root.querySelectorAll('#flPick button').forEach((x) => x.classList.toggle('on', x === b));
    }));
    const coin = $('#flCoin', root), m = $('#flMsg', root), go = $('#flGo', root), sh = $('#flShadow', root);
    go.addEventListener('click', async () => {
      if (busy) return;
      const bet = getBet();
      if (!check(bet)) return;
      busy = true; go.disabled = true;
      msg(m, 'ტრიალებს…');
      Z.sfx && Z.sfx('roll');
      const spin = coin.animate([{ transform: 'rotateY(' + rot + 'deg)' }, { transform: 'rotateY(' + (rot + 720) + 'deg)' }], { duration: 500, iterations: Infinity });
      const r = await play('game_flip', { bet, side });
      spin.cancel();
      if (!r) { msg(m, 'ვერ შესრულდა'); busy = false; go.disabled = false; return; }
      hold(r.pay);
      const from = rot, base = from - (from % 360) + 360 * 6;
      rot = base + (r.r === 'z' ? 0 : 180);
      const dur = reduce() ? 10 : 1500;
      coin.animate([
        { transform: 'translateY(0) rotateY(' + from + 'deg) scale(1)' },
        { transform: 'translateY(-90px) rotateY(' + (from + (rot - from) * 0.55) + 'deg) scale(1.15)', offset: 0.45 },
        { transform: 'translateY(0) rotateY(' + rot + 'deg) scale(1)' },
      ], { duration: dur, easing: 'cubic-bezier(.3,.7,.25,1)', fill: 'forwards' });
      sh.animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(.55)', opacity: .4, offset: .45 }, { transform: 'scale(1)', opacity: 1 }], { duration: dur, easing: 'ease-in-out' });
      setTimeout(() => {
        release(r.pay);
        const win = r.pay > 0;
        msg(m, win ? 'მოიგე! +' + Z.fmt(r.pay - r.bet) + ' კოინი' : 'წააგე ' + Z.fmt(r.bet) + ' კოინი', win ? 'win' : 'loss');
        if (win) Z.celebrate(coin, r.pay - r.bet);
        streak.unshift(win); if (streak.length > 12) streak.pop();
        $('#flStreak', root).innerHTML = streak.map((w) => '<i class="' + (w ? 'w">✓' : 'l">✕') + '</i>').join('');
        busy = false; go.disabled = false;
      }, dur + 40);
    });
  }

  /* ---------- 2. wheel ---------- */
  function mountWheel(root) {
    const SEG = [0, 1.5, 0.5, 2, 0, 1.2, 0.3, 3, 0, 1.2];
    root.innerHTML = head('ბედის ბორბალი', 'დაატრიალე ბორბალი. ისარი რომელ სექტორზეც გაჩერდება, ფსონი იმდენზე მრავლდება.') +
      '<div class="g-layout"><div class="g-ctrl">' + betField('wheel') +
      '<button class="btn primary wide" id="whGo">დატრიალება</button>' +
      '<div class="field"><span class="field-lbl">სექტორები</span><div class="mult-legend">' + SEG.map((s) => '<span>×' + s + '</span>').join('') + '</div></div>' + fairLink() + '</div>' +
      '<div class="g-board"><div style="display:grid;gap:16px;justify-items:center;width:100%"><div class="wheel-wrap"><svg class="wheel-pin" id="whPin" viewBox="0 0 28 36"><path d="M14 35 2 8a12 12 0 1 1 24 0Z" fill="var(--loss)"/><circle cx="14" cy="10" r="4" fill="var(--surface)"/></svg>' +
      '<canvas id="whCv" width="660" height="660"></canvas><div class="wheel-hub" id="whHub">×?</div></div><div class="g-msg" id="whMsg">ფსონი აირჩიე და დაატრიალე</div></div></div></div>';
    const getBet = wireBet(root, 'wheel');
    const cv = $('#whCv', root), ctx = cv.getContext('2d'), pin = $('#whPin', root), hub = $('#whHub', root), m = $('#whMsg', root), go = $('#whGo', root);
    const n = SEG.length, segDeg = 360 / n;
    let rot = 0, busy = false;
    const colorFor = (v) => (v === 0 ? css('--surface-3') : v < 1 ? css('--line-2') : v < 1.6 ? css('--t-l') : v < 2.5 ? css('--t-g') : css('--gold-mid'));
    function draw() {
      const W = cv.width, c = W / 2, R = c - 4;
      ctx.clearRect(0, 0, W, W);
      for (let i = 0; i < n; i++) {
        const a0 = -Math.PI / 2 + (i * 2 * Math.PI) / n, a1 = a0 + (2 * Math.PI) / n;
        ctx.beginPath(); ctx.moveTo(c, c); ctx.arc(c, c, R, a0, a1); ctx.closePath();
        ctx.fillStyle = colorFor(SEG[i]); ctx.fill();
        ctx.strokeStyle = css('--surface'); ctx.lineWidth = 4; ctx.stroke();
        ctx.save(); ctx.translate(c, c); ctx.rotate((a0 + a1) / 2);
        ctx.fillStyle = SEG[i] >= 1.2 ? (Z.isDark && Z.isDark() ? '#0E1015' : '#fff') : css('--ink');
        ctx.font = '700 34px Unbounded, system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        ctx.fillText('×' + SEG[i], R - 26, 0);
        ctx.restore();
      }
      ctx.beginPath(); ctx.arc(c, c, R, 0, Math.PI * 2); ctx.strokeStyle = css('--line-2'); ctx.lineWidth = 3; ctx.stroke();
    }
    draw();
    Z.onTheme && Z.onTheme(draw);
    let lastSeg = -1;
    go.addEventListener('click', async () => {
      if (busy) return;
      const bet = getBet();
      if (!check(bet)) return;
      busy = true; go.disabled = true; msg(m, 'ტრიალებს…'); hub.textContent = '×?';
      const r = await play('game_wheel', { bet });
      if (!r) { busy = false; go.disabled = false; msg(m, 'ვერ შესრულდა'); return; }
      hold(r.pay);
      const idx = r.idx;
      const jitter = (Z.rand() - 0.5) * segDeg * 0.7;
      const targetMod = (((360 - (idx + 0.5) * segDeg + jitter) % 360) + 360) % 360;
      const from = rot, to = from - (from % 360) + 360 * 6 + targetMod;
      const dur = reduce() ? 10 : 4800, t0 = performance.now();
      const ease = (t) => 1 - Math.pow(1 - t, 4);
      function frame(now) {
        const t = Math.min(1, (now - t0) / dur);
        rot = from + (to - from) * ease(t);
        cv.style.transform = 'rotate(' + rot + 'deg)';
        const under = Math.floor((((360 - (rot % 360)) % 360) / segDeg)) % n;
        if (under !== lastSeg) { lastSeg = under; hub.textContent = '×' + SEG[under]; pin.classList.remove('tick'); void pin.offsetWidth; pin.classList.add('tick'); Z.sfx && Z.sfx('tick'); }
        if (t < 1) requestAnimationFrame(frame);
        else {
          release(r.pay);
          const mult = SEG[idx], net = r.pay - r.bet;
          hub.textContent = '×' + mult;
          msg(m, net > 0 ? '×' + mult + ' — მოიგე +' + Z.fmt(net) : net === 0 ? '×' + mult + ' — ფსონი დაგიბრუნდა' : '×' + mult + ' — ' + Z.fmt(net) + ' კოინი', net > 0 ? 'win' : net < 0 ? 'loss' : '');
          if (net > 0) Z.celebrate(hub, net);
          busy = false; go.disabled = false;
        }
      }
      requestAnimationFrame(frame);
    });
  }

  /* ---------- 3. rocket (crash point fixed on the server at take-off) ---------- */
  function mountCrash(root) {
    const K = 0.11;
    root.innerHTML = head('რაკეტა', 'მამრავლი იზრდება, სანამ რაკეტა არ აფეთქდება. აიღე მოგება აფეთქებამდე. ავტო-აღებას სერვერი თავად ასრულებს, გვერდი რომც დახურო.') +
      '<div class="g-layout"><div class="g-ctrl">' + betField('crash') +
      '<div class="field"><label class="field-lbl" for="crAuto">ავტო-აღება (მაგ. 2.00, ცარიელი = გამორთული)</label><input type="number" id="crAuto" min="1.01" step="0.01" inputmode="decimal" placeholder="2.00"></div>' +
      '<button class="btn primary wide" id="crGo">გაშვება</button>' +
      '<div class="field"><span class="field-lbl">ბოლო აფეთქებები</span><div class="crash-hist" id="crHist"><span class="muted" style="font-size:.8rem">ჯერ არ ყოფილა</span></div></div>' + fairLink() + '</div>' +
      '<div class="g-board crash-board"><canvas id="crCv"></canvas><div class="crash-mult" id="crMult">×1.00</div>' +
      '<div class="g-msg" id="crMsg" style="position:absolute;bottom:14px;left:0;right:0">მზად არის გასაშვებად</div></div></div>';
    const getBet = wireBet(root, 'crash');
    const cv = $('#crCv', root), ctx = cv.getContext('2d'), mEl = $('#crMult', root), go = $('#crGo', root), m = $('#crMsg', root), autoIn = $('#crAuto', root);
    autoIn.value = Z.store.get('zar-crash-auto', '');
    autoIn.addEventListener('change', () => Z.store.set('zar-crash-auto', autoIn.value));
    let st = 'idle', t0 = 0, gid = null, bet = 0, cashed = 0, sparks = [], polling = false, lastPoll = 0, cp = null;
    const hist = [];
    function size() {
      const r = cv.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1);
      cv.width = Math.max(10, r.width * d); cv.height = Math.max(10, r.height * d);
      ctx.setTransform(d, 0, 0, d, 0, 0);
      paint(st === 'fly' ? (Z.now() - t0) / 1000 : 0);
    }
    new ResizeObserver(size).observe(cv);
    function paint(t, boom) {
      const W = cv.clientWidth, H = cv.clientHeight;
      ctx.clearRect(0, 0, W, H);
      const mm = Math.exp(K * t);
      const xMax = Math.max(8, t * 1.18), yMax = Math.max(2, mm * 1.25);
      const pad = { l: 44, r: 18, t: 18, b: 30 };
      const X = (s) => pad.l + (s / xMax) * (W - pad.l - pad.r);
      const Y = (v) => H - pad.b - ((v - 1) / (yMax - 1)) * (H - pad.t - pad.b);
      ctx.font = '600 11px "IBM Plex Mono", monospace'; ctx.fillStyle = css('--ink-3'); ctx.strokeStyle = css('--line'); ctx.lineWidth = 1;
      [1, 1.5, 2, 3, 5, 10, 20, 50, 100].filter((v) => v <= yMax).forEach((v) => { const y = Y(v); ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke(); ctx.fillText('×' + v, 6, y + 4); });
      for (let s = 0; s <= xMax; s += xMax > 30 ? 10 : 2) { const x = X(s); ctx.fillText(s + 'წ', x - 6, H - 10); }
      if (t <= 0) return;
      const col = boom ? css('--loss') : css('--gold');
      const g = ctx.createLinearGradient(0, Y(mm), 0, H - pad.b);
      g.addColorStop(0, boom ? 'rgba(220,60,60,.28)' : 'rgba(233,180,76,.32)'); g.addColorStop(1, 'rgba(233,180,76,0)');
      const N = 80;
      ctx.beginPath(); ctx.moveTo(X(0), Y(1));
      for (let i = 1; i <= N; i++) { const s = (t * i) / N; ctx.lineTo(X(s), Y(Math.exp(K * s))); }
      ctx.lineTo(X(t), H - pad.b); ctx.lineTo(X(0), H - pad.b); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
      ctx.beginPath(); ctx.moveTo(X(0), Y(1));
      for (let i = 1; i <= N; i++) { const s = (t * i) / N; ctx.lineTo(X(s), Y(Math.exp(K * s))); }
      ctx.strokeStyle = col; ctx.lineWidth = 3.5; ctx.lineCap = 'round'; ctx.stroke();
      const hx = X(t), hy = Y(mm);
      if (!boom) {
        ctx.save(); ctx.shadowColor = col; ctx.shadowBlur = 18;
        const rg = ctx.createRadialGradient(hx - 3, hy - 3, 1, hx, hy, 11);
        rg.addColorStop(0, css('--gold-hi')); rg.addColorStop(1, css('--gold-lo'));
        ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(hx, hy, 10, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      }
      sparks.forEach((p) => { ctx.globalAlpha = Math.max(0, p.life); ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); });
      ctx.globalAlpha = 1;
      return { hx, hy };
    }
    function addHist(v) {
      hist.unshift(v); if (hist.length > 10) hist.pop();
      $('#crHist', root).innerHTML = hist.map((x) => '<span class="' + (x >= 2 ? 'hi' : 'lo') + '">×' + x.toFixed(2) + '</span>').join('');
    }
    function showCash(r) {
      if (cashed || !(r.cash > 0)) return;
      cashed = r.cash;
      mEl.classList.add('cash');
      msg(m, 'აიღე ×' + (+r.cash).toFixed(2) + ' — +' + Z.fmt(r.pay - r.bet) + ' კოინი', 'win');
      go.textContent = 'ფრენა გრძელდება…'; go.disabled = true;
      Z.celebrate(mEl, r.pay - r.bet);
    }
    function boom(point) {
      if (st !== 'fly') return;
      st = 'boom';
      const tc = Math.max(Math.log(point) / K, 0.001);
      Z.sfx && Z.sfx('boom');
      const pos = paint(tc, true) || { hx: 0, hy: 0 };
      mEl.textContent = '×' + point.toFixed(2); mEl.classList.remove('cash'); mEl.classList.add('boom');
      if (!cashed) msg(m, 'აფეთქდა ×' + point.toFixed(2) + ' — წააგე ' + Z.fmt(bet), 'loss');
      addHist(point);
      const C = [css('--loss'), css('--gold-hi'), css('--gold')];
      sparks = Array.from({ length: 46 }, () => ({ x: pos.hx, y: pos.hy, vx: (Math.random() - 0.5) * 9, vy: (Math.random() - 0.8) * 8, r: 1.5 + Math.random() * 3, life: 1, c: C[Math.floor(Math.random() * 3)] }));
      const end = performance.now();
      (function sp(n2) {
        sparks.forEach((p) => { p.x += p.vx; p.y += p.vy; p.vy += 0.3; p.life -= 0.025; });
        paint(tc, true);
        if (n2 - end < 1400) requestAnimationFrame(sp); else { sparks = []; paint(tc, true); }
      })(end);
      go.textContent = 'ხელახლა გაშვება'; go.disabled = false; st = 'idle'; go.classList.remove('win'); go.classList.add('primary');
      gid = null;
    }
    async function pollNow() {
      if (polling || !gid) return;
      polling = true; lastPoll = performance.now();
      try {
        const r = await Z.api('game_crash_poll', { id: gid }, { quiet: true });
        if (r && r.status === 'done') { cp = +r.cp; if (r.cash) showCash(r); Z.refreshMine(['quests'], 1500); }
      } catch (e) {}
      polling = false;
    }
    function loop() {
      if (st !== 'fly') return;
      const t = (Z.now() - t0) / 1000, cur = Math.exp(K * t);
      if (cp != null && cur >= cp) { boom(cp); return; }
      if (performance.now() - lastPoll > 550) pollNow();
      paint(t);
      mEl.textContent = '×' + cur.toFixed(2);
      if (!cashed) go.textContent = 'აიღე ' + Z.fmt(Math.floor(bet * cur)) + ' კოინი';
      requestAnimationFrame(loop);
    }
    function fly(r) {
      gid = r.id; bet = r.bet; cashed = 0; sparks = []; cp = null; t0 = +r.t0;
      mEl.className = 'crash-mult'; mEl.textContent = '×1.00';
      msg(m, 'ფრენა დაიწყო');
      st = 'fly';
      go.classList.add('win'); go.classList.remove('primary'); go.disabled = false;
      requestAnimationFrame(loop);
    }
    go.addEventListener('click', async () => {
      if (st === 'fly') {
        if (cashed || go.disabled) return;
        go.disabled = true;
        try {
          const r = await Z.api('game_crash_cash', { id: gid }, { lazy: true, also: ['quests'] });
          if (r.status === 'done') { cp = +r.cp; if (r.cash) showCash(r); }
          go.disabled = !!cashed;
        } catch (e) { Z.toast(Z.errText(e), 'loss'); go.disabled = false; }
        return;
      }
      const b = getBet();
      if (!check(b)) return;
      const auto = parseFloat(autoIn.value);
      go.disabled = true;
      const r = await play('game_crash_start', { bet: b, auto: auto > 1 ? auto : null });
      go.disabled = false;
      if (r) fly(r);
    });
    Z.onTheme && Z.onTheme(() => paint(0));
    requestAnimationFrame(size);
    resume('crash').then((r) => { if (r && r.state && st === 'idle') fly({ id: r.id, bet: r.bet, t0: r.state.t0 }); });
  }

  /* ---------- 4. mines ---------- */
  function mountMines(root) {
    const N = 25;
    root.innerHTML = head('ნაღმები', 'გახსენი უჯრები და იპოვე ოქროს მონეტები. ყოველი მონეტა ზრდის მამრავლს. ნაღმზე დაჭერისას ფსონი იკარგება. აიღე მოგება ნებისმიერ დროს.') +
      '<div class="g-layout"><div class="g-ctrl">' + betField('mines') +
      '<div class="field"><span class="field-lbl">ნაღმების რაოდენობა</span><div class="seg" id="mnCount">' +
      [1, 3, 5, 10].map((v) => '<button type="button" data-n="' + v + '"' + (v === 3 ? ' class="on"' : '') + '>' + v + '</button>').join('') + '</div></div>' +
      '<button class="btn primary wide" id="mnGo">დაწყება</button>' +
      '<div class="mines-info"><div><small>მამრავლი</small><b id="mnMult">×1.00</b></div><div><small>შემდეგი უჯრა</small><b id="mnNext">—</b></div></div>' + fairLink() + '</div>' +
      '<div class="g-board"><div style="display:grid;gap:14px;justify-items:center;width:100%"><div class="mines-grid" id="mnGrid"></div><div class="g-msg" id="mnMsg">აირჩიე ნაღმების რაოდენობა და დაიწყე</div></div></div></div>';
    const getBet = wireBet(root, 'mines');
    const grid = $('#mnGrid', root), go = $('#mnGo', root), m = $('#mnMsg', root), mm = $('#mnMult', root), mn = $('#mnNext', root);
    let mines = 3, live = false, opened = 0, bet = 0, gid = null, busy = false;
    const multAt = (k) => { let x = 0.97; for (let i = 0; i < k; i++) x *= (N - i) / (N - mines - i); return x; };
    root.querySelectorAll('#mnCount button').forEach((b) => b.addEventListener('click', () => {
      if (live) return;
      mines = +b.dataset.n;
      root.querySelectorAll('#mnCount button').forEach((x) => x.classList.toggle('on', x === b));
      mn.textContent = '×' + multAt(1).toFixed(2);
    }));
    function build(open) {
      grid.innerHTML = '';
      for (let i = 0; i < N; i++) {
        const c = document.createElement('button');
        c.type = 'button'; c.className = 'mcell' + ((open || []).includes(i) ? ' open gem' : ''); c.disabled = !live; c.dataset.i = i;
        c.setAttribute('aria-label', 'უჯრა ' + (i + 1));
        c.innerHTML = '<span class="in"><span class="fr"></span><span class="bk"><span></span></span></span>';
        c.style.animation = 'popIn .4s var(--spring) both'; c.style.animationDelay = (i % 5 + Math.floor(i / 5)) * 30 + 'ms';
        c.addEventListener('click', () => pick(c));
        grid.appendChild(c);
      }
    }
    function revealAll(bombs, hitIdx) {
      grid.querySelectorAll('.mcell').forEach((c, i) => {
        c.disabled = true;
        if (c.classList.contains('open')) return;
        setTimeout(() => { c.classList.add('open', bombs.includes(i) ? 'bomb' : 'gem', 'dim'); }, 80 + Math.abs(i - (hitIdx ?? 12)) * 18);
      });
    }
    function finish() {
      live = false; gid = null;
      go.textContent = 'ახალი თამაში'; go.classList.add('primary'); go.classList.remove('win');
      root.querySelectorAll('#mnCount button').forEach((b) => (b.disabled = false));
    }
    async function pick(c) {
      if (!live || busy || c.classList.contains('open')) return;
      const i = +c.dataset.i;
      busy = true; c.classList.add('wait');
      const r = await play('game_mines_pick', { id: gid, cell: i });
      busy = false; c.classList.remove('wait');
      if (!r) return;
      if (r.boom) {
        c.classList.add('open', 'bomb', 'hit');
        Z.sfx && Z.sfx('boom');
        grid.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-8px)' }, { transform: 'translateX(7px)' }, { transform: 'translateX(-4px)' }, { transform: 'none' }], { duration: 420 });
        msg(m, 'ნაღმი! წააგე ' + Z.fmt(bet) + ' კოინი', 'loss');
        finish(); revealAll(r.bombs, i);
        return;
      }
      opened = r.k;
      c.classList.add('open', 'gem');
      Z.sfx && Z.sfx('coin');
      mm.textContent = '×' + (+r.mult).toFixed(2);
      mm.animate([{ transform: 'scale(1.25)' }, { transform: 'scale(1)' }], { duration: 300, easing: 'ease-out' });
      const safeLeft = N - mines - opened;
      mn.textContent = safeLeft > 0 ? '×' + multAt(opened + 1).toFixed(2) : '—';
      go.textContent = 'აიღე ' + Z.fmt(Math.floor(bet * r.mult)) + ' კოინი';
      msg(m, 'ნაპოვნია ' + opened + ' მონეტა');
      if (r.done) { msg(m, 'ყველა მონეტა ნაპოვნია! +' + Z.fmt(r.pay - r.bet), 'win'); Z.celebrate(grid, r.pay - r.bet); finish(); revealAll(r.bombs); }
    }
    async function cash() {
      if (!live || !opened || busy) return;
      busy = true;
      const r = await play('game_mines_cash', { id: gid });
      busy = false;
      if (!r) return;
      msg(m, 'აიღე ×' + (+r.mult).toFixed(2) + ' — +' + Z.fmt(r.pay - r.bet) + ' კოინი', 'win');
      Z.celebrate(grid, r.pay - r.bet);
      finish(); revealAll(r.bombs);
    }
    function begin(r, open) {
      gid = r.id; bet = r.bet; opened = (open || []).length; live = true;
      mines = +((r.params || {}).mines || r.mines || mines);
      root.querySelectorAll('#mnCount button').forEach((x) => { x.classList.toggle('on', +x.dataset.n === mines); x.disabled = true; });
      build(open);
      mm.textContent = '×' + (opened ? multAt(opened) : 1).toFixed(2); mn.textContent = '×' + multAt(opened + 1).toFixed(2);
      go.textContent = opened ? 'აიღე ' + Z.fmt(Math.floor(bet * multAt(opened))) + ' კოინი' : 'გახსენი უჯრა'; go.classList.remove('primary'); go.classList.add('win');
      msg(m, opened ? 'გააგრძელე დაწყებული თამაში' : 'იპოვე მონეტები, აარიდე ნაღმებს თავი');
    }
    go.addEventListener('click', async () => {
      if (live) { if (opened) cash(); else Z.toast('ჯერ ერთი უჯრა მაინც გახსენი.'); return; }
      const b = getBet();
      if (!check(b) || busy) return;
      busy = true;
      const r = await play('game_mines_start', { bet: b, mines });
      busy = false;
      if (r) begin(r, []);
      else { const old = await resume('mines'); if (old) begin(old, old.state.open); }
    });
    build();
    mn.textContent = '×' + multAt(1).toFixed(2);
    resume('mines').then((r) => { if (r && !live) begin(r, r.state.open); });
  }

  Z.GAMES = [
    { k: 'crash', name: 'რაკეტა', desc: 'აიღე მოგება აფეთქებამდე', icon: ICONS.crash, mount: mountCrash },
    { k: 'mines', name: 'ნაღმები', desc: 'იპოვე მონეტები, აარიდე ნაღმებს', icon: ICONS.mines, mount: mountMines },
    { k: 'wheel', name: 'ბედის ბორბალი', desc: '10 სექტორი, ×3-მდე', icon: ICONS.wheel, mount: mountWheel },
    { k: 'flip', name: 'ქოინის აგდება', desc: 'ზ თუ ბორჯღალი, ×1.94', icon: ICONS.flip, mount: mountFlip },
  ];
  Z.gameKit = { betField, wireBet, check, play, hold, release, msg, head, $, css, reduce, fairLink, resume };
})();
