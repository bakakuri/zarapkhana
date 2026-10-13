/* ზარაფხანა — bingo night: a game every 20 minutes, numbers called live */
(function () {
  const Z = window.Z;
  const { head, $, reduce } = Z.gameKit;
  const ICON = '<svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="17" height="17" rx="3" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M3.5 9.2h17M3.5 14.8h17M9.2 3.5v17M14.8 3.5v17" stroke="currentColor" stroke-width="1.2" opacity=".6"/><circle cx="12" cy="12" r="2.4" fill="currentColor"/><circle cx="6.3" cy="6.3" r="1.6" fill="currentColor"/><circle cx="17.7" cy="17.7" r="1.6" fill="currentColor"/></svg>';
  const L = ['B', 'I', 'N', 'G', 'O'];
  const letter = (n) => L[Math.floor((n - 1) / 15)];

  function mount(root) {
    root.innerHTML = head('ბინგო', 'ყოველ 20 წუთში ახალი თამაში. იყიდე 1–6 ბარათი, ბურთები ყოველ 3 წამში გამოდის და ნიშნები ავტომატურად ისმება. პირველი სრული ხაზი (ჰორიზონტალური, ვერტიკალური ან დიაგონალი) იგებს ბანკს.') +
      '<div class="bg"><div class="bg-side"><div class="bg-next" id="bgNext"></div><div class="bg-call" id="bgCall"></div></div><div class="bg-main"><div class="bg-cards" id="bgCards"></div><div class="bg-board" id="bgBoard"></div></div></div>';
    let st = null, polling = false, lastPoll = 0, lastDrawn = 0, announced = null;
    async function poll() {
      if (polling) return;
      polling = true; lastPoll = performance.now();
      try { st = await Z.api('bingo_state', {}, { quiet: true }); render(); } catch (e) {}
      polling = false;
    }
    function cardHtml(c, drawn, winIds) {
      const set = new Set(drawn || []);
      return '<div class="bg-card' + (winIds.has(c.id) ? ' won' : '') + '"><div class="bg-head">' + L.map((x) => '<span>' + x + '</span>').join('') + '</div><div class="bg-grid">' +
        c.nums.map((n) => '<span class="' + (n === 0 ? 'free on' : set.has(n) ? 'on' : '') + '">' + (n === 0 ? '★' : n) + '</span>').join('') + '</div>' + (c.won ? '<b class="bg-won">+' + Z.fmt(c.won) + '</b>' : '') + '</div>';
    }
    function render() {
      if (!st) return;
      const now = Z.now(), nx = st.next, cur = st.cur;
      // next game: sales
      const myNext = st.mine.filter((c) => nx && c.game_id === nx.id);
      Z.setHTML($('#bgNext', root), nx ? '<p class="eyebrow">შემდეგი თამაში · ბარათი ' + Z.fmt(nx.price) + ' კოინი</p><div class="bg-cd"><b class="num" id="bgCd">' + Z.hms(+nx.starts - now) + '</b><small>დაწყებამდე</small></div>' +
        '<div class="bg-stats"><span>ბანკი <b class="num">' + Z.fmt(nx.pot) + '</b></span><span>ბარათი <b class="num">' + nx.cards + '</b></span><span>მოთამაშე <b class="num">' + (st.players || 0) + '</b></span></div>' +
        '<div class="chips">' + [1, 2, 4, 6].map((n) => '<button type="button" class="chip-btn" data-buy="' + n + '"' + (myNext.length + n > 6 ? ' disabled' : '') + '>+' + n + ' · ' + Z.fmt(n * nx.price) + '</button>').join('') + '</div>' +
        '<p class="muted note">შენი ბარათები ამ თამაშზე: <b>' + myNext.length + '</b> / 6. ბანკში მიდის გაყიდვების 90% და საწყისი ფონდი.</p>' : Z.empty('ბინგო ახლა გამორთულია.'));
      // current / last game: calls
      const drawn = cur ? cur.drawn || [] : [];
      const winIds = new Set(((cur && cur.winners) || []).map((w) => w.card));
      const last = drawn[drawn.length - 1];
      if (cur && cur.status === 'live' && drawn.length !== lastDrawn) { lastDrawn = drawn.length; Z.sfx && Z.sfx('tick'); }
      Z.setHTML($('#bgCall', root), cur ? '<p class="eyebrow">' + (cur.status === 'done' ? 'დასრულებული თამაში' : 'მიმდინარე თამაში') + ' · ბანკი ' + Z.fmt(cur.pot) + '</p>' +
        (last ? '<div class="bg-ball' + (cur.status === 'live' ? ' live' : '') + '" data-l="' + letter(last) + '"><small>' + letter(last) + '</small><b>' + last + '</b></div>' : '<div class="bg-ball"><b>?</b></div>') +
        '<div class="bg-recent">' + drawn.slice(-8, -1).reverse().map((n) => '<span>' + letter(n) + n + '</span>').join('') + '</div>' +
        '<p class="muted note">გამოსული ბურთი: <b>' + drawn.length + '</b> / 75</p>' +
        (cur.status === 'done' && cur.winners ? '<div class="bg-winners"><b>გამარჯვებულები:</b> ' + cur.winners.map((w) => Z.av(w.user) + Z.nm(w.user) + ' +' + Z.fmt(w.won)).join(', ') + '</div>' : '')
        : '<p class="eyebrow">ბოლო თამაში</p>' + Z.empty('ჯერ არცერთი თამაში არ გამართულა.'));
      // my cards: current game first, then the next game's
      const mineCur = cur ? st.mine.filter((c) => c.game_id === cur.id) : [];
      Z.setHTML($('#bgCards', root), (mineCur.length ? '<h4>ბარათები: მიმდინარე თამაში</h4><div class="bg-row">' + mineCur.map((c) => cardHtml(c, drawn, winIds)).join('') + '</div>' : '') +
        (myNext.length ? '<h4>ბარათები: შემდეგი თამაში</h4><div class="bg-row">' + myNext.map((c) => cardHtml(c, [], new Set())).join('') + '</div>' : '') +
        (!mineCur.length && !myNext.length ? Z.empty('ბარათი ჯერ არ გაქვს. იყიდე შემდეგ თამაშზე.') : ''));
      Z.setHTML($('#bgBoard', root), '<div class="bg-all">' + Array.from({ length: 75 }, (_, i) => '<span class="' + (drawn.includes(i + 1) ? 'on' : '') + (i + 1 === last ? ' last' : '') + '">' + (i + 1) + '</span>').join('') + '</div>');
      if (cur && cur.status === 'done' && announced !== cur.id) {
        if (announced != null) {
          const mine = (cur.winners || []).filter((w) => w.user === Z.state.myId);
          if (mine.length) { Z.toast('ბინგო! მოიგე ' + Z.fmt(mine.reduce((a, w) => a + w.won, 0)) + ' კოინი', 'win'); Z.celebrate($('#bgCall', root), 300); }
        }
        announced = cur.id;
      }
      if (announced == null && cur) announced = cur.status === 'done' ? cur.id : -1;
    }
    root.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-buy]');
      if (!b || !st || !st.next) return;
      const n = +b.dataset.buy;
      if (n * st.next.price > Z.dispBal()) { Z.toast('ბალანსი არ გყოფნის.', 'loss'); return; }
      b.disabled = true;
      try { await Z.api('bingo_buy', { id: st.next.id, n }, { lazy: true, also: ['quests'] }); Z.toast('ნაყიდია ' + n + ' ბარათი', 'win'); Z.coinFly(b, $('#bgCards', root), 6); poll(); }
      catch (err) { Z.toast(Z.errText(err), 'loss'); }
      b.disabled = false;
    });
    function frame() {
      requestAnimationFrame(frame);
      if (root.offsetParent === null || Z.view !== 'games') return;
      const live = st && st.cur && st.cur.status === 'live';
      const soon = st && st.next && +st.next.starts - Z.now() < 4000;
      if (performance.now() - lastPoll > (live || soon ? 1000 : 4000)) poll();
      const cd = $('#bgCd', root); if (cd && st && st.next) cd.textContent = Z.hms(+st.next.starts - Z.now());
    }
    requestAnimationFrame(frame);
    poll();
  }
  Z.GAMES.push({ k: 'bingo', name: 'ბინგო', desc: 'საერთო თამაში ყოველ 20 წუთში', icon: ICON, mount });
  const order = ['live', 'crash', 'poker', 'bingo', 'duel', 'mines', 'tower', 'plinko', 'bj', 'hilo', 'roulette', 'slot', 'keno', 'dice', 'wheel', 'flip'];
  Z.GAMES.sort((a, b) => order.indexOf(a.k) - order.indexOf(b.k));
})();
