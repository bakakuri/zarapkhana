/* ზარაფხანა — roulette, slot, keno, tower, hi-lo (results come from the server) */
(function () {
  const Z = window.Z;
  const { betField, wireBet, check, play, hold, release, msg, head, $, css, reduce, fairLink, resume } = Z.gameKit;
  const sfx = (n) => Z.sfx && Z.sfx(n);

  const ICONS = {
    roulette: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="4.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M12 3v4.5M12 16.5V21M3 12h4.5M16.5 12H21" stroke="currentColor" stroke-width="1.5"/><circle cx="15.5" cy="6.5" r="1.4" fill="currentColor"/></svg>',
    slot: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M9 5v14M15 5v14" stroke="currentColor" stroke-width="1.4"/><text x="6" y="14.5" font-size="6" font-weight="800" fill="currentColor" text-anchor="middle">7</text><text x="12" y="14.5" font-size="6" font-weight="800" fill="currentColor" text-anchor="middle">7</text><text x="18" y="14.5" font-size="6" font-weight="800" fill="currentColor" text-anchor="middle">7</text></svg>',
    keno: '<svg viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="6" cy="6" r="2.4"/><circle cx="12" cy="6" r="2.4"/><circle cx="18" cy="6" r="2.4"/><circle cx="6" cy="12" r="2.4"/><circle cx="18" cy="12" r="2.4"/><circle cx="6" cy="18" r="2.4"/><circle cx="12" cy="18" r="2.4"/></g><circle cx="12" cy="12" r="2.6" fill="currentColor"/><circle cx="18" cy="18" r="2.6" fill="currentColor"/></svg>',
    tower: '<svg viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4" y="16" width="4.5" height="4" rx="1"/><rect x="9.75" y="16" width="4.5" height="4" rx="1"/><rect x="15.5" y="16" width="4.5" height="4" rx="1"/><rect x="4" y="10" width="4.5" height="4" rx="1"/><rect x="15.5" y="10" width="4.5" height="4" rx="1"/><rect x="9.75" y="4" width="4.5" height="4" rx="1"/></g><rect x="9.75" y="10" width="4.5" height="4" rx="1" fill="currentColor"/></svg>',
    hilo: '<svg viewBox="0 0 24 24"><rect x="5" y="4" width="11" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M19.5 6.5 21 9h-3l1.5-2.5ZM19.5 17.5 18 15h3l-1.5 2.5Z" fill="currentColor"/><text x="10.5" y="15" font-size="7" font-weight="800" fill="currentColor" text-anchor="middle">K</text></svg>',
  };

  /* =================== roulette (European, 37 pockets) =================== */
  const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
  const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
  const OUT = [
    { k: 'd1', l: '1–12', hit: (n) => n >= 1 && n <= 12 }, { k: 'd2', l: '13–24', hit: (n) => n >= 13 && n <= 24 }, { k: 'd3', l: '25–36', hit: (n) => n >= 25 },
    { k: 'lo', l: '1–18', hit: (n) => n >= 1 && n <= 18 }, { k: 'ev', l: 'ლუწი', hit: (n) => n && n % 2 === 0 }, { k: 'rd', l: 'წითელი', hit: (n) => RED.has(n) },
    { k: 'bk', l: 'შავი', hit: (n) => n && !RED.has(n) }, { k: 'od', l: 'კენტი', hit: (n) => n % 2 === 1 }, { k: 'hi', l: '19–36', hit: (n) => n >= 19 },
  ];
  function mountRoulette(root) {
    root.innerHTML = head('რულეტკა', 'ევროპული რულეტკა 37 უჯრით. აირჩიე ჟეტონი და დადე რამდენიმე ადგილზე: რიცხვი ×36, ათეული ×3, ფერი, ლუწი-კენტი და ნახევარი ×2.') +
      '<div class="g-layout"><div class="g-ctrl">' + betField('roulette', 'ჟეტონის ზომა') +
      '<div class="mines-info"><div><small>დადებული</small><b id="ruTot">0</b></div><div><small>ბოლო რიცხვი</small><b id="ruLast">—</b></div></div>' +
      '<div class="btn-row"><button class="btn primary" id="ruGo" style="flex:1">დატრიალება</button><button class="btn ghost" id="ruClr">გასუფთავება</button></div>' +
      '<div class="crash-hist" id="ruHist"></div>' + fairLink() + '</div>' +
      '<div class="g-board ru-board"><div class="ru-wrap"><div class="wheel-wrap ru-wheel"><canvas id="ruCv" width="600" height="600"></canvas><div class="ru-ball" id="ruBall"></div></div>' +
      '<div class="ru-table" id="ruTable"></div></div><div class="g-msg" id="ruMsg">დადე ჟეტონები და დაატრიალე</div></div></div>';
    const getBet = wireBet(root, 'roulette');
    const cv = $('#ruCv', root), ctx = cv.getContext('2d'), ball = $('#ruBall', root), table = $('#ruTable', root), m = $('#ruMsg', root);
    const bets = new Map();
    let rot = 0, busy = false;
    const hist = [];
    table.innerHTML = '<button type="button" class="ru-cell zero" data-b="n0">0</button><div class="ru-nums">' +
      Array.from({ length: 36 }, (_, i) => '<button type="button" class="ru-cell ' + (RED.has(i + 1) ? 'red' : 'blk') + '" data-b="n' + (i + 1) + '">' + (i + 1) + '</button>').join('') + '</div>' +
      '<div class="ru-out">' + OUT.map((o) => '<button type="button" class="ru-cell out ' + (o.k === 'rd' ? 'red' : o.k === 'bk' ? 'blk' : '') + '" data-b="' + o.k + '">' + o.l + '</button>').join('') + '</div>';
    function drawWheel() {
      const W = cv.width, c = W / 2, R = c - 6, n = WHEEL.length;
      ctx.clearRect(0, 0, W, W);
      for (let i = 0; i < n; i++) {
        const a0 = -Math.PI / 2 + (i - 0.5) * (2 * Math.PI / n), a1 = a0 + 2 * Math.PI / n, v = WHEEL[i];
        ctx.beginPath(); ctx.moveTo(c, c); ctx.arc(c, c, R, a0, a1); ctx.closePath();
        ctx.fillStyle = v === 0 ? '#159A63' : RED.has(v) ? '#C8302C' : '#1B1D24'; ctx.fill();
        ctx.save(); ctx.translate(c, c); ctx.rotate((a0 + a1) / 2 + Math.PI / 2);
        ctx.fillStyle = '#fff'; ctx.font = '700 22px Unbounded, system-ui'; ctx.textAlign = 'center'; ctx.fillText(v, 0, -R + 32); ctx.restore();
      }
      ctx.beginPath(); ctx.arc(c, c, R * 0.62, 0, Math.PI * 2); ctx.fillStyle = css('--surface-2'); ctx.fill();
      ctx.beginPath(); ctx.arc(c, c, R * 0.62, 0, Math.PI * 2); ctx.strokeStyle = css('--gold-mid'); ctx.lineWidth = 6; ctx.stroke();
      ctx.beginPath(); ctx.arc(c, c, R * 0.18, 0, Math.PI * 2); ctx.fillStyle = css('--gold-mid'); ctx.fill();
    }
    drawWheel(); Z.onTheme && Z.onTheme(drawWheel);
    function paintChips() {
      table.querySelectorAll('.ru-cell').forEach((b) => {
        const v = bets.get(b.dataset.b) || 0;
        let ch = b.querySelector('.chipm');
        if (v && !ch) { ch = document.createElement('i'); ch.className = 'chipm'; b.appendChild(ch); }
        if (ch) { if (v) ch.textContent = v >= 1000 ? Math.round(v / 100) / 10 + 'K' : v; else ch.remove(); }
      });
      $('#ruTot', root).textContent = Z.fmt([...bets.values()].reduce((a, b) => a + b, 0));
    }
    table.addEventListener('click', (e) => {
      const b = e.target.closest('[data-b]');
      if (!b || busy) return;
      const v = getBet();
      if (!(v > 0)) return;
      const tot = [...bets.values()].reduce((a, x) => a + x, 0) + v;
      if (tot > Z.dispBal()) { Z.toast('ბალანსი არ გყოფნის.', 'loss'); return; }
      bets.set(b.dataset.b, (bets.get(b.dataset.b) || 0) + v);
      sfx('coin'); paintChips();
      b.animate([{ transform: 'scale(1.15)' }, { transform: 'none' }], { duration: 250, easing: 'ease-out' });
    });
    $('#ruClr', root).addEventListener('click', () => { if (!busy) { bets.clear(); paintChips(); } });
    $('#ruGo', root).addEventListener('click', async () => {
      if (busy) return;
      const tot = [...bets.values()].reduce((a, b) => a + b, 0);
      if (!tot) { Z.toast('ჯერ დადე ჟეტონი მაგიდაზე.', 'loss'); return; }
      if (!check(tot)) return;
      busy = true; $('#ruGo', root).disabled = true; msg(m, 'ტრიალებს…'); sfx('roll');
      const r = await play('game_roulette', { bets: Object.fromEntries(bets) });
      if (!r) { busy = false; $('#ruGo', root).disabled = false; msg(m, 'ვერ შესრულდა'); return; }
      hold(r.pay);
      const num = r.num, idx = WHEEL.indexOf(num), seg = 360 / 37;
      const from = rot, to = from - (from % 360) + 360 * 5 + ((360 - idx * seg) % 360);
      const dur = reduce() ? 10 : 4200, t0 = performance.now();
      const ease = (t) => 1 - Math.pow(1 - t, 3);
      let lastTick = -1;
      (function f(now) {
        const t = Math.min(1, (now - t0) / dur);
        rot = from + (to - from) * ease(t);
        cv.style.transform = 'rotate(' + rot + 'deg)';
        ball.style.transform = 'rotate(' + (-rot * 1.6 + (1 - ease(t)) * 720) + 'deg)';
        const tk = Math.floor(rot / seg); if (tk !== lastTick) { lastTick = tk; sfx('tick'); }
        if (t < 1) return requestAnimationFrame(f);
        ball.style.transform = 'rotate(0deg)';
        release(r.pay);
        const win = r.pay;
        const last = $('#ruLast', root);
        last.textContent = num; last.className = num === 0 ? 'pos' : RED.has(num) ? 'neg' : '';
        table.querySelectorAll('.ru-cell').forEach((b) => b.classList.toggle('hit', b.dataset.b === 'n' + num || (OUT.find((x) => x.k === b.dataset.b) || { hit: () => false }).hit(num)));
        msg(m, num + (num === 0 ? ' · ნული' : RED.has(num) ? ' · წითელი' : ' · შავი') + ' — ' + (win > tot ? 'მოიგე +' + Z.fmt(win - tot) : win === tot ? 'ფსონი დაგიბრუნდა' : 'წააგე ' + Z.fmt(tot - win)), win > tot ? 'win' : win < tot ? 'loss' : '');
        if (win > tot) Z.celebrate(cv, win - tot);
        hist.unshift(num); if (hist.length > 12) hist.pop();
        $('#ruHist', root).innerHTML = hist.map((x) => '<span class="' + (x === 0 ? 'hi' : RED.has(x) ? 'lo' : 'nb') + '">' + x + '</span>').join('');
        busy = false; $('#ruGo', root).disabled = false;
      })(t0);
    });
    paintChips();
  }

  /* =================== slot =================== */
  const SYM = [
    { g: '7', c: 'sy-7', w: 1, p: 100 }, { g: 'ზ', c: 'sy-z', w: 2, p: 50 }, { g: '★', c: 'sy-s', w: 3, p: 25 },
    { g: '◆', c: 'sy-d', w: 4, p: 15 }, { g: '♣', c: 'sy-c', w: 5, p: 10 }, { g: '●', c: 'sy-g', w: 7, p: 8 },
  ];
  const SW = SYM.reduce((a, s) => a + s.w, 0);
  const pickSym = () => { let r = Z.randInt(SW); for (let i = 0; i < SYM.length; i++) { if (r < SYM[i].w) return i; r -= SYM[i].w; } return SYM.length - 1; };
  function mountSlot(root) {
    root.innerHTML = head('სლოტი', 'სამი ბარაბანი, ერთი ხაზი. სამი ერთნაირი სიმბოლო იხდის ცხრილის მიხედვით, ორი ზ ×5, ერთი ზ ×1.2.') +
      '<div class="g-layout"><div class="g-ctrl">' + betField('slot') +
      '<button class="btn primary wide" id="slGo">დატრიალება</button>' +
      '<div class="field"><span class="field-lbl">გადახდები (სამი ერთნაირი)</span><div class="sl-pay">' + SYM.map((s) => '<span><i class="sy ' + s.c + '">' + s.g + '</i>×' + s.p + '</span>').join('') + '<span><i class="sy sy-z">ზ</i><i class="sy sy-z">ზ</i>×5</span><span><i class="sy sy-z">ზ</i>×1.2</span></div></div>' + fairLink() + '</div>' +
      '<div class="g-board"><div style="display:grid;gap:16px;justify-items:center;width:100%"><div class="sl-machine"><div class="sl-reels" id="slReels">' +
      [0, 1, 2].map((i) => '<div class="sl-reel"><div class="sl-strip" id="slS' + i + '"></div></div>').join('') + '</div><span class="sl-line"></span></div>' +
      '<div class="g-msg" id="slMsg">დაატრიალე ბარაბნები</div></div></div></div>';
    const getBet = wireBet(root, 'slot');
    const m = $('#slMsg', root), go = $('#slGo', root);
    const H = 72, strips = [0, 1, 2].map((i) => $('#slS' + i, root));
    const fill = (el, list) => { el.innerHTML = list.map((k) => '<div class="sl-cell"><i class="sy ' + SYM[k].c + '">' + SYM[k].g + '</i></div>').join(''); };
    const vis = strips.map((el) => { const v = [pickSym(), pickSym(), pickSym()]; fill(el, v); el.style.transform = 'translateY(0)'; return v; });
    let busy = false;
    go.addEventListener('click', async () => {
      if (busy) return;
      const bet = getBet();
      if (!check(bet)) return;
      busy = true; go.disabled = true; msg(m, 'ტრიალებს…'); sfx('roll');
      $('#slReels', root).classList.remove('win');
      const r = await play('game_slot', { bet });
      if (!r) { busy = false; go.disabled = false; msg(m, 'ვერ შესრულდა'); return; }
      hold(r.pay);
      const res = r.reels;
      const done = [];
      strips.forEach((el, i) => {
        const n = 18 + i * 6, list = [];
        for (let j = 0; j < n; j++) list.push(pickSym());
        list[n - 2] = res[i];
        fill(el, vis[i].concat(list));
        el.style.transition = 'none'; el.style.transform = 'translateY(0)'; void el.offsetWidth;
        const dur = reduce() ? 10 : 900 + i * 450;
        el.style.transition = 'transform ' + dur + 'ms cubic-bezier(.2,.75,.25,1.05)';
        el.style.transform = 'translateY(' + -(H * n) + 'px)';
        vis[i] = [list[n - 3], list[n - 2], list[n - 1]];
        done.push(new Promise((ok) => setTimeout(() => { sfx('tick'); ok(); }, dur)));
      });
      Promise.all(done).then(() => {
        release(r.pay);
        const mult = +r.m, win = r.pay, bet0 = r.bet;
        if (win > bet0) { $('#slReels', root).classList.add('win'); Z.celebrate($('#slReels', root), win - bet0); }
        msg(m, mult ? '×' + mult + ' — ' + (win > bet0 ? 'მოიგე +' + Z.fmt(win - bet0) : 'დაგიბრუნდა ' + Z.fmt(win)) : 'ამჯერად არაფერი', win > bet0 ? 'win' : win < bet0 ? 'loss' : '');
        busy = false; go.disabled = false;
      });
    });
  }

  /* =================== keno (40 numbers, 10 drawn) =================== */
  const KENO = {
    1: { 1: 3.8 }, 2: { 1: 1, 2: 10 }, 3: { 2: 3.5, 3: 40 }, 4: { 2: 2, 3: 8, 4: 90 }, 5: { 2: 1, 3: 4, 4: 30, 5: 250 },
    6: { 3: 4, 4: 12, 5: 75, 6: 700 }, 7: { 3: 2, 4: 6, 5: 40, 6: 250, 7: 2000 }, 8: { 3: 1, 4: 4, 5: 20, 6: 100, 7: 600, 8: 3000 },
    9: { 4: 4, 5: 12, 6: 50, 7: 300, 8: 2000, 9: 8000 }, 10: { 4: 2, 5: 8, 6: 30, 7: 150, 8: 800, 9: 4000, 10: 10000 },
  };
  function mountKeno(root) {
    root.innerHTML = head('კენო', 'აირჩიე 1-დან 10-მდე რიცხვი 40-დან. გათამაშდება 10 რიცხვი: რაც მეტს დაემთხვევა, მით მეტია მოგება.') +
      '<div class="g-layout"><div class="g-ctrl">' + betField('keno') +
      '<div class="btn-row"><button class="btn ghost" id="knRand" style="flex:1">შემთხვევითი 5</button><button class="btn ghost" id="knClr">გასუფთავება</button></div>' +
      '<button class="btn primary wide" id="knGo">თამაში</button>' +
      '<div class="field"><span class="field-lbl">გადახდები · <b id="knK">0</b> რიცხვი</span><div class="kn-pay" id="knPay"></div></div>' + fairLink() + '</div>' +
      '<div class="g-board"><div style="display:grid;gap:14px;justify-items:center;width:100%"><div class="kn-grid" id="knGrid">' +
      Array.from({ length: 40 }, (_, i) => '<button type="button" class="kn-n" data-n="' + (i + 1) + '">' + (i + 1) + '</button>').join('') + '</div><div class="g-msg" id="knMsg">აირჩიე რიცხვები</div></div></div></div>';
    const getBet = wireBet(root, 'keno');
    const grid = $('#knGrid', root), m = $('#knMsg', root), go = $('#knGo', root);
    let pick = new Set(Z.store.get('zar-keno', [])), busy = false;
    function sync() {
      grid.querySelectorAll('.kn-n').forEach((b) => b.classList.toggle('on', pick.has(+b.dataset.n)));
      const k = pick.size, t = KENO[k] || {};
      $('#knK', root).textContent = k;
      $('#knPay', root).innerHTML = k ? Object.entries(t).map(([h, x]) => '<span>' + h + ' დამთხვევა <b>×' + x + '</b></span>').join('') : '<span class="muted">აირჩიე რიცხვები</span>';
      Z.store.set('zar-keno', [...pick]);
    }
    const clearMarks = () => grid.querySelectorAll('.kn-n').forEach((x) => x.classList.remove('hit', 'drawn', 'miss'));
    grid.addEventListener('click', (e) => {
      const b = e.target.closest('[data-n]');
      if (!b || busy) return;
      const n = +b.dataset.n;
      if (pick.has(n)) pick.delete(n); else if (pick.size < 10) pick.add(n); else { Z.toast('მაქსიმუმ 10 რიცხვი.'); return; }
      clearMarks(); sfx('click'); sync();
    });
    $('#knRand', root).addEventListener('click', () => { if (busy) return; pick = new Set(); while (pick.size < 5) pick.add(1 + Z.randInt(40)); clearMarks(); sync(); });
    $('#knClr', root).addEventListener('click', () => { if (busy) return; pick = new Set(); clearMarks(); sync(); });
    go.addEventListener('click', async () => {
      if (busy) return;
      if (!pick.size) { Z.toast('ჯერ აირჩიე რიცხვები.', 'loss'); return; }
      const bet = getBet();
      if (!check(bet)) return;
      busy = true; go.disabled = true;
      clearMarks();
      const r = await play('game_keno', { bet, picks: [...pick] });
      if (!r) { busy = false; go.disabled = false; return; }
      hold(r.pay);
      let hits = 0;
      for (const n of r.drawn) {
        const b = grid.querySelector('[data-n="' + n + '"]');
        const h = pick.has(n); if (h) hits++;
        b.classList.add(h ? 'hit' : 'drawn');
        sfx(h ? 'coin' : 'tick');
        msg(m, 'დამთხვევა: ' + hits);
        await new Promise((ok) => setTimeout(ok, reduce() ? 0 : 170));
      }
      release(r.pay);
      const mult = +r.m, win = r.pay;
      msg(m, r.hits + ' დამთხვევა' + (mult ? ' · ×' + mult + (win > r.bet ? ' — მოიგე +' + Z.fmt(win - r.bet) : ' — დაგიბრუნდა ' + Z.fmt(win)) : ' — ამჯერად არაფერი'), win > r.bet ? 'win' : win < r.bet ? 'loss' : '');
      if (win > r.bet) Z.celebrate(grid, win - r.bet);
      busy = false; go.disabled = false;
    });
    sync();
  }

  /* =================== tower =================== */
  const DIFF = { easy: { n: 4, name: 'მარტივი' }, mid: { n: 3, name: 'საშუალო' }, hard: { n: 2, name: 'რთული' } };
  function mountTower(root) {
    const FL = 8;
    root.innerHTML = head('კოშკი', 'აიყვანე მონეტა კოშკზე: ყოველ სართულზე ერთი უჯრა ხაფანგია. ყოველი გავლილი სართული ზრდის მამრავლს. აიღე მოგება ნებისმიერ დროს.') +
      '<div class="g-layout"><div class="g-ctrl">' + betField('tower') +
      '<div class="field"><span class="field-lbl">სირთულე</span><div class="seg" id="twD">' + Object.entries(DIFF).map(([k, d]) => '<button type="button" data-d="' + k + '"' + (k === 'mid' ? ' class="on"' : '') + '>' + d.name + '</button>').join('') + '</div></div>' +
      '<button class="btn primary wide" id="twGo">დაწყება</button>' +
      '<div class="mines-info"><div><small>მამრავლი</small><b id="twM">×1.00</b></div><div><small>შემდეგი სართული</small><b id="twN">—</b></div></div>' + fairLink() + '</div>' +
      '<div class="g-board"><div style="display:grid;gap:14px;justify-items:center;width:100%"><div class="tw" id="twBoard"></div><div class="g-msg" id="twMsg">აირჩიე სირთულე და დაიწყე</div></div></div></div>';
    const getBet = wireBet(root, 'tower');
    const board = $('#twBoard', root), m = $('#twMsg', root), go = $('#twGo', root);
    let diff = 'mid', live = false, floor = 0, bet = 0, gid = null, busy = false, picks = [];
    const multAt = (f) => Math.floor(0.97 * Math.pow(DIFF[diff].n / (DIFF[diff].n - 1), f) * 100) / 100;
    root.querySelectorAll('#twD button').forEach((b) => b.addEventListener('click', () => { if (live) return; diff = b.dataset.d; root.querySelectorAll('#twD button').forEach((x) => x.classList.toggle('on', x === b)); build(); }));
    function build() {
      const n = DIFF[diff].n;
      board.innerHTML = Array.from({ length: FL }, (_, i) => FL - 1 - i).map((f) => '<div class="tw-row' + (live && f === floor ? ' cur' : '') + '" data-f="' + f + '"><span class="tw-m">×' + multAt(f + 1).toFixed(2) + '</span>' +
        Array.from({ length: n }, (_, j) => '<button type="button" class="tw-t' + (picks[f] === j ? ' safe' : '') + '" data-f="' + f + '" data-j="' + j + '"' + (live && f === floor ? '' : ' disabled') + '></button>').join('') + '</div>').join('');
      $('#twN', root).textContent = '×' + multAt(floor + 1).toFixed(2);
    }
    function revealAll(traps) {
      board.querySelectorAll('.tw-t').forEach((t) => { const f = +t.dataset.f, j = +t.dataset.j; t.disabled = true; if (!t.classList.contains('safe') && !t.classList.contains('trap')) t.classList.add(traps[f] === j ? 'trap' : 'dim'); });
    }
    function end() { live = false; gid = null; go.textContent = 'ახალი თამაში'; go.classList.add('primary'); go.classList.remove('win'); root.querySelectorAll('#twD button').forEach((b) => (b.disabled = false)); }
    async function cash() {
      if (!live || !floor || busy) return;
      busy = true;
      const r = await play('game_tower_cash', { id: gid });
      busy = false;
      if (!r) return;
      msg(m, 'აიღე ×' + (+r.mult).toFixed(2) + ' — +' + Z.fmt(r.pay - r.bet) + ' კოინი', 'win');
      Z.celebrate(board, r.pay - r.bet);
      end(); revealAll(r.traps);
    }
    board.addEventListener('click', async (e) => {
      const t = e.target.closest('.tw-t');
      if (!t || !live || busy || +t.dataset.f !== floor) return;
      const j = +t.dataset.j;
      busy = true;
      const r = await play('game_tower_pick', { id: gid, col: j });
      busy = false;
      if (!r) return;
      if (r.trap) {
        t.classList.add('trap'); sfx('boom');
        board.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-8px)' }, { transform: 'translateX(7px)' }, { transform: 'none' }], { duration: 380 });
        msg(m, 'ხაფანგი! წააგე ' + Z.fmt(bet), 'loss');
        end(); revealAll(r.traps); return;
      }
      t.classList.add('safe'); sfx('coin');
      picks[floor] = j; floor = r.floor;
      $('#twM', root).textContent = '×' + (+r.mult).toFixed(2);
      if (r.done) { msg(m, 'კოშკის თავზე ხარ! +' + Z.fmt(r.pay - r.bet), 'win'); Z.celebrate(board, r.pay - r.bet); end(); revealAll(r.traps); return; }
      board.querySelectorAll('.tw-row').forEach((row) => row.classList.toggle('cur', +row.dataset.f === floor));
      board.querySelectorAll('.tw-t').forEach((x) => (x.disabled = +x.dataset.f !== floor || x.classList.contains('safe')));
      $('#twN', root).textContent = '×' + multAt(floor + 1).toFixed(2);
      go.textContent = 'აიღე ' + Z.fmt(Math.floor(bet * multAt(floor))) + ' კოინი';
      msg(m, 'სართული ' + floor + ' გავლილია');
    });
    function begin(r, prev) {
      gid = r.id; bet = r.bet; live = true; picks = prev || []; floor = picks.length;
      const p = r.params || {};
      if (p.diff) diff = p.diff;
      root.querySelectorAll('#twD button').forEach((x) => { x.classList.toggle('on', x.dataset.d === diff); x.disabled = true; });
      go.textContent = floor ? 'აიღე ' + Z.fmt(Math.floor(bet * multAt(floor))) + ' კოინი' : 'აირჩიე უჯრა'; go.classList.remove('primary'); go.classList.add('win');
      $('#twM', root).textContent = '×' + (floor ? multAt(floor) : 1).toFixed(2);
      build(); msg(m, floor ? 'გააგრძელე დაწყებული თამაში' : 'აირჩიე უჯრა ქვედა სართულზე');
    }
    go.addEventListener('click', async () => {
      if (live) { if (floor) cash(); else Z.toast('ჯერ ერთი სართული მაინც გაიარე.'); return; }
      const b = getBet();
      if (!check(b) || busy) return;
      busy = true;
      const r = await play('game_tower_start', { bet: b, diff });
      busy = false;
      if (r) begin(Object.assign(r, { params: { diff } }), []);
      else { const old = await resume('tower'); if (old) begin(old, old.state.picks); }
    });
    build();
    resume('tower').then((r) => { if (r && !live) begin(r, r.state.picks); });
  }

  /* =================== hi-lo =================== */
  function mountHilo(root) {
    root.innerHTML = head('მეტი თუ ნაკლები', 'გამოიცანი, შემდეგი კარტი მეტი იქნება თუ ნაკლები. თანაბარი წაგებაა. ყოველი სწორი პასუხი ამრავლებს მოგებას, რომლის აღებაც ნებისმიერ დროს შეგიძლია.') +
      '<div class="g-layout"><div class="g-ctrl">' + betField('hilo') +
      '<button class="btn primary wide" id="hlGo">დაწყება</button>' +
      '<div class="hl-acts"><button class="btn" id="hlHi" disabled>მეტი ▲<small id="hlHiM"></small></button><button class="btn" id="hlLo" disabled>ნაკლები ▼<small id="hlLoM"></small></button></div>' +
      '<button class="btn ghost wide" id="hlSkip" disabled>გამოტოვება (3)</button>' +
      '<div class="mines-info"><div><small>მამრავლი</small><b id="hlM">×1.00</b></div><div><small>სწორი პასუხი</small><b id="hlS">0</b></div></div>' + fairLink() + '</div>' +
      '<div class="g-board"><div style="display:grid;gap:16px;justify-items:center;width:100%"><div class="hl-card" id="hlCard"></div><div class="hl-trail" id="hlTrail"></div><div class="g-msg" id="hlMsg">დაიწყე თამაში</div></div></div></div>';
    const getBet = wireBet(root, 'hilo');
    const card = $('#hlCard', root), trail = $('#hlTrail', root), m = $('#hlMsg', root);
    const bGo = $('#hlGo', root), bHi = $('#hlHi', root), bLo = $('#hlLo', root), bSk = $('#hlSkip', root);
    let live = false, cur = null, mult = 1, bet = 0, streak = 0, skips = 3, gid = null, busy = false;
    const pHi = (r) => (12 - r) / 13, pLo = (r) => r / 13;
    const step = (p) => (p > 0 ? Math.floor((0.97 / p) * 100) / 100 : 0);
    function face(c, big) {
      const red = c.s === '♥' || c.s === '♦';
      return '<div class="pcard' + (red ? ' red' : '') + (big ? ' big' : '') + '"><span class="pc-in"><span class="pc-f"><b>' + c.r + '</b><i>' + c.s + '</i><em>' + c.s + '</em></span><span class="pc-b"></span></span></div>';
    }
    function show(c) {
      card.innerHTML = face(c, true);
      const el = card.firstChild;
      if (!reduce()) el.animate([{ transform: 'rotateY(90deg) scale(.9)' }, { transform: 'none' }], { duration: 380, easing: 'cubic-bezier(.34,1.56,.64,1)' });
      sfx('card');
      const rk = c.v % 13, hi = step(pHi(rk)), lo = step(pLo(rk));
      $('#hlHiM', root).textContent = hi ? ' ×' + hi.toFixed(2) : ''; $('#hlLoM', root).textContent = lo ? ' ×' + lo.toFixed(2) : '';
      bHi.disabled = !live || !hi; bLo.disabled = !live || !lo;
      bSk.disabled = !live || !skips; bSk.textContent = 'გამოტოვება (' + skips + ')';
    }
    function end() { live = false; gid = null; bHi.disabled = bLo.disabled = bSk.disabled = true; bGo.textContent = 'ახალი თამაში'; bGo.className = 'btn primary wide'; }
    async function act(a) {
      if (!live || busy) return;
      busy = true;
      const r = await play('game_hilo_act', { id: gid, act: a });
      busy = false;
      if (!r) return;
      const nx = Z.cardOf(r.card);
      if (a === 'skip') { skips = r.skips; cur = nx; show(cur); return; }
      trail.insertAdjacentHTML('beforeend', '<span class="hl-mini">' + cur.r + cur.s + '</span>');
      cur = nx;
      if (!r.ok) { msg(m, 'არ გამოიცანი · წააგე ' + Z.fmt(bet), 'loss'); end(); show(nx); return; }
      mult = +r.mult; streak = +r.streak;
      $('#hlM', root).textContent = '×' + mult.toFixed(2); $('#hlS', root).textContent = streak;
      if (r.done) { msg(m, 'ბოლომდე მიხვედი! +' + Z.fmt(r.pay - r.bet), 'win'); end(); show(nx); return; }
      bGo.textContent = 'აიღე ' + Z.fmt(Math.floor(bet * mult)) + ' კოინი';
      msg(m, 'სწორია! ×' + mult.toFixed(2));
      show(nx);
    }
    bHi.addEventListener('click', () => act('hi'));
    bLo.addEventListener('click', () => act('lo'));
    bSk.addEventListener('click', () => { if (skips) act('skip'); });
    function begin(r, s) {
      gid = r.id; bet = r.bet; live = true; mult = +s.mult || 1; streak = +s.streak || 0; skips = s.skips ?? 3; trail.innerHTML = '';
      $('#hlM', root).textContent = '×' + mult.toFixed(2); $('#hlS', root).textContent = streak;
      bGo.textContent = streak ? 'აიღე ' + Z.fmt(Math.floor(bet * mult)) + ' კოინი' : 'აიღე (ჯერ გამოიცანი)'; bGo.className = 'btn win wide';
      cur = Z.cardOf(s.card); show(cur); msg(m, streak ? 'გააგრძელე დაწყებული თამაში' : 'მეტი თუ ნაკლები?');
    }
    bGo.addEventListener('click', async () => {
      if (busy) return;
      if (live) {
        if (!streak) { Z.toast('ჯერ ერთხელ მაინც გამოიცანი.'); return; }
        busy = true;
        const r = await play('game_hilo_cash', { id: gid });
        busy = false;
        if (!r) return;
        msg(m, 'აიღე ×' + (+r.mult).toFixed(2) + ' — +' + Z.fmt(r.pay - r.bet), 'win');
        Z.celebrate(card, r.pay - r.bet);
        end(); show(cur); return;
      }
      const b = getBet();
      if (!check(b)) return;
      busy = true;
      const r = await play('game_hilo_start', { bet: b });
      busy = false;
      if (r) begin(r, r);
      else { const old = await resume('hilo'); if (old) begin(old, old.state); }
    });
    cur = Z.cardOf(Z.randInt(52)); show(cur);
    resume('hilo').then((r) => { if (r && !live) begin(r, r.state); });
  }

  Z.GAMES.push(
    { k: 'roulette', name: 'რულეტკა', desc: 'ევროპული, 37 უჯრა', icon: ICONS.roulette, mount: mountRoulette },
    { k: 'slot', name: 'სლოტი', desc: 'სამი შვიდიანი ×100', icon: ICONS.slot, mount: mountSlot },
    { k: 'keno', name: 'კენო', desc: '10 რიცხვი 40-დან', icon: ICONS.keno, mount: mountKeno },
    { k: 'tower', name: 'კოშკი', desc: '8 სართული, აიღე დროზე', icon: ICONS.tower, mount: mountTower },
    { k: 'hilo', name: 'მეტი თუ ნაკლები', desc: 'გამოიცანი შემდეგი კარტი', icon: ICONS.hilo, mount: mountHilo },
  );
  Z.WHEEL = WHEEL; Z.RED = RED; Z.KENO = KENO; Z.SLOT_SYM = SYM;
})();
