/* ზარაფხანა — Texas hold'em: lobby and table (the dealer runs on the server) */
(function () {
  const Z = window.Z;
  const S = Z.state;
  const { head, $, reduce } = Z.gameKit;
  const ICON = '<svg viewBox="0 0 24 24"><path d="M12 3c3 3.5 7 6 7 9.5a3.5 3.5 0 0 1-6 2.4c.2 1.8.8 3.3 2 5.1H9c1.2-1.8 1.8-3.3 2-5.1a3.5 3.5 0 0 1-6-2.4C5 9 9 6.5 12 3Z" fill="currentColor"/></svg>';
  const SUIT = { s: '♠', h: '♥', d: '♦', c: '♣' };
  const RN = { T: '10' };
  const HANDS = ['მაღალი კარტი', 'წყვილი', 'ორი წყვილი', 'სამეული', 'სტრიტი', 'ფლეში', 'ფულ ჰაუსი', 'კარე', 'სტრიტ ფლეში'];
  Z.handName = (score) => HANDS[Math.floor(+score / Math.pow(16, 5))] || '';
  const card = (c, cls) => {
    if (!c) return '<div class="pcard back ' + (cls || '') + '"><span class="pc-in"><span class="pc-f"></span><span class="pc-b"></span></span></div>';
    const r = RN[c[0]] || c[0], s = SUIT[c[1]], red = c[1] === 'h' || c[1] === 'd';
    return '<div class="pcard ' + (red ? 'red ' : '') + (cls || '') + '"><span class="pc-in"><span class="pc-f"><b>' + r + '</b><i>' + s + '</i><em>' + s + '</em></span><span class="pc-b"></span></span></div>';
  };
  const LAST = { SB: 'მცირე ბლაინდი', BB: 'დიდი ბლაინდი', fold: 'პასი', check: 'ჩეკი', call: 'კოლი', bet: 'ბეთი', raise: 'რეიზი', allin: 'ვა-ბანკი', win: 'მოიგო' };

  function mount(root) {
    root.innerHTML = head('პოკერი', 'ტეხასური ჰოლდემი ლიმიტის გარეშე, 2–6 მოთამაშე. კარტს სერვერი არიგებს, შენს კარტებს მხოლოდ შენ ხედავ. თამაში იწყება, როცა მაგიდასთან ორი მოთამაშე მაინც ზის.') +
      '<div class="pk" id="pkRoot"><div class="pk-lobby" id="pkLobby"></div><div class="pk-table-wrap" id="pkTableWrap" hidden></div></div>';
    const lobby = $('#pkLobby', root), wrap = $('#pkTableWrap', root);
    let tid = Z.store.get('zar-pk-table', null), st = null, polling = false, lastPoll = 0, lobbyAt = 0, busy = false, lastHand = null;

    async function loadLobby() {
      lobbyAt = performance.now();
      try {
        const l = await Z.api('poker_lobby', {}, { quiet: true });
        Z.setHTML(lobby, '<div class="pk-tables">' + l.map((x, i) => '<div class="pk-tcard" style="--k:' + i + '"><div><b>' + Z.esc(x.t.name) + '</b><small>ბლაინდები ' + Z.fmt(x.t.sb) + ' / ' + Z.fmt(x.t.bb) + ' · შესვლა ' + Z.fmt(x.t.min_buy) + '–' + Z.fmt(x.t.max_buy) + '</small></div>' +
          '<span class="pk-n">' + x.n + ' / ' + x.t.seats + '</span><button class="btn ' + (x.me ? 'primary' : 'ghost') + ' sm" data-open="' + x.t.id + '">' + (x.me ? 'დაბრუნება' : 'გახსნა') + '</button></div>').join('') + '</div>' +
          (l.length ? '' : Z.empty('მაგიდები ჯერ არ არის. ადმინს შეუძლია შექმნა.')));
        const mine = l.find((x) => x.me);
        if (mine && tid == null) open(mine.t.id);
      } catch (e) { lobby.innerHTML = Z.empty(Z.errText(e)); }
    }
    lobby.addEventListener('click', (e) => { const b = e.target.closest('[data-open]'); if (b) open(+b.dataset.open); });
    function open(id) { tid = id; Z.store.set('zar-pk-table', id); lobby.hidden = true; wrap.hidden = false; st = null; wrap.innerHTML = '<div class="skeleton" style="height:22rem"></div>'; poll(); }
    function close() { tid = null; Z.store.set('zar-pk-table', null); wrap.hidden = true; lobby.hidden = false; loadLobby(); }

    async function poll() {
      if (polling || tid == null) return;
      polling = true; lastPoll = performance.now();
      try { st = await Z.api('poker_state', { tid }, { quiet: true }); render(); }
      catch (e) { if (Z.errCode(e) === 'not_found') close(); }
      polling = false;
    }
    async function call(fn, args) {
      if (busy) return;
      busy = true;
      try { st = await Z.api(fn, Object.assign({ tid }, args || {}), { lazy: true, also: ['quests'] }); render(); }
      catch (e) { Z.toast(Z.errText(e), 'loss'); }
      busy = false;
    }
    const me = () => st && st.seats.find((s) => s.user_id === S.myId);

    function render() {
      if (!st || tid == null) return;
      const T = st.table, seats = st.seats, my = me(), n = T.seats, now = Z.now();
      const live = ['preflop', 'flop', 'turn', 'river'].includes(T.stage);
      const bySeat = new Map(seats.map((s) => [s.seat, s]));
      const pos = (i) => { const a = Math.PI / 2 + (i - (my ? my.seat : 0)) * (2 * Math.PI / n); return { x: 50 + 44 * Math.cos(a), y: 50 + 40 * Math.sin(a) }; };
      const last = T.last || {};
      const shown = new Map((last.shown || []).map((x) => [x.seat, x]));
      const showLast = !live && last.hand && now - (+T.next_at - 6000) < 9000;
      let html = '<div class="pk-top"><button class="link" id="pkBack">← მაგიდები</button><b>' + Z.esc(T.name) + '</b><small class="muted">ბლაინდები ' + Z.fmt(T.sb) + '/' + Z.fmt(T.bb) + ' · ხელი #' + T.hand + '</small></div>' +
        '<div class="pk-felt"><div class="pk-oval"></div>' +
        '<div class="pk-center"><div class="pk-board">' + [0, 1, 2, 3, 4].map((i) => (T.board[i] ? card(T.board[i], 'sm') : '<span class="pk-slot"></span>')).join('') + '</div>' +
        '<div class="pk-pot">ბანკი <b class="num">' + Z.fmt(live ? st.pot : showLast ? last.pot : 0) + '</b></div>' +
        (showLast ? '<div class="pk-res">' + Object.entries(last.wins || {}).map(([s, a]) => { const x = shown.get(+s), u = (bySeat.get(+s) || {}).user_id || (x && x.user); return (u ? Z.esc(Z.realName(u)) : 'ადგილი ' + s) + ' +' + Z.fmt(a) + (x ? ' · ' + Z.handName(x.score) : ''); }).join(' · ') + '</div>' : !live ? '<div class="pk-res muted">' + (seats.filter((s) => !s.out_ && s.stack > 0).length < 2 ? 'ელოდება მეორე მოთამაშეს…' : 'შემდეგი ხელი იწყება…') + '</div>' : '') +
        '</div>';
      for (let i = 0; i < n; i++) {
        const s = bySeat.get(i), p = pos(i);
        if (!s) { html += '<button class="pk-seat empty" style="left:' + p.x + '%;top:' + p.y + '%" data-sit="' + i + '"' + (my ? ' disabled' : '') + '>' + (my ? '' : 'დაჯდომა') + '</button>'; continue; }
        const turn = live && T.turn === i, x = shown.get(i), isMe = s.user_id === S.myId;
        const cards = isMe && st.hole ? st.hole.map((c) => card(c, 'sm')).join('') : x && showLast ? x.cards.map((c) => card(c, 'sm')).join('') : s.in_hand && !s.folded ? card(null, 'sm') + card(null, 'sm') : '';
        const left = turn && T.deadline ? Math.max(0, (+T.deadline - now) / 25000) : 0;
        html += '<div class="pk-seat' + (turn ? ' turn' : '') + (s.folded ? ' folded' : '') + (isMe ? ' me' : '') + (s.out_ ? ' out' : '') + '" style="left:' + p.x + '%;top:' + p.y + '%;--left:' + left.toFixed(3) + '">' +
          (T.dealer === i ? '<span class="pk-dealer">D</span>' : '') + '<div class="pk-cards">' + cards + '</div>' + Z.av(s.user_id) +
          '<b class="pk-name">' + Z.esc(isMe ? 'შენ' : Z.realName(s.user_id)) + '</b><span class="pk-stack num">' + Z.fmt(s.stack) + '</span>' +
          (s.last ? '<span class="pk-last">' + (LAST[s.last] || s.last) + '</span>' : '') + (s.out_ ? '<span class="pk-last">გასულია</span>' : '') +
          (live && +s.bet > 0 ? '<span class="pk-bet num">' + Z.fmt(s.bet) + '</span>' : '') + '</div>';
      }
      html += '</div>';
      // my controls
      const myTurn = my && live && T.turn === my.seat;
      const toCall = my ? Math.max(0, +T.cur_bet - +my.bet) : 0;
      const minR = Math.min(+my?.stack + +my?.bet || 0, +T.cur_bet + +T.min_raise);
      html += '<div class="pk-ctrl">';
      if (!my) html += '<p class="muted">აირჩიე თავისუფალი ადგილი მაგიდასთან. შესვლა: ' + Z.fmt(T.min_buy) + '–' + Z.fmt(T.max_buy) + ' კოინი.</p>';
      else {
        html += '<div class="pk-me"><span>შენი სტეკი <b class="num">' + Z.fmt(my.stack) + '</b></span>' + (st.hole ? '<span class="muted">' + (T.board.length >= 3 ? 'ახლა: ' + Z.handName(bestScore(st.hole.concat(T.board))) : '') + '</span>' : '') + '</div>';
        if (myTurn) {
          html += '<div class="pk-acts"><button class="btn danger" data-act="fold">პასი</button>' +
            (toCall ? '<button class="btn" data-act="call">კოლი ' + Z.fmt(Math.min(toCall, my.stack)) + '</button>' : '<button class="btn" data-act="check">ჩეკი</button>') +
            (my.stack > toCall ? '<div class="pk-raise"><input type="range" id="pkR" min="' + minR + '" max="' + (+my.stack + +my.bet) + '" step="' + T.bb + '" value="' + minR + '"><button class="btn primary" data-act="raise" id="pkRb">' + (+T.cur_bet ? 'რეიზი ' : 'ბეთი ') + Z.fmt(minR) + '</button></div>' : '') +
            '<button class="btn win" data-act="allin">ვა-ბანკი</button></div><div class="pk-timer"><i style="width:' + (Math.max(0, (+T.deadline - now) / 25000) * 100).toFixed(1) + '%"></i></div>';
        } else if (live && my.in_hand && !my.folded) html += '<p class="muted">დაელოდე შენს სვლას…</p>';
        html += '<div class="btn-row">' + (my.out_ ? '<button class="btn primary sm" data-x="back">თამაშში დაბრუნება</button>' : '') +
          (!(live && my.in_hand) && +my.stack < +T.max_buy ? '<button class="btn ghost sm" data-x="rebuy">დამატება</button>' : '') +
          '<button class="btn ghost sm" data-x="leave">' + (live && my.in_hand && !my.folded ? 'პასი და ადგომა' : 'ადგომა და კოინების აღება') + '</button></div>';
      }
      html += '</div>';
      const keepR = $('#pkR', wrap) ? $('#pkR', wrap).value : null;
      if (wrap._h !== html) { wrap._h = html; wrap.innerHTML = html; }
      const rr = $('#pkR', wrap);
      if (rr) {
        if (keepR != null && +keepR >= +rr.min && +keepR <= +rr.max) rr.value = keepR;
        const sync = () => { $('#pkRb', wrap).textContent = (+T.cur_bet ? 'რეიზი ' : 'ბეთი ') + Z.fmt(+rr.value); };
        rr.oninput = sync; sync();
      }
      if (live && T.hand !== lastHand) { lastHand = T.hand; Z.sfx && Z.sfx('card'); }
      if (myTurn && !wrap._turnSnd) { wrap._turnSnd = true; Z.sfx && Z.sfx('bell'); }
      if (!myTurn) wrap._turnSnd = false;
    }
    // client-side helper for showing the current hand name
    const RANK = '23456789TJQKA';
    function rank5(c) {
      const r = c.map((x) => RANK.indexOf(x[0]) + 2).sort((a, b) => b - a), s = c.map((x) => x[1]);
      const flush = s.every((x) => x === s[0]);
      const u = [...new Set(r)];
      let straight = false, high = 0;
      if (u.length === 5) { if (u[0] - u[4] === 4) { straight = true; high = u[0]; } else if (u.join() === '14,5,4,3,2') { straight = true; high = 5; } }
      const cnt = {}; r.forEach((x) => (cnt[x] = (cnt[x] || 0) + 1));
      const g = Object.entries(cnt).map(([k, v]) => [+k, v]).sort((a, b) => b[1] - a[1] || b[0] - a[0]);
      let cat = 0, tb = g.map((x) => x[0]);
      if (straight && flush) { cat = 8; tb = [high]; } else if (g[0][1] === 4) cat = 7; else if (g[0][1] === 3 && g[1] && g[1][1] === 2) cat = 6;
      else if (flush) cat = 5; else if (straight) { cat = 4; tb = [high]; } else if (g[0][1] === 3) cat = 3; else if (g[0][1] === 2 && g[1] && g[1][1] === 2) cat = 2; else if (g[0][1] === 2) cat = 1;
      let sc = cat; for (let i = 0; i < 5; i++) sc = sc * 16 + (tb[i] || 0);
      return sc;
    }
    function bestScore(c) {
      let best = -1;
      const n = c.length;
      for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let d = b + 1; d < n; d++) for (let e = d + 1; e < n; e++) for (let f = e + 1; f < n; f++) best = Math.max(best, rank5([c[a], c[b], c[d], c[e], c[f]]));
      return best;
    }
    wrap.addEventListener('click', async (e) => {
      if (e.target.closest('#pkBack')) { close(); return; }
      const sit = e.target.closest('[data-sit]');
      if (sit) {
        const T = st.table, seat = +sit.dataset.sit;
        Z.openModal('<div class="tx"><h2 id="modalTitle">დაჯდომა: ' + Z.esc(T.name) + '</h2><p class="muted">კოინები ბალანსიდან მაგიდაზე გადადის. ადგომისას დარჩენილი ბრუნდება.</p>' +
          '<div class="field"><label class="field-lbl" for="pkBuy">რამდენით შეხვალ (' + Z.fmt(T.min_buy) + '–' + Z.fmt(T.max_buy) + ')</label><input id="pkBuy" type="number" min="' + T.min_buy + '" max="' + T.max_buy + '" value="' + Math.min(T.max_buy, Math.max(T.min_buy, Math.floor(Z.dispBal() / 2))) + '" inputmode="numeric"></div>' +
          '<button class="btn primary wide" id="pkSit">დაჯდომა</button></div>');
        $('#pkSit').addEventListener('click', async () => { const b = Math.floor(+$('#pkBuy').value || 0); Z.closeModal(); await call('poker_sit', { seat, buyin: b }); });
        return;
      }
      const a = e.target.closest('[data-act]');
      if (a) { const amt = a.dataset.act === 'raise' ? Math.floor(+$('#pkR', wrap).value) : 0; await call('poker_act', { act: a.dataset.act, amount: amt }); return; }
      const x = e.target.closest('[data-x]');
      if (!x) return;
      if (x.dataset.x === 'leave') { await call('poker_leave'); if (!me()) Z.toast('ადექი მაგიდიდან, კოინები ბალანსზე დაბრუნდა.'); }
      if (x.dataset.x === 'back') await call('poker_back');
      if (x.dataset.x === 'rebuy') {
        const T = st.table, my = me();
        Z.openModal('<div class="tx"><h2 id="modalTitle">კოინების დამატება</h2><div class="field"><label class="field-lbl" for="pkAdd">რამდენი (მაქს. ' + Z.fmt(T.max_buy - my.stack) + ')</label><input id="pkAdd" type="number" min="1" max="' + (T.max_buy - my.stack) + '" value="' + (T.max_buy - my.stack) + '"></div><button class="btn primary wide" id="pkAddGo">დამატება</button></div>');
        $('#pkAddGo').addEventListener('click', async () => { const v = Math.floor(+$('#pkAdd').value || 0); Z.closeModal(); await call('poker_rebuy', { amount: v }); });
      }
    });
    function frame() {
      requestAnimationFrame(frame);
      if (root.offsetParent === null || Z.view !== 'games') return;
      if (tid == null) { if (performance.now() - lobbyAt > 8000) loadLobby(); return; }
      const live = st && ['preflop', 'flop', 'turn', 'river'].includes(st.table.stage);
      if (performance.now() - lastPoll > (live ? 1200 : 2000)) poll();
      if (live && st.table.deadline) {
        const t = $('.pk-timer i', wrap); if (t) t.style.width = (Math.max(0, (+st.table.deadline - Z.now()) / 25000) * 100).toFixed(1) + '%';
        const s = $('.pk-seat.turn', wrap); if (s) s.style.setProperty('--left', Math.max(0, (+st.table.deadline - Z.now()) / 25000).toFixed(3));
      }
    }
    if (tid != null) open(tid); else loadLobby();
    requestAnimationFrame(frame);
  }
  Z.GAMES.push({ k: 'poker', name: 'პოკერი', desc: 'ჰოლდემი 2–6 მოთამაშით', icon: ICON, mount });
})();
