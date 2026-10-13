/* ზარაფხანა — dice, Plinko, blackjack (results come from the server) */
(function () {
  const Z = window.Z;
  const { betField, wireBet, check, play, hold, release, msg, head, $, css, reduce, fairLink, resume } = Z.gameKit;

  const ICONS = {
    dice: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="8" cy="8" r="1.6" fill="currentColor"/><circle cx="16" cy="16" r="1.6" fill="currentColor"/><circle cx="16" cy="8" r="1.6" fill="currentColor"/><circle cx="8" cy="16" r="1.6" fill="currentColor"/></svg>',
    plinko: '<svg viewBox="0 0 24 24"><g fill="currentColor"><circle cx="12" cy="4" r="1.4"/><circle cx="8" cy="9" r="1.4"/><circle cx="16" cy="9" r="1.4"/><circle cx="4" cy="14" r="1.4"/><circle cx="12" cy="14" r="1.4"/><circle cx="20" cy="14" r="1.4"/></g><path d="M3 19h18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="10" cy="6.5" r="2" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
    bj: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="11" height="15" rx="2" fill="none" stroke="currentColor" stroke-width="1.7" transform="rotate(-10 8 12)"/><rect x="10" y="4" width="11" height="15" rx="2" fill="currentColor" opacity=".3" stroke="currentColor" stroke-width="1.7" transform="rotate(8 15 11)"/><path d="M15.5 9.5c1-1.6 3-1 2.6.6-.3 1.2-2.6 2.8-2.6 2.8s-2.3-1.6-2.6-2.8c-.4-1.6 1.6-2.2 2.6-.6Z" fill="currentColor"/></svg>',
  };
  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const SUITS = ['♠', '♥', '♦', '♣'];
  Z.cardOf = (v) => ({ r: RANKS[v % 13], s: SUITS[Math.floor(v / 13) % 4], v });

  /* ---------- dice ---------- */
  function mountDice(root) {
    root.innerHTML = head('კამათელი', 'შედეგი 0.00-დან 99.99-მდეა. აირჩიე ზღვარი და მხარე: რაც უფრო მცირეა შანსი, მით დიდია მამრავლი.') +
      '<div class="g-layout"><div class="g-ctrl">' + betField('dice') +
      '<div class="field"><span class="field-lbl">მიმართულება</span><div class="seg" id="dcDir"><button type="button" data-d="u" class="on">ნაკლები</button><button type="button" data-d="o">მეტი</button></div></div>' +
      '<div class="field"><label class="field-lbl" for="dcT">ზღვარი: <b id="dcTv">50.00</b></label><input type="range" id="dcT" min="2" max="98" step="0.5" value="50"></div>' +
      '<div class="mines-info"><div><small>შანსი</small><b id="dcCh">50%</b></div><div><small>მამრავლი</small><b id="dcMu">×1.94</b></div></div>' +
      '<button class="btn primary wide" id="dcGo">გაგორება</button>' + fairLink() + '</div>' +
      '<div class="g-board"><div class="dice-wrap"><div class="dice-num num" id="dcNum">50.00</div>' +
      '<div class="dice-track" id="dcTrack"><span class="dz" id="dcZone"></span><span class="dm" id="dcMark"><i></i></span></div>' +
      '<div class="dice-scale"><span>0</span><span>25</span><span>50</span><span>75</span><span>100</span></div>' +
      '<div class="g-msg" id="dcMsg">აირჩიე ზღვარი და გააგორე</div><div class="crash-hist" id="dcHist"></div></div></div></div>';
    const getBet = wireBet(root, 'dice');
    let dir = 'u', busy = false;
    const T = $('#dcT', root), zone = $('#dcZone', root), mark = $('#dcMark', root), num = $('#dcNum', root), m = $('#dcMsg', root), go = $('#dcGo', root);
    const hist = [];
    const chance = () => (dir === 'u' ? +T.value : 99.99 - +T.value);
    const mult = () => Math.floor((97 / chance()) * 100) / 100;
    function sync() {
      const t = +T.value;
      $('#dcTv', root).textContent = t.toFixed(2);
      $('#dcCh', root).textContent = chance().toFixed(2) + '%';
      $('#dcMu', root).textContent = '×' + mult().toFixed(2);
      zone.style.left = dir === 'u' ? '0%' : t + '%';
      zone.style.width = (dir === 'u' ? t : 100 - t) + '%';
    }
    T.addEventListener('input', sync);
    root.querySelectorAll('#dcDir button').forEach((b) => b.addEventListener('click', () => {
      dir = b.dataset.d;
      root.querySelectorAll('#dcDir button').forEach((x) => x.classList.toggle('on', x === b));
      sync();
    }));
    sync();
    go.addEventListener('click', async () => {
      if (busy) return;
      const bet = getBet();
      if (!check(bet)) return;
      busy = true; go.disabled = true;
      num.className = 'dice-num num';
      Z.sfx && Z.sfx('roll');
      let spinning = true;
      (function spin() { if (!spinning) return; num.textContent = (Z.rand() * 100).toFixed(2); requestAnimationFrame(spin); })();
      const t0 = performance.now();
      const r = await play('game_dice', { bet, target: +T.value, dir });
      if (!r) { spinning = false; busy = false; go.disabled = false; num.textContent = '—'; return; }
      hold(r.pay);
      await Z.sleep(Math.max(0, (reduce() ? 0 : 650) - (performance.now() - t0)));
      spinning = false;
      release(r.pay);
      const roll = +r.roll, win = !!r.win;
      num.textContent = roll.toFixed(2);
      num.classList.add(win ? 'pos' : 'neg');
      num.animate([{ transform: 'scale(1.18)' }, { transform: 'scale(1)' }], { duration: 400, easing: 'cubic-bezier(.34,1.56,.64,1)' });
      mark.style.left = roll + '%';
      mark.classList.toggle('w', win); mark.classList.toggle('l', !win);
      msg(m, win ? 'მოიგე ×' + (+r.m).toFixed(2) + ' — +' + Z.fmt(r.pay - r.bet) : 'წააგე ' + Z.fmt(r.bet) + ' კოინი', win ? 'win' : 'loss');
      if (win) Z.celebrate(num, r.pay - r.bet);
      hist.unshift({ roll, win }); if (hist.length > 10) hist.pop();
      $('#dcHist', root).innerHTML = hist.map((h) => '<span class="' + (h.win ? 'hi' : 'lo') + '">' + h.roll.toFixed(2) + '</span>').join('');
      busy = false; go.disabled = false;
    });
  }

  /* ---------- plinko ---------- */
  const PL = {
    low: [10, 3, 1.4, 1.1, 1, 0.4, 1, 1.1, 1.4, 3, 10],
    med: [22, 5, 2, 1.3, 0.6, 0.4, 0.6, 1.3, 2, 5, 22],
    high: [76, 10, 3, 0.8, 0.3, 0.2, 0.3, 0.8, 3, 10, 76],
  };
  function mountPlinko(root) {
    const N = 10;
    root.innerHTML = head('Plinko', 'ბურთი ეცემა ლურსმნებს შორის და ჩავარდება ერთ-ერთ უჯრაში. კიდურა უჯრები იშვიათია, მაგრამ ყველაზე ძვირი. შეგიძლია რამდენიმე ბურთი ერთად გააგდო.') +
      '<div class="g-layout"><div class="g-ctrl">' + betField('plinko') +
      '<div class="field"><span class="field-lbl">რისკი</span><div class="seg" id="plRisk"><button type="button" data-r="low">დაბალი</button><button type="button" data-r="med" class="on">საშუალო</button><button type="button" data-r="high">მაღალი</button></div></div>' +
      '<button class="btn primary wide" id="plGo">ბურთის გაგდება</button>' +
      '<div class="mines-info"><div><small>ბოლო შედეგი</small><b id="plLast">—</b></div><div><small>ბურთი ჰაერში</small><b id="plAir">0</b></div></div>' + fairLink() + '</div>' +
      '<div class="g-board plinko-board"><canvas id="plCv"></canvas></div></div>';
    const getBet = wireBet(root, 'plinko');
    const cv = $('#plCv', root), ctx = cv.getContext('2d'), go = $('#plGo', root);
    let risk = 'med', balls = [], W = 0, H = 0, raf = 0, pending = 0;
    const flashPeg = new Map(), flashBin = new Map();
    root.querySelectorAll('#plRisk button').forEach((b) => b.addEventListener('click', () => {
      if (balls.length || pending) { Z.toast('დაელოდე, სანამ ბურთები ჩავარდება.'); return; }
      risk = b.dataset.r;
      root.querySelectorAll('#plRisk button').forEach((x) => x.classList.toggle('on', x === b));
      draw(performance.now());
    }));
    const geo = () => {
      const gap = Math.min(W / (N + 3), (H - 70) / (N + 1.2));
      const dy = gap * 0.92;
      const cx = W / 2, y0 = 26;
      return { gap, dy, cx, y0, binY: y0 + (N - 1) * dy + dy * 0.75 };
    };
    const pegPos = (g, r, j) => ({ x: g.cx + (j - (r + 2) / 2) * g.gap, y: g.y0 + r * g.dy });
    const hitPos = (g, r, k) => ({ x: g.cx + (k - r / 2) * g.gap, y: g.y0 + r * g.dy });
    function size() {
      const r = cv.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1);
      W = r.width; H = r.height; cv.width = Math.max(10, W * d); cv.height = Math.max(10, H * d);
      ctx.setTransform(d, 0, 0, d, 0, 0);
      draw(performance.now());
    }
    new ResizeObserver(size).observe(cv);
    function binCol(v) { return v >= 10 ? css('--t-h') : v >= 2 ? css('--t-m') : v >= 1 ? css('--t-g') : css('--surface-3'); }
    function draw(now) {
      if (!W) return;
      const g = geo();
      ctx.clearRect(0, 0, W, H);
      const pr = Math.max(2.5, g.gap * 0.09);
      for (let r = 0; r < N; r++) for (let j = 0; j < r + 3; j++) {
        const p = pegPos(g, r, j), f = flashPeg.get(r + ':' + j);
        const k = f ? Math.max(0, 1 - (now - f) / 350) : 0;
        ctx.beginPath(); ctx.arc(p.x, p.y, pr + k * 2.5, 0, Math.PI * 2);
        ctx.fillStyle = k > 0 ? css('--gold-hi') : css('--ink-3'); ctx.fill();
      }
      const mults = PL[risk];
      const bw = g.gap - 4, bh = Math.max(22, g.gap * 0.7);
      ctx.font = '700 ' + Math.max(9, Math.min(12, g.gap * 0.28)) + 'px Unbounded, system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (let k = 0; k <= N; k++) {
        const x = g.cx + (k - N / 2) * g.gap, f = flashBin.get(k);
        const kk = f ? Math.max(0, 1 - (now - f) / 500) : 0;
        const y = g.binY + kk * 6;
        ctx.fillStyle = binCol(mults[k]);
        ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x - bw / 2, y, bw, bh, 6); else ctx.rect(x - bw / 2, y, bw, bh); ctx.fill();
        ctx.fillStyle = mults[k] >= 1 ? (Z.isDark && Z.isDark() ? '#0E1015' : '#fff') : css('--ink');
        ctx.fillText(mults[k] + '', x, y + bh / 2 + 1);
      }
      const br = Math.max(4, g.gap * 0.17);
      for (const b of balls) {
        const pos = ballPos(b, g, now);
        const rg = ctx.createRadialGradient(pos.x - br / 3, pos.y - br / 3, 1, pos.x, pos.y, br);
        rg.addColorStop(0, css('--gold-hi')); rg.addColorStop(1, css('--gold-lo'));
        ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(pos.x, pos.y, br, 0, Math.PI * 2); ctx.fill();
      }
    }
    const SEGMS = 120;
    function ballPos(b, g, now) {
      const t = (now - b.t0) / SEGMS;
      const seg = Math.floor(t), f = t - seg;
      const pt = (i) => {
        if (i < 0) return { x: g.cx, y: g.y0 - g.dy };
        if (i >= N) return { x: g.cx + (b.k[N] - N / 2) * g.gap, y: g.binY + 6 };
        const p = hitPos(g, i, b.k[i]);
        return { x: p.x, y: p.y - g.gap * 0.28 };
      };
      if (seg > N) return pt(N);
      const a = pt(seg - 1), c = pt(seg);
      return { x: a.x + (c.x - a.x) * f, y: a.y + (c.y - a.y) * f * f - Math.sin(Math.PI * f) * g.dy * 0.25 };
    }
    function loop(now) {
      for (const b of balls) {
        const seg = Math.floor((now - b.t0) / SEGMS);
        while (b.hit < seg && b.hit < N) { if (b.hit >= 0) { flashPeg.set(b.hit + ':' + (b.k[b.hit] + 1), now); Z.sfx && Z.sfx('tick'); } b.hit++; }
        if (seg > N && !b.done) {
          b.done = true;
          flashBin.set(b.bin, now);
          release(b.pay);
          const el = $('#plLast', root);
          el.textContent = '×' + b.m + ' · ' + Z.sfmt(b.pay - b.bet);
          el.className = b.pay - b.bet > 0 ? 'pos' : b.pay - b.bet < 0 ? 'neg' : '';
          if (b.m >= 3) Z.celebrate(cv, b.pay - b.bet);
        }
      }
      balls = balls.filter((b) => !b.done || now - b.t0 < (N + 2) * SEGMS);
      $('#plAir', root).textContent = balls.filter((b) => !b.done).length + pending;
      draw(now);
      if (balls.length || [...flashBin.values(), ...flashPeg.values()].some((t) => now - t < 500)) raf = requestAnimationFrame(loop);
      else raf = 0;
    }
    go.addEventListener('click', async () => {
      const bet = getBet();
      if (balls.filter((b) => !b.done).length + pending >= 12) { Z.toast('ჰაერში უკვე 12 ბურთია.'); return; }
      if (!check(bet)) return;
      pending++;
      const r = await play('game_plinko', { bet, risk });
      pending--;
      if (!r) return;
      hold(r.pay);
      const k = [0];
      for (let i = 0; i < N; i++) k.push(k[i] + r.path[i]);
      balls.push({ k, t0: performance.now() + (reduce() ? -SEGMS * (N + 1) : 0), bet: r.bet, pay: r.pay, m: +r.m, bin: r.bin, hit: -1, done: false });
      if (!raf) raf = requestAnimationFrame(loop);
    });
    Z.onTheme && Z.onTheme(() => draw(performance.now()));
    requestAnimationFrame(size);
  }

  /* ---------- blackjack ---------- */
  function mountBJ(root) {
    root.innerHTML = head('ბლექჯეკი', 'მიუახლოვდი 21-ს ისე, რომ არ გადააჭარბო. დილერი ჩერდება 17-ზე. ბლექჯეკი იხდის 3:2, გაორმაგება შესაძლებელია პირველ ორ კარტზე.') +
      '<div class="g-layout"><div class="g-ctrl">' + betField('bj') +
      '<button class="btn primary wide" id="bjDeal">დარიგება</button>' +
      '<div class="bj-acts"><button class="btn" id="bjHit" disabled>კარტი</button><button class="btn" id="bjStand" disabled>გაჩერება</button><button class="btn" id="bjDbl" disabled>×2</button></div>' +
      '<p class="muted" style="margin:0;font-size:.8rem">მოგება ×2 · ბლექჯეკი ×2.5 · ფრე: ფსონი ბრუნდება</p>' + fairLink() + '</div>' +
      '<div class="g-board bj-board"><div class="bj-table"><div class="bj-side"><span class="bj-lbl">დილერი <b id="bjDv">—</b></span><div class="bj-hand" id="bjD"></div></div>' +
      '<div class="g-msg" id="bjMsg">ფსონი დადე და დაარიგე</div>' +
      '<div class="bj-side"><div class="bj-hand" id="bjP"></div><span class="bj-lbl">შენ <b id="bjPv">—</b></span></div></div></div></div>';
    const getBet = wireBet(root, 'bj');
    const dEl = $('#bjD', root), pEl = $('#bjP', root), m = $('#bjMsg', root);
    const bDeal = $('#bjDeal', root), bHit = $('#bjHit', root), bStand = $('#bjStand', root), bDbl = $('#bjDbl', root);
    let P = [], D = [], gid = null, bet = 0, state = 'idle';
    const val = (h) => {
      let t = 0, a = 0;
      for (const c of h) { const r = c.v % 13; if (r === 0) { t += 11; a++; } else t += r >= 9 ? 10 : r + 1; }
      while (t > 21 && a) { t -= 10; a--; }
      return t;
    };
    function cardEl(c, back) {
      const red = c.s === '♥' || c.s === '♦';
      const el = document.createElement('div');
      el.className = 'pcard' + (red ? ' red' : '') + (back ? ' back' : '');
      el.innerHTML = '<span class="pc-in"><span class="pc-f"><b>' + c.r + '</b><i>' + c.s + '</i><em>' + c.s + '</em></span><span class="pc-b"></span></span>';
      if (!reduce()) el.animate([{ transform: 'translate(160px,-140px) rotate(25deg)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' });
      return el;
    }
    const wait = (ms) => new Promise((r) => setTimeout(r, reduce() ? 0 : ms));
    function totals(hole) {
      $('#bjPv', root).textContent = P.length ? val(P) : '—';
      $('#bjDv', root).textContent = D.length ? (hole ? val([D[0]]) + ' + ?' : val(D)) : '—';
    }
    function buttons() {
      const pl = state === 'player';
      bHit.disabled = !pl; bStand.disabled = !pl;
      bDbl.disabled = !(pl && P.length === 2 && Z.dispBal() >= bet);
      bDeal.disabled = state === 'busy' || pl;
    }
    async function addTo(handEl, list, cards, back) {
      for (const v of cards) { const c = Z.cardOf(v); list.push(c); Z.sfx && Z.sfx('card'); handEl.appendChild(cardEl(c, back)); await wait(240); }
    }
    async function finish(r) {
      // reveal the dealer's hand card by card
      const hole = dEl.querySelector('.back');
      if (hole) { hole.remove(); D.pop(); }
      await addTo(dEl, D, r.d.slice(D.length));
      totals(false);
      release(r.pay);
      state = 'done';
      const net = r.pay - r.bet;
      const text = { bj: 'ბლექჯეკი! +' + Z.fmt(net), win: 'მოიგე +' + Z.fmt(net), dbust: 'დილერმა გადააჭარბა — მოიგე +' + Z.fmt(net), push: 'ფრე — ფსონი დაგიბრუნდა', lose: 'დილერმა მოიგო · ' + Z.fmt(-r.bet), bust: 'გადააჭარბე 21-ს · ' + Z.fmt(-r.bet) }[r.kind] || '';
      msg(m, text, net > 0 ? 'win' : net < 0 ? 'loss' : '');
      if (net > 0) Z.celebrate(pEl, net);
      bDeal.textContent = 'ახალი დარიგება';
      buttons();
    }
    async function show(r, fresh) {
      gid = r.id; bet = r.bet;
      if (fresh) {
        P = []; D = []; dEl.innerHTML = ''; pEl.innerHTML = '';
        state = 'busy'; buttons(); msg(m, 'ირიგება…');
        const p = r.p.slice(), d = r.d.slice();
        await addTo(pEl, P, [p[0]]); await addTo(dEl, D, [d[0]]); await addTo(pEl, P, [p[1]]);
        if (r.status === 'done') { await addTo(dEl, D, [d[1] ?? 0], true); totals(true); await wait(300); return finish(r); }
        await addTo(dEl, D, [0], true);
        totals(true);
      } else {
        await addTo(pEl, P, r.p.slice(P.length));
        totals(true);
        if (r.status === 'done') return finish(r);
      }
      state = 'player'; buttons(); msg(m, 'კარტი თუ გაჩერება?');
    }
    bDeal.addEventListener('click', async () => {
      if (state !== 'idle' && state !== 'done') return;
      const b = getBet();
      if (!check(b)) return;
      state = 'busy'; buttons();
      const r = await play('game_bj_start', { bet: b });
      if (!r) { state = 'idle'; buttons(); const old = await resume('bj'); if (old) restore(old); return; }
      if (r.status === 'done') hold(r.pay);
      await show(r, true);
    });
    async function act(a) {
      if (state !== 'player') return;
      state = 'busy'; buttons();
      const r = await play('game_bj_act', { id: gid, act: a });
      if (!r) { state = 'player'; buttons(); return; }
      if (r.status === 'done') hold(r.pay);
      await show(r, false);
    }
    bHit.addEventListener('click', () => act('hit'));
    bStand.addEventListener('click', () => act('stand'));
    bDbl.addEventListener('click', () => act('double'));
    function restore(r) {
      gid = r.id; bet = r.bet; P = []; D = []; dEl.innerHTML = ''; pEl.innerHTML = '';
      for (const v of r.state.p) { const c = Z.cardOf(v); P.push(c); pEl.appendChild(cardEl(c)); }
      const d0 = Z.cardOf(r.state.d[0]); D.push(d0); dEl.appendChild(cardEl(d0));
      D.push(Z.cardOf(0)); dEl.appendChild(cardEl(Z.cardOf(0), true));
      totals(true); state = 'player'; buttons(); msg(m, 'გააგრძელე დაწყებული ხელი');
    }
    resume('bj').then((r) => { if (r && r.state && state === 'idle') restore(r); });
  }

  Z.GAMES.push(
    { k: 'plinko', name: 'Plinko', desc: 'ლურსმნები და ×76-მდე უჯრები', icon: ICONS.plinko, mount: mountPlinko },
    { k: 'bj', name: 'ბლექჯეკი', desc: 'დილერის წინააღმდეგ 21-მდე', icon: ICONS.bj, mount: mountBJ },
    { k: 'dice', name: 'კამათელი', desc: 'შენ ირჩევ შანსს და მამრავლს', icon: ICONS.dice, mount: mountDice },
  );
})();
