/* ზარაფხანა — live shared rocket (rounds run on the server) and player-vs-player duels */
(function () {
  const Z = window.Z;
  const S = Z.state;
  const { betField, wireBet, check, msg, head, $, css, reduce } = Z.gameKit;

  const ICONS = {
    live: '<svg viewBox="0 0 24 24"><path d="M3 20c6 0 11-3 15-13" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><circle cx="18.5" cy="6" r="2.6" fill="currentColor"/><circle cx="6" cy="6" r="2" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="11" cy="4" r="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
    duel: '<svg viewBox="0 0 24 24"><path d="M4 4l9 9M4 4h4M4 4v4M20 4l-9 9M20 4h-4M20 4v4M7.5 16.5l-3 3M16.5 16.5l3 3M9 15l-3-3M15 15l3-3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };

  /* =================== live rocket =================== */
  function mountLive(root) {
    const K = 0.11;
    root.innerHTML = head('ცოცხალი რაკეტა', 'ერთი რაკეტა ყველასთვის: ფსონს დებ ფრენამდე და იღებ აფეთქებამდე. ხედავ, ვინ რამდენი დადო და რა მამრავლზე აიღო. აფეთქების წერტილი სერვერზე წინასწარაა დაშიფრული.') +
      '<div class="g-layout"><div class="g-ctrl">' + betField('live') +
      '<div class="field"><label class="field-lbl" for="lvAuto">ავტო-აღება (ცარიელი = გამორთული)</label><input type="number" id="lvAuto" min="1.01" step="0.01" inputmode="decimal" placeholder="2.00"></div>' +
      '<button class="btn primary wide" id="lvGo" disabled>დაელოდე რაუნდს</button>' +
      '<div class="live-online"><span class="live-dot"></span><b id="lvOn">0</b> ფსონი · რაუნდი <b id="lvN">—</b></div>' +
      '<div class="field"><span class="field-lbl">ამ რაუნდის ფსონები</span><ul class="lv-bets" id="lvBets"></ul></div>' +
      '<div class="field"><span class="field-lbl">ბოლო აფეთქებები</span><div class="crash-hist" id="lvHist"></div></div>' +
      '<p class="muted note" id="lvHash" style="word-break:break-all;margin:0"></p></div>' +
      '<div class="g-board crash-board"><canvas id="lvCv"></canvas><div class="crash-mult" id="lvMult">×1.00</div>' +
      '<div class="lv-phase" id="lvPhase"><span id="lvPhaseT">კავშირი…</span><i><b id="lvBar"></b></i></div></div></div>';
    const getBet = wireBet(root, 'live');
    const cv = $('#lvCv', root), ctx = cv.getContext('2d'), go = $('#lvGo', root), mEl = $('#lvMult', root), autoIn = $('#lvAuto', root);
    autoIn.value = Z.store.get('zar-live-auto', '');
    autoIn.addEventListener('change', () => Z.store.set('zar-live-auto', autoIn.value));
    let L = null, bets = [], hist = [], polling = false, lastPoll = 0, lastBoomN = null, busy = false;
    const mine = () => bets.find((b) => b.user_id === S.myId);
    const phase = (now) => !L ? 'wait' : L.done ? 'boom' : now < L.start_at ? 'bet' : 'fly';
    async function poll() {
      if (polling) return;
      polling = true; lastPoll = performance.now();
      try {
        const st = await Z.api('live_state', {}, { quiet: true });
        if (st && st.round) {
          if (L && L.n === st.round.n && !L.done && st.round.done) Z.refreshMine(['quests'], 800);
          L = st.round; L.start_at = +L.start_at; bets = st.bets || []; hist = st.hist || [];
          renderSide();
        }
      } catch (e) {}
      polling = false;
    }
    function renderSide() {
      const list = bets.slice().sort((a, b) => b.a - a.a);
      $('#lvBets', root).innerHTML = list.length ? list.slice(0, 14).map((b, i) => {
        const st = b.m ? '<b class="pos">×' + (+b.m).toFixed(2) + ' · +' + Z.fmt(Math.floor(b.a * b.m) - b.a) + '</b>' : L && L.done ? '<b class="neg">' + Z.sfmt(-b.a) + '</b>' : '<b class="muted">' + (b.auto ? 'ავტო ×' + (+b.auto).toFixed(2) : 'ფრენაშია') + '</b>';
        return '<li class="' + (b.user_id === S.myId ? 'me' : '') + '" style="--k:' + i + '">' + Z.av(b.user_id) + '<span class="nm">' + Z.nm(b.user_id) + '<small>' + Z.fmt(b.a) + ' კოინი</small></span>' + st + '</li>';
      }).join('') : '<li class="muted empty-li">ჯერ არავის დაუდია</li>';
      $('#lvN', root).textContent = L ? '#' + L.n : '—';
      $('#lvOn', root).textContent = bets.length;
      $('#lvHist', root).innerHTML = hist.map((x) => '<span class="' + (x >= 2 ? 'hi' : 'lo') + '">×' + (+x).toFixed(2) + '</span>').join('');
      $('#lvHash', root).textContent = L ? (L.done ? 'რაუნდის გასაღები: ' + (L.seed || '') : 'რაუნდის დაშიფრული ანაბეჭდი: ' + (L.hash || '')) : '';
    }
    function size() {
      const r = cv.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
      cv.width = Math.max(10, r.width * dpr); cv.height = Math.max(10, r.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    new ResizeObserver(size).observe(cv);
    function paint(t, boom) {
      const W = cv.clientWidth, H = cv.clientHeight;
      ctx.clearRect(0, 0, W, H);
      const m = Math.exp(K * t), xMax = Math.max(8, t * 1.18), yMax = Math.max(2, m * 1.25);
      const pad = { l: 44, r: 18, t: 18, b: 46 };
      const X = (s) => pad.l + (s / xMax) * (W - pad.l - pad.r);
      const Y = (v) => H - pad.b - ((v - 1) / (yMax - 1)) * (H - pad.t - pad.b);
      ctx.font = '600 11px "IBM Plex Mono", monospace'; ctx.fillStyle = css('--ink-3'); ctx.strokeStyle = css('--line'); ctx.lineWidth = 1;
      [1, 1.5, 2, 3, 5, 10, 20, 50, 100].filter((v) => v <= yMax).forEach((v) => { const y = Y(v); ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke(); ctx.fillText('×' + v, 6, y + 4); });
      if (t <= 0) return;
      const col = boom ? css('--loss') : css('--gold');
      ctx.beginPath(); ctx.moveTo(X(0), Y(1));
      for (let i = 1; i <= 80; i++) { const s = (t * i) / 80; ctx.lineTo(X(s), Y(Math.exp(K * s))); }
      ctx.strokeStyle = col; ctx.lineWidth = 3.5; ctx.lineCap = 'round'; ctx.stroke();
      for (const b of bets) if (b.m) {
        const s = Math.log(b.m) / K; if (s > t) continue;
        ctx.fillStyle = b.user_id === S.myId ? css('--gold-hi') : css('--win');
        ctx.beginPath(); ctx.arc(X(s), Y(b.m), b.user_id === S.myId ? 6 : 4, 0, Math.PI * 2); ctx.fill();
      }
      if (!boom) {
        const hx = X(t), hy = Y(m);
        ctx.save(); ctx.shadowColor = col; ctx.shadowBlur = 18;
        const rg = ctx.createRadialGradient(hx - 3, hy - 3, 1, hx, hy, 11);
        rg.addColorStop(0, css('--gold-hi')); rg.addColorStop(1, css('--gold-lo'));
        ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(hx, hy, 10, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      }
    }
    go.addEventListener('click', async () => {
      if (busy || !L) return;
      const now = Z.now(), ph = phase(now), my = mine();
      if (ph === 'bet' && !my) {
        const a = getBet();
        if (!check(a)) return;
        const auto = parseFloat(autoIn.value);
        busy = true;
        try { await Z.api('live_bet', { n: L.n, a, auto: auto > 1 ? auto : null }, { lazy: true }); Z.sfx && Z.sfx('coin'); bets.push({ n: L.n, user_id: S.myId, a, auto: auto > 1 ? auto : null }); renderSide(); poll(); }
        catch (e) { Z.toast(Z.errText(e), 'loss'); }
        busy = false;
      } else if (ph === 'fly' && my && !my.m) {
        busy = true;
        try {
          const r = await Z.api('live_cash', { n: L.n }, { lazy: true, also: ['quests'] });
          if (r && r.m) { my.m = r.m; Z.toast('აიღე ×' + (+r.m).toFixed(2) + ' · +' + Z.fmt(r.pay - my.a) + ' კოინი', 'win'); Z.celebrate(mEl, r.pay - my.a); mEl.classList.add('cash'); }
          else Z.toast('რაკეტა უკვე აფეთქდა.', 'loss');
          poll();
        } catch (e) { Z.toast(Z.errText(e), 'loss'); }
        busy = false;
      }
    });
    let lastRender = 0;
    function frame(t0) {
      requestAnimationFrame(frame);
      if (root.offsetParent === null || Z.view !== 'games') return;
      const now = Z.now(), ph = phase(now);
      const due = ph === 'fly' ? 600 : ph === 'bet' ? 1500 : 900;
      if (performance.now() - lastPoll > due) poll();
      const pt = $('#lvPhaseT', root), bar = $('#lvBar', root), my = mine();
      if (ph === 'bet') {
        const left = Math.max(0, L.start_at - now);
        pt.textContent = 'ფსონების მიღება · ' + (left / 1000).toFixed(1) + 'წ';
        bar.style.width = (100 - (left / 7000) * 100) + '%';
        mEl.className = 'crash-mult'; mEl.textContent = '×1.00';
        paint(0);
      } else if (ph === 'fly') {
        const t = (now - L.start_at) / 1000, m = Math.exp(K * t);
        pt.textContent = 'ფრენა'; bar.style.width = '100%';
        mEl.textContent = '×' + m.toFixed(2);
        paint(t);
      } else if (ph === 'boom') {
        const c = +L.crash || 1;
        pt.textContent = 'აფეთქდა · შემდეგი რაუნდი მალე'; bar.style.width = '0%';
        mEl.textContent = '×' + c.toFixed(2); mEl.className = 'crash-mult boom';
        if (lastBoomN !== L.n) { lastBoomN = L.n; Z.sfx && Z.sfx('boom'); if (my && !my.m) Z.toast('რაკეტა აფეთქდა ×' + c.toFixed(2) + '-ზე. წააგე ' + Z.fmt(my.a) + '.', 'loss'); }
        paint(Math.log(c) / K || 0.001, true);
      } else { pt.textContent = 'რაუნდი იწყება…'; paint(0); }
      if (ph === 'bet') { go.disabled = !!my || busy; go.textContent = my ? 'ფსონი დადებულია · ' + Z.fmt(my.a) : 'ფსონის დადება'; go.className = 'btn primary wide'; }
      else if (ph === 'fly' && my && !my.m) { go.disabled = busy; go.textContent = 'აიღე ' + Z.fmt(Math.floor(my.a * Math.exp(K * (now - L.start_at) / 1000))) + ' კოინი'; go.className = 'btn win wide'; }
      else { go.disabled = true; go.textContent = ph === 'fly' ? (my ? 'აღებულია' : 'დაელოდე შემდეგ რაუნდს') : 'დაელოდე რაუნდს'; go.className = 'btn primary wide'; }
      if (t0 - lastRender > 1000) { lastRender = t0; renderSide(); }
    }
    requestAnimationFrame(frame);
    poll();
  }

  /* =================== duels =================== */
  const shownKey = 'zar-duel-shown';
  Z.duelShow = (doc) => {
    if (!doc || doc.st !== 'done') return;
    const shown = new Set(Z.store.get(shownKey, []));
    shown.add(doc.id); Z.store.set(shownKey, [...shown].slice(-60));
    const meWin = doc.w === S.myId, involved = doc.f === S.myId || doc.a === S.myId;
    const side = (pid, cls) => '<div class="dv-side ' + cls + '" id="dv-' + cls + '">' + Z.av(pid, 'big') + '<b>' + Z.nm(pid) + '</b><span class="dv-roll" id="dvr-' + cls + '">?</span></div>';
    Z.openModal('<div class="duel-show"><p class="eyebrow">დუელი · ' + (doc.g === 'dice' ? 'კამათელი' : 'ქოინის აგდება') + ' · ' + Z.fmt(doc.s) + ' კოინი</p>' +
      '<div class="dv-row">' + side(doc.f, 'f') + '<div class="dv-mid">' + (doc.g === 'dice' ? '<span class="vs">VS</span>' : '<div class="flip-stage sm"><div class="flip-coin" id="dvCoin"><div class="side heads">ზ</div><div class="side tails"><svg><use href="#i-borj"/></svg></div></div></div>') + '</div>' + side(doc.a, 'a') + '</div>' +
      '<h2 id="modalTitle" class="dv-res">…</h2><p class="muted dv-note">' + (doc.g === 'flip' ? 'გამომწვევი არის „ზ“, მიმღები — „ბორჯღალი“.' : 'მეტი ჯამი იგებს.') + '</p></div>');
    const res = $('.dv-res'), dur = reduce() ? 10 : 1800, r = doc.r || {};
    if (doc.g === 'flip') {
      const coin = $('#dvCoin'), rot = 360 * 6 + (r.side === 'z' ? 0 : 180);
      Z.sfx && Z.sfx('roll');
      coin.animate([{ transform: 'rotateY(0) translateY(0)' }, { transform: 'rotateY(' + rot * 0.55 + 'deg) translateY(-50px) scale(1.15)', offset: 0.45 }, { transform: 'rotateY(' + rot + 'deg)' }], { duration: dur, easing: 'cubic-bezier(.3,.7,.25,1)', fill: 'forwards' });
      $('#dvr-f').textContent = 'ზ'; $('#dvr-a').textContent = 'ბორჯღალი';
    } else {
      const t0 = performance.now(); Z.sfx && Z.sfx('roll');
      (function spin(n) {
        const done = n - t0 >= dur;
        $('#dvr-f').textContent = done ? r.fa.join(' + ') + ' = ' + (r.fa[0] + r.fa[1]) : 1 + Z.randInt(6) + ' + ' + (1 + Z.randInt(6));
        $('#dvr-a').textContent = done ? r.aa.join(' + ') + ' = ' + (r.aa[0] + r.aa[1]) : 1 + Z.randInt(6) + ' + ' + (1 + Z.randInt(6));
        if (!done) requestAnimationFrame(spin);
      })(t0);
    }
    setTimeout(() => {
      const wcls = doc.w === doc.f ? 'f' : 'a';
      const wEl = $('#dv-' + wcls); if (wEl) wEl.classList.add('won');
      const lEl = $('#dv-' + (wcls === 'f' ? 'a' : 'f')); if (lEl) lEl.classList.add('lost');
      res.textContent = involved ? (meWin ? 'მოიგე +' + Z.fmt(doc.s) + ' კოინი!' : 'წააგე ' + Z.fmt(doc.s) + ' კოინი') : Z.realName(doc.w) + ' მოიგო';
      res.className = 'dv-res ' + (involved ? (meWin ? 'pos' : 'neg') : '');
      if (meWin) Z.celebrate(wEl, doc.s * 2); else if (involved) Z.sfx && Z.sfx('lose');
    }, dur + 100);
  };
  // someone accepted my challenge while I was here
  Z.onDuel = (d) => {
    if (d.st !== 'done' || d.f !== S.myId) return;
    const shown = new Set(Z.store.get(shownKey, []));
    if (!shown.has(d.id) && Z.now() - d.ta < 10 * 60e3 && document.getElementById('modal').hidden) setTimeout(() => Z.duelShow(d), 300);
  };

  function mountDuel(root) {
    root.innerHTML = head('დუელები', 'გამოიწვიე მოთამაშე ან მიიღე სხვისი გამოწვევა. ორივე ერთნაირ ფსონს დებთ და გამარჯვებული ორივეს იღებს. საკომისიო არ არის.') +
      '<div class="g-layout"><div class="g-ctrl">' +
      '<div class="field"><span class="field-lbl">თამაშის სახეობა</span><div class="seg" id="duG"><button type="button" data-g="flip" class="on">ქოინი</button><button type="button" data-g="dice">კამათელი</button></div></div>' +
      betField('duel') +
      '<div class="field"><label class="field-lbl" for="duTo">მოწინააღმდეგე</label><div class="search-wrap"><input id="duTo" type="search" placeholder="ნებისმიერი მოთამაშე" autocomplete="off"><ul class="search-res" id="duRes" hidden></ul></div><div class="picked" id="duPick"><span class="muted">ღია გამოწვევა: ნებისმიერს შეუძლია მიღება</span></div></div>' +
      '<button class="btn primary wide" id="duGo">გამოწვევა</button></div>' +
      '<div class="duel-board"><section><h4>ღია გამოწვევები</h4><ul class="duel-list" id="duOpen"></ul></section>' +
      '<section><h4>ჩემი გამოწვევები</h4><ul class="duel-list" id="duMine"></ul></section>' +
      '<section><h4>ბოლო დუელები</h4><ul class="duel-list" id="duDone"></ul></section></div></div>';
    const getBet = wireBet(root, 'duel');
    let g = 'flip', to = null;
    root.querySelectorAll('#duG button').forEach((b) => b.addEventListener('click', () => { g = b.dataset.g; root.querySelectorAll('#duG button').forEach((x) => x.classList.toggle('on', x === b)); }));
    const inp = $('#duTo', root), res = $('#duRes', root);
    const setTo = (pid) => {
      to = pid;
      $('#duPick', root).innerHTML = pid ? Z.av(pid) + '<span><b>' + Z.nm(pid) + '</b><br><small class="muted">მხოლოდ მას შეუძლია მიღება</small></span><button type="button" class="link" id="duClear" style="margin-left:auto">გაუქმება</button>' : '<span class="muted">ღია გამოწვევა: ნებისმიერს შეუძლია მიღება</span>';
      const c = $('#duClear', root); if (c) c.addEventListener('click', () => setTo(null));
    };
    Z.setDuelTarget = (pid) => setTo(pid);
    const list = () => {
      const q = inp.value.trim().toLowerCase();
      const ids = [...S.players.keys()].filter((id) => id !== S.myId && (!q || Z.realName(id).toLowerCase().includes(q))).slice(0, 10);
      res.innerHTML = ids.length ? ids.map((id) => '<li><button type="button" data-id="' + Z.esc(id) + '">' + Z.av(id) + '<span>' + Z.esc(Z.realName(id)) + '</span></button></li>').join('') : '<li class="muted" style="padding:10px">ვერ მოიძებნა</li>';
      res.hidden = false;
    };
    inp.addEventListener('focus', list); inp.addEventListener('input', list);
    res.addEventListener('click', (e) => { const b = e.target.closest('[data-id]'); if (!b) return; res.hidden = true; inp.value = ''; setTo(b.dataset.id); });
    $('#duGo', root).addEventListener('click', async (e) => {
      const s = getBet(), btn = e.currentTarget;
      if (!check(s)) return;
      btn.disabled = true;
      const doc = await Z.createDuel({ g, s, to });
      btn.disabled = false;
      if (doc) { Z.toast('გამოწვევა გამოქვეყნდა · ' + Z.fmt(s) + ' კოინი', 'win'); Z.coinFly(btn, $('#duMine', root), 6); setTo(null); }
    });
    root.addEventListener('click', async (e) => {
      const a = e.target.closest('[data-accept]'), c = e.target.closest('[data-cancel]'), v = e.target.closest('[data-view]');
      if (a) { a.disabled = true; const r = await Z.acceptDuel(+a.dataset.accept); a.disabled = false; if (r && r.id) { const d = { id: r.id, f: r.f, g: r.g, s: +r.s, to: r.target, st: r.st, a: r.a, w: r.w, r: r.r, at: +r.at, ta: +r.ta }; S.duels.set(d.id, d); Z.duelShow(d); } }
      if (c) { c.disabled = true; const ok = await Z.cancelDuel(+c.dataset.cancel); if (ok) Z.toast('გამოწვევა გაუქმდა, ფსონი დაგიბრუნდა.'); else c.disabled = false; }
      if (v) Z.duelShow(S.duels.get(+v.dataset.view));
    });
    const gName = (d) => (d.g === 'dice' ? 'კამათელი' : 'ქოინი');
    function render() {
      if (root.offsetParent === null) return;
      const all = [...S.duels.values()];
      const open = all.filter((d) => d.st === 'open' && d.f !== S.myId && (!d.to || d.to === S.myId)).sort((a, b) => (b.to === S.myId) - (a.to === S.myId) || b.at - a.at);
      const mine = all.filter((d) => d.st === 'open' && d.f === S.myId).sort((a, b) => b.at - a.at);
      const done = all.filter((d) => d.st === 'done' && (d.f === S.myId || d.a === S.myId)).sort((a, b) => b.ta - a.ta).slice(0, 8);
      Z.setHTML($('#duOpen', root), open.length ? open.map((d, i) => '<li class="' + (d.to === S.myId ? 'for-me' : '') + '" style="--k:' + i + '">' + Z.av(d.f) + '<span class="nm">' + Z.nm(d.f) + '<small>' + gName(d) + ' · ' + Z.ago(d.at) + (d.to === S.myId ? ' · შენ გიწვევს' : '') + '</small></span><b class="num">' + Z.fmt(d.s) + '</b><button class="btn primary sm" data-accept="' + d.id + '">მიღება</button></li>').join('') : '<li class="muted empty-li">ღია გამოწვევა არ არის. შექმენი პირველი!</li>');
      Z.setHTML($('#duMine', root), mine.length ? mine.map((d, i) => '<li style="--k:' + i + '">' + (d.to ? Z.av(d.to) : '<span class="av any">?</span>') + '<span class="nm">' + (d.to ? Z.nm(d.to) : 'ნებისმიერი') + '<small>' + gName(d) + ' · ' + Z.ago(d.at) + ' · ელოდება</small></span><b class="num">' + Z.fmt(d.s) + '</b><button class="btn ghost sm" data-cancel="' + d.id + '">გაუქმება</button></li>').join('') : '<li class="muted empty-li">ღია გამოწვევა არ გაქვს</li>');
      Z.setHTML($('#duDone', root), done.length ? done.map((d, i) => { const other = d.f === S.myId ? d.a : d.f, w = d.w === S.myId; return '<li style="--k:' + i + '">' + Z.av(other) + '<span class="nm">' + Z.nm(other) + '<small>' + gName(d) + ' · ' + Z.ago(d.ta) + '</small></span><b class="num ' + (w ? 'pos' : 'neg') + '">' + (w ? '+' : '−') + Z.fmt(d.s) + '</b><button class="btn ghost sm" data-view="' + d.id + '">ნახვა</button></li>'; }).join('') : '<li class="muted empty-li">დუელი ჯერ არ გქონია</li>');
    }
    Z.on(render);
    render();
  }

  Z.GAMES.push(
    { k: 'live', name: 'ცოცხალი რაკეტა', desc: 'ერთი რაკეტა ყველასთვის', icon: ICONS.live, mount: mountLive },
    { k: 'duel', name: 'დუელები', desc: 'მოთამაშე მოთამაშის წინააღმდეგ', icon: ICONS.duel, mount: mountDuel },
  );
})();
