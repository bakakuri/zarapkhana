/* ზარაფხანა — VIP, achievements, transfers, chat, tournament, round comments, admin extras */
(function () {
  const Z = window.Z;
  const S = Z.state;
  const { $, $$ } = Z;
  Z.extraRenders = Z.extraRenders || [];

  /* ---------- modal (shared) ---------- */
  const modal = $('#modal');
  Z.openModal = (html) => {
    $('#modalBody').innerHTML = html;
    modal.hidden = false;
    setTimeout(() => $('#modalX').focus(), 50);
  };
  Z.closeModal = () => { modal.hidden = true; };
  $('#modalX').addEventListener('click', Z.closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal || e.target.closest('[data-close]')) Z.closeModal(); });
  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!modal.hidden) Z.closeModal();
    else if (chatOpen) closeChat();
  });

  /* ---------- chips, medals, history text ---------- */
  Z.lvChip = (pid) => {
    const p = Z.player(pid);
    if (!p) return '';
    const L = Z.levelOf(+p.xp);
    return '<span class="lv" style="--lc:' + L.col + '" title="VIP დონე: ' + L.name + '">' + L.name + '</span>';
  };
  const RAR = ['', 'r1', 'r2', 'r3'];
  Z.medal = (a, at, big) => '<span class="medal ' + RAR[a.r] + (at ? '' : ' locked') + (big ? ' big' : '') + '"><span>' + Z.esc(a.g) + '</span></span>';
  Z.ACH = [
    { k: 'first_inv', name: 'პირველი ჩადება', desc: 'ჩადე პირველი ინვესტიცია', g: '1', r: 1 },
    { k: 'inv_win', name: 'პირველი მოგება', desc: 'მოიგე ინვესტიციით', g: '+', r: 1 },
    { k: 'streak3', name: 'სერია', desc: '3 ინვესტიცია მოიგე ზედიზედ', g: '×3', r: 2 },
    { k: 'streak7', name: 'შეუჩერებელი', desc: '7 ინვესტიცია მოიგე ზედიზედ', g: '×7', r: 3 },
    { k: 'high_win', name: 'რისკიანი', desc: 'მოიგე მაღალ დონეზე', g: 'მ', r: 2 },
    { k: 'high3', name: 'ცეცხლთან მოთამაშე', desc: 'მაღალ დონეზე მოიგე 3-ჯერ', g: '3მ', r: 3 },
    { k: 'insured', name: 'დაზღვეული', desc: 'დაზღვევამ წაგების ნაწილი დაგიბრუნა', g: '☂', r: 1 },
    { k: 'games10', name: 'მოთამაშე', desc: 'ითამაშე 10 თამაში', g: '10', r: 1 },
    { k: 'games100', name: 'ვეტერანი', desc: 'ითამაშე 100 თამაში', g: '100', r: 2 },
    { k: 'crash10', name: 'კოსმონავტი', desc: 'რაკეტაში აიღე ×10 ან მეტი', g: '×10', r: 3 },
    { k: 'mines5', name: 'ნაღმმძიებელი', desc: 'ნაღმებში აიღე ×5 ან მეტი', g: '×5', r: 2 },
    { k: 'bj', name: 'ბლექჯეკი', desc: 'მიიღე ბლექჯეკი პირველივე ორი კარტით', g: '21', r: 1 },
    { k: 'plinko_edge', name: 'კიდე', desc: 'Plinko-ში ბურთი კიდურა უჯრაში ჩააგდე', g: '◆', r: 3 },
    { k: 'dice_sniper', name: 'სნაიპერი', desc: 'კამათელში მოიგე 10%-ზე ნაკლები შანსით', g: '%', r: 2 },
    { k: 'poker', name: 'პოკერის ზვიგენი', desc: 'მოიგე პოკერის ბანკი 20 დიდი ბლაინდით ან მეტით', g: '♠', r: 2 },
    { k: 'bingo', name: 'ბინგო!', desc: 'მოიგე ბინგოს თამაში', g: 'B', r: 2 },
    { k: 'rich10k', name: 'მდიდარი', desc: 'დააგროვე 10 000 კოინი', g: '10K', r: 2 },
    { k: 'rich100k', name: 'მაგნატი', desc: 'დააგროვე 100 000 კოინი', g: '100K', r: 3 },
    { k: 'banker', name: 'მეანაბრე', desc: 'გახსენი ანაბარი ბანკში', g: '₾', r: 1 },
    { k: 'trader', name: 'ტრეიდერი', desc: 'აქციებით მიიღე 1 000 კოინის მოგება', g: '↗', r: 3 },
    { k: 'predictor', name: 'წინასწარმეტყველი', desc: 'გამოიცანი პროგნოზის შედეგი', g: '?', r: 2 },
    { k: 'gift', name: 'გულუხვი', desc: 'გადაურიცხე კოინები სხვა მოთამაშეს', g: '♥', r: 1 },
    { k: 'referral', name: 'მეგობრის მომყვანი', desc: 'მოიწვიე მეგობარი, რომელიც აქტიური გახდა', g: '+1', r: 2 },
    { k: 'bonus7', name: 'ერთგული', desc: 'აიღე 7 დღიური ბონუსი', g: '7', r: 2 },
    { k: 'login7', name: 'კვირის სერია', desc: 'შედი 7 დღე ზედიზედ', g: '7d', r: 2 },
    { k: 'tourney', name: 'ჩემპიონი', desc: 'გახდი კვირის ტურნირის პრიზიორი', g: '★', r: 3 },
    { k: 'lucky', name: 'იღბლიანი', desc: 'მოიგე კვირის ლატარია', g: '777', r: 3 },
    { k: 'duelist', name: 'დუელისტი', desc: 'მოიგე დუელი', g: 'VS', r: 2 },
    { k: 'clanwar', name: 'მეომარი', desc: 'შენმა კლანმა მოიგო კლანების ომი', g: '⚔', r: 3 },
    { k: 'chat1', name: 'მოსაუბრე', desc: 'დაწერე პირველი შეტყობინება ჩატში', g: '„“', r: 1 },
    { k: 'shopper', name: 'კოლექციონერი', desc: 'იყიდე პირველი ნივთი მაღაზიაში', g: '◈', r: 1 },
    { k: 'boxer', name: 'ყუთების მონადირე', desc: 'გახსენი 10 სიურპრიზ-ყუთი', g: '▣', r: 2 },
    { k: 'auction', name: 'აუქციონერი', desc: 'მოიგე ლოტი აუქციონზე', g: '⚑', r: 2 },
    { k: 'quester', name: 'გულმოდგინე', desc: 'შეასრულე 10 დღიური დავალება', g: '✓10', r: 2 },
    { k: 'pass10', name: 'სეზონის სტუმარი', desc: 'მიაღწიე სეზონის საშვის მე-10 საფეხურს', g: 'S10', r: 2 },
    { k: 'vip_gold', name: 'ოქროს წევრი', desc: 'მიაღწიე ოქროს დონეს', g: 'VIP', r: 3 },
    { k: 'pumpkin', name: 'გოგრების მონადირე', desc: 'ჰელოუინზე დაიჭირე 30 გოგრა', g: '🎃', r: 3 },
    { k: 'snowman', name: 'თოვლის ბაბუა', desc: 'ახალ წელს დაიჭირე 30 ფიფქი', g: '❄', r: 3 },
  ];
  Z.achDef = (k) => Z.ACH.find((a) => a.k === k);
  // what arrives in the bell: some kinds also deserve a toast or a celebration
  Z.onNote = (n) => {
    const m = n.meta || {};
    if (n.k === 'ach') { Z.onAchieve([m.a], null); return; }
    if (n.k === 'lvl') { Z.onAchieve([], Z.levelOf(Z.LEVELS[m.i] ? Z.LEVELS[m.i].xp : 0)); return; }
    if (['ti', 'lw', 'tw', 'cwar', 'cwin', 'asold', 'awon', 'refb', 'bgw', 'dpm', 'a'].includes(n.k) && +n.d > 0) { Z.toast(Z.noteText(n), 'win'); Z.celebrate($('#balPill'), +n.d); }
    else if (['duel', 'lnoffer', 'creq', 'aout', 'lndef', 'insoff'].includes(n.k)) Z.toast(Z.noteText(n));
  };

  /* ---------- achievement + level notifications ---------- */
  Z.onAchieve = (fresh, level) => {
    if (fresh.length || level) Z.sfx && Z.sfx('ach');
    fresh.slice(0, 3).forEach((k, i) => {
      const a = Z.achDef(k);
      if (!a) return;
      setTimeout(() => {
        const el = document.createElement('div');
        el.className = 'toast ach';
        el.innerHTML = Z.medal(a, 1) + '<span><small>ახალი მიღწევა</small><b></b></span>';
        el.querySelector('b').textContent = a.name;
        $('#toasts').appendChild(el);
        setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 380); }, 4200);
        Z.celebrate(el, 120);
      }, i * 700);
    });
    if (level) {
      setTimeout(() => {
        Z.toast('ახალი VIP დონე: ' + level.name + ' · დღიური ბონუსი ×' + level.mult, 'win');
        Z.celebrate($('#balPill'), 300);
      }, fresh.length * 700);
    }
  };

  /* ---------- home: VIP + achievements + transfer button ---------- */
  function renderHomeSocial() {
    if (Z.view !== 'home') return;
    const me = S.me;
    const ready = S.ready && !!me;
    $('#txBtn').hidden = !me || S.config.tx === false;
    const vb = $('#vipBody');
    if (!ready) return;
    const xp = me ? +me.xp || 0 : 0;
    const L = Z.levelOf(xp), next = Z.LEVELS[L.i + 1];
    const pct = next ? ((xp - L.xp) / (next.xp - L.xp)) * 100 : 100;
    $('#vipXp').textContent = Z.fmt(xp) + ' XP';
    vb.innerHTML = '<div class="vip"><span class="vip-medal" style="--lc:' + L.col + '"><b>' + (L.i + 1) + '</b></span><div class="vip-info"><b class="vip-name" style="color:' + L.col + '">' + L.name + '</b>' +
      '<small>დღიური ბონუსი ×' + L.mult + ' · მაღაზიაში ფასდაკლება ' + L.i * 5 + '%</small>' +
      '<span class="xpbar"><i style="width:' + Z.clamp(pct, 0, 100).toFixed(1) + '%;--lc:' + (next ? next.col : L.col) + '"></i></span>' +
      '<small>' + (next ? Z.fmt(next.xp - xp) + ' XP დარჩა დონემდე „' + next.name + '“ (ბონუსი ×' + next.mult + ')' : 'მიღწეულია უმაღლესი დონე') + '</small></div></div>' +
      '<ol class="ladder">' + Z.LEVELS.map((l, i) => '<li class="' + (i === L.i ? 'on' : i < L.i ? 'done' : '') + '" style="--lc:' + l.col + '"><i></i><b>' + l.name + '</b><small>' + Z.fmt(l.xp) + ' XP · ×' + l.mult + '</small></li>').join('') + '</ol>' +
      '<p class="muted note">XP გროვდება: თამაშში დადებული და ინვესტიციაში ჩადებული ყოველი კოინი = 1 XP, დღიური ბონუსი = 50 XP, დავალება = 25 XP.</p>';
    const ach = (me && me.ach) || {};
    const got = Z.ACH.filter((a) => ach[a.k]).length;
    $('#achCount').textContent = got + ' / ' + Z.ACH.length;
    Z.setHTML($('#achGrid'), Z.ACH.map((a, i) => '<button type="button" class="ach-item' + (ach[a.k] ? '' : ' off') + '" data-ach="' + a.k + '" style="--k:' + i + '" title="' + Z.esc(a.desc) + '">' + Z.medal(a, ach[a.k]) + '<small>' + Z.esc(a.name) + '</small></button>').join(''));
  }
  $('#achGrid').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ach]');
    if (!b) return;
    const a = Z.achDef(b.dataset.ach), at = ((S.me && S.me.ach) || {})[a.k];
    Z.openModal('<div class="ann">' + Z.medal(a, at, true) + '<h2 id="modalTitle">' + Z.esc(a.name) + '</h2><p>' + Z.esc(a.desc) + '</p><p class="muted">' + (at ? 'მიღებულია ' + Z.fdate(at) : 'ჯერ არ გაქვს') + '</p>' +
      '<p class="muted" style="font-size:.8rem">' + ['', 'ჩვეულებრივი', 'იშვიათი', 'ეპიკური'][a.r] + ' მიღწევა</p></div>');
  });
  Z.extraRenders.push(renderHomeSocial);

  /* ---------- transfers ---------- */
  let txPick = null;
  $('#txBtn').addEventListener('click', () => Z.openTransfer());
  Z.openTransfer = (pre) => {
    txPick = null;
    Z.openModal('<div class="tx"><h2 id="modalTitle">გადარიცხვა</h2><p class="muted">კოინები მიმღების ბალანსზე მაშინვე გამოჩნდება. გადარიცხვის გაუქმება შეუძლებელია.</p>' +
      '<div class="field"><label class="field-lbl" for="txSearch">ვის</label><div class="search-wrap"><input id="txSearch" type="search" placeholder="მოთამაშის სახელი" autocomplete="off"><ul class="search-res" id="txRes" hidden></ul></div><div class="picked" id="txPick"><span class="muted">მოთამაშე არ არის არჩეული</span></div></div>' +
      '<div class="field"><label class="field-lbl" for="txAmt">რამდენი · ხელმისაწვდომია ' + Z.fmt(Z.myBal()) + '</label><input id="txAmt" type="number" min="1" step="1" value="100" inputmode="numeric"></div>' +
      '<div class="field"><label class="field-lbl" for="txNote">შეტყობინება (არასავალდებულო)</label><input id="txNote" type="text" maxlength="60" placeholder="მაგ.: წარმატებები!"></div>' +
      '<button class="btn primary wide" id="txSend">გაგზავნა</button></div>');
    const inp = $('#txSearch'), res = $('#txRes');
    const list = () => {
      const q = inp.value.trim().toLowerCase();
      const ids = [...S.players.keys()].filter((id) => id !== S.myId && (!q || Z.realName(id).toLowerCase().includes(q))).slice(0, 10);
      res.innerHTML = ids.length ? ids.map((id) => '<li><button type="button" data-id="' + Z.esc(id) + '">' + Z.av(id) + '<span>' + Z.nm(id) + '</span>' + Z.lvChip(id) + '</button></li>').join('') : '<li class="muted" style="padding:10px">მოთამაშე ვერ მოიძებნა</li>';
      res.hidden = false;
    };
    inp.addEventListener('focus', list);
    inp.addEventListener('input', list);
    res.addEventListener('click', (e) => {
      const b = e.target.closest('[data-id]');
      if (!b) return;
      txPick = b.dataset.id; res.hidden = true; inp.value = '';
      $('#txPick').innerHTML = Z.av(txPick) + '<span><b>' + Z.nm(txPick) + '</b></span>' + Z.lvChip(txPick);
    });
    $('#txSend').addEventListener('click', async (e) => {
      const a = Math.floor(+$('#txAmt').value || 0);
      if (!txPick) { Z.toast('ჯერ აირჩიე მიმღები.', 'loss'); return; }
      if (!(a > 0) || a > Z.myBal()) { Z.toast('თანხა არასწორია ან ბალანსი არ გყოფნის.', 'loss'); return; }
      e.currentTarget.disabled = true;
      const ok = await Z.transfer(txPick, a, $('#txNote').value.trim());
      if (ok) {
        Z.toast('გადაეგზავნა ' + Z.fmt(a) + ' კოინი: ' + Z.realName(txPick), 'win');
        Z.coinFly($('#txSend'), $('#balPill'), 8);
        Z.closeModal();
      } else if ($('#txSend')) $('#txSend').disabled = false;
    });
    if (pre && pre !== S.myId) { txPick = pre; $('#txPick').innerHTML = Z.av(pre) + '<span><b>' + Z.nm(pre) + '</b></span>' + Z.lvChip(pre); }
  };

  /* ---------- chat drawer ---------- */
  const drawer = $('#chat'), fab = $('#chatFab'), scrim = $('#scrim'), cList = $('#chatList');
  let chatOpen = false, lastCount = 0;
  const seenKey = () => 'zar-chat-seen';
  Z.allMsgs = () => [...S.msgs.values()].filter((m) => m.clan_id == null && !m.deleted).map((m) => ({ id: m.id, u: m.user_id, t: m.body, at: +m.at, c: m.round })).sort((a, b) => a.at - b.at);
  Z.clanMsgs = (cid) => [...S.msgs.values()].filter((m) => m.clan_id === cid && !m.deleted).map((m) => ({ id: m.id, u: m.user_id, t: m.body, at: +m.at })).sort((a, b) => a.at - b.at);
  function openChat() {
    chatOpen = true;
    drawer.classList.add('open'); scrim.hidden = false;
    fab.setAttribute('aria-expanded', 'true');
    Z.store.set(seenKey(), Date.now());
    renderChat(true);
    setTimeout(() => $('#chatInput').focus(), 300);
  }
  function closeChat() {
    chatOpen = false;
    drawer.classList.remove('open'); scrim.hidden = true;
    fab.setAttribute('aria-expanded', 'false');
    Z.store.set(seenKey(), Date.now());
    renderChat();
  }
  fab.addEventListener('click', () => (chatOpen ? closeChat() : openChat()));
  $('#chatX').addEventListener('click', closeChat);
  scrim.addEventListener('click', closeChat);
  function msgHtml(m, i, compact) {
    if (m.sys) return '<li class="sys" style="--k:' + i + '"><span>' + m.text + '</span></li>';
    const mine = m.u === S.myId;
    const canDel = mine || S.isAdmin;
    return '<li class="' + (mine ? 'me' : '') + '" style="--k:' + i + '">' + Z.av(m.u) +
      '<div class="bub ' + (Z.bubClass ? Z.bubClass(m.u) : '') + '"><div class="bh"><b>' + Z.nm(m.u) + '</b>' + Z.lvChip(m.u) + '<span class="time">' + Z.ago(m.at) + '</span>' +
      (S.isAdmin && !mine ? '<button class="del mute" data-mute="' + Z.esc(m.u) + '" title="ჩატში დადუმება" aria-label="დადუმება">⊘</button>' : '') +
      (canDel ? '<button class="del" data-del="' + Z.esc(m.id) + '" aria-label="წაშლა" title="წაშლა">×</button>' : '') + '</div>' +
      '<p translate="no"></p>' + (m.c != null && !compact ? '<button class="rtag" data-round="' + m.c + '">რაუნდი #' + Z.roundNo(m.c) + '</button>' : '') + '</div></li>';
  }
  function fillTexts(listEl, msgs) {
    const ps = listEl.querySelectorAll('li:not(.sys) .bub p');
    msgs.filter((m) => !m.sys).forEach((m, i) => { if (ps[i]) ps[i].textContent = m.t; });
  }
  function renderChat(forceBottom) {
    const all = Z.allMsgs();
    const seen = Z.store.get(seenKey(), 0);
    const unread = chatOpen ? 0 : all.filter((m) => m.u !== S.myId && m.at > seen).length;
    const badge = $('#chatBadge');
    badge.hidden = !unread;
    badge.textContent = unread > 9 ? '9+' : unread;
    if (unread && unread !== lastCount) { fab.classList.remove('nudge'); void fab.offsetWidth; fab.classList.add('nudge'); if (unread > lastCount) Z.sfx && Z.sfx('msg'); }
    lastCount = unread;
    fab.hidden = !S.ready;
    if (!chatOpen) return;
    const myClan = Z.clanOf ? Z.clanOf(S.myId) : null;
    $('#chatTabs').hidden = !myClan;
    if (!myClan) Z.chatTab = 'all';
    const clanMode = Z.chatTab === 'clan' && myClan;
    $$('#chatTabs button').forEach((b) => b.classList.toggle('on', b.dataset.ct === (clanMode ? 'clan' : 'all')));
    $('#chatSub').textContent = clanMode ? 'ხედავენ მხოლოდ „' + myClan.name + '“-ის წევრები' : 'ყველა მოთამაშე ხედავს';
    const src = clanMode ? Z.clanMsgs(myClan.id) : all;
    const sys = [...S.cycles.values()].filter((r) => (r.e || []).length).sort((a, b) => b.c - a.c).slice(0, 5).map((r) => {
      const ag = Z.aggregate(r).sort((a, b) => b.d - a.d);
      const top = ag[0];
      return { sys: true, at: Z.cycleEnd(r.c), text: 'რაუნდი #' + Z.roundNo(r.c) + ' დასრულდა · ' + r.e.length + ' ინვესტიცია' + (top && top.d > 0 ? ' · ლიდერი ' + Z.nm(top.p) + ' ' + Z.sfmt(top.d) : '') };
    });
    const items = src.concat(clanMode ? [] : sys).sort((a, b) => a.at - b.at).slice(-80);
    const nearBottom = cList.scrollHeight - cList.scrollTop - cList.clientHeight < 80;
    const html = items.length ? items.map((m, i) => msgHtml(m, Math.max(0, i - items.length + 8))).join('') : '<li class="sys"><span>' + (clanMode ? 'კლანის ჩატში ჯერ არავის დაუწერია.' : 'ჯერ არავის დაუწერია. იყავი პირველი!') + '</span></li>';
    const key = html.replace(/ \S+ წინ</g, '<') + items.map((m) => m.t).join('|');
    if (cList._key !== key || forceBottom) { cList._key = key; cList.innerHTML = html; fillTexts(cList, items); }
    if (forceBottom || nearBottom) cList.scrollTop = cList.scrollHeight;
    const inp = $('#chatInput');
    inp.disabled = !S.myId;
    inp.placeholder = (S.players.get(S.myId) || {}).muted ? 'ადმინმა ჩატში დაგადუმა' : 'დაწერე შეტყობინება';
  }
  async function handleSend(text, c, toClan) {
    if (!String(text || '').trim()) return false;
    const r = await Z.sendMsg(text, c, toClan);
    if (r && r.id) { S.msgs.set(r.id, r); Z.sfx && Z.sfx('send'); return true; }
    return false;
  }
  $('#chatForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const inp = $('#chatInput');
    const myClan = Z.clanOf ? Z.clanOf(S.myId) : null;
    const t = inp.value; inp.value = '';
    if (await handleSend(t, null, Z.chatTab === 'clan' && !!myClan)) renderChat(true); else inp.value = t;
  });
  $('#chatTabs').addEventListener('click', (e) => { const b = e.target.closest('[data-ct]'); if (!b) return; Z.chatTab = b.dataset.ct; renderChat(true); });
  document.addEventListener('click', (e) => {
    const mu = e.target.closest('[data-mute]');
    if (mu) { Z.setMute(mu.dataset.mute, true).then((ok) => ok && Z.toast('დადუმებულია: ' + Z.realName(mu.dataset.mute))); return; }
    const d = e.target.closest('[data-del]');
    if (d) { S.msgs.delete(+d.dataset.del); Z.deleteMsg(+d.dataset.del); Z.emit(); return; }
    const r = e.target.closest('[data-round]');
    if (r) { if (chatOpen) closeChat(); Z.setLbRound && Z.setLbRound(+r.dataset.round); Z.go('leaders'); }
  });
  Z.extraRenders.push(() => renderChat());
  Z.on(() => renderChat());

  /* ---------- tournament ---------- */
  let tourTab = 'cur';
  $('#tourTabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-w]');
    if (!b) return;
    tourTab = b.dataset.w;
    $$('#tourTabs button').forEach((x) => x.classList.toggle('on', x === b));
    renderTourBoard();
  });
  Z.tourCfg = () => Object.assign({ on: true, prizes: [1000, 500, 250], min: 10 }, S.config.tour || {});
  Z.standings = (w) => {
    const cfg = Z.tourCfg(), out = [];
    for (const r of S.weekly.values()) if (r.w === w && r.n > 0) out.push({ p: r.user_id, net: +r.net, vol: +r.vol, n: r.n, ok: r.n >= cfg.min });
    out.sort((a, b) => b.ok - a.ok || b.net - a.net || b.vol - a.vol || (a.p < b.p ? -1 : 1));
    return out;
  };
  const prizeOf = (i) => (Z.tourCfg().prizes || [])[i] || 0;
  function leftText(ms) {
    const d = Math.floor(ms / Z.DAY);
    return (d ? d + 'დ ' : '') + Z.hms(ms % Z.DAY);
  }
  function renderTourCard() {
    if (Z.view !== 'games') return;
    const card = $('#tourCard'), cfg = Z.tourCfg();
    card.hidden = !cfg.on;
    if (!cfg.on) return;
    const w = Z.curWeek(), sb = Z.standings(w);
    const myI = sb.findIndex((x) => x.p === S.myId), my = sb[myI];
    const prizes = (cfg.prizes || []).map((p, i) => p ? '<span class="prize p' + (i + 1) + '"><b>' + (i + 1) + '</b>' + Z.fmt(p) + '</span>' : '').join('');
    const html = '<div class="tour-head"><div><p class="eyebrow">კვირის ტურნირი · ' + Z.fdate(Z.cycleStart(w)).split(',')[0] + ' – ' + Z.fdate(Z.weekEnd(w) - 1).split(',')[0] + '</p><h3>ვინ მოიგებს ყველაზე მეტს თამაშებში?</h3></div>' +
      '<div class="tour-left"><small>დასრულებამდე</small><b class="num" id="tourLeft">' + leftText(Z.weekEnd(w) - Z.now()) + '</b></div></div>' +
      '<div class="tour-body"><div class="prizes">' + prizes + '</div>' +
      '<ol class="tour-top">' + (sb.length ? sb.slice(0, 3).map((x, i) => '<li style="--k:' + i + '"><span class="pl">' + (i + 1) + '</span>' + Z.av(x.p) + '<span class="nm">' + Z.nm(x.p) + '</span><b class="' + (x.net >= 0 ? 'pos' : 'neg') + '">' + Z.sfmt(x.net) + '</b></li>').join('') : '<li class="muted">ჯერ არავის უთამაშია ამ კვირაში</li>') + '</ol>' +
      '<div class="tour-me">' + (my ? '<small>შენი ადგილი</small><b>#' + (myI + 1) + '</b><span class="' + (my.net >= 0 ? 'pos' : 'neg') + '">' + Z.sfmt(my.net) + '</span><small>' + my.n + ' თამაში' + (my.ok ? '' : ' · საჭიროა ' + cfg.min) + '</small>'
        : '<small>შენ ჯერ არ მონაწილეობ</small><b>—</b><small>ითამაშე მინიმუმ ' + cfg.min + ' თამაში</small>') + '</div></div>' +
      '<p class="muted note">ქულა = წმინდა მოგება თამაშებში ამ კვირაში. პრიზს იღებს ტოპ ' + (cfg.prizes || []).filter(Boolean).length + ', ვისაც აქვს მინიმუმ ' + cfg.min + ' თამაში და დადებითი შედეგი. პრიზი ავტომატურად ჩაირიცხება ორშაბათს.</p>';
    const key = html.replace(/id="tourLeft">[^<]*/, '');
    if (card._key !== key) { card._key = key; card.innerHTML = html; }
  }
  function renderTourBoard() {
    if (Z.view !== 'leaders') return;
    const cfg = Z.tourCfg();
    $('#tourBoard').hidden = !cfg.on;
    if (!cfg.on) return;
    const w = tourTab === 'cur' ? Z.curWeek() : Z.curWeek() - 7;
    const sb = Z.standings(w).slice(0, 10);
    const tl = $('#tourList');
    const html = (tourTab === 'cur' ? '<p class="muted note" style="margin:0 0 8px">დასრულებამდე <b class="num" id="tourLeft2">' + leftText(Z.weekEnd(w) - Z.now()) + '</b></p>' : '') +
      (sb.length ? '<ol class="rank">' + sb.map((x, i) => {
        const pr = x.ok && x.net > 0 ? prizeOf(i) : 0;
        const got = tourTab === 'prev';
        return '<li style="--k:' + i + '" class="' + (x.ok ? '' : 'dim') + '">' + Z.av(x.p) + '<span class="nm">' + Z.nm(x.p) + ' ' + Z.lvChip(x.p) + '<small>' + x.n + ' თამაში · ბრუნვა ' + Z.fmt(x.vol) + (x.ok ? '' : ' · საჭიროა ' + cfg.min) + (pr ? ' · პრიზი ' + Z.fmt(pr) + (tourTab === 'prev' ? (got ? ' (ჩაირიცხა)' : ' (ჩაირიცხება)') : '') : '') + '</small></span><span class="v ' + (x.net >= 0 ? 'pos' : 'neg') + '">' + Z.sfmt(x.net) + '</span></li>';
      }).join('') + '</ol>' : Z.empty(tourTab === 'cur' ? 'ამ კვირაში ჯერ არავის უთამაშია.' : 'წინა კვირის ტურნირში მონაწილე არ იყო.'));
    const key = html.replace(/id="tourLeft2">[^<]*/, '');
    if (tl._key !== key) { tl._key = key; tl.innerHTML = html; }
  }
  setInterval(() => {
    const w = Z.curWeek(), t = leftText(Z.weekEnd(w) - Z.now());
    const a = $('#tourLeft'), b = $('#tourLeft2');
    if (a) a.textContent = t;
    if (b) b.textContent = t;
  }, 1000);
  Z.extraRenders.push(renderTourCard, renderTourBoard);

  /* ---------- round comments (leaderboard) ---------- */
  function renderRoundComments() {
    if (Z.view !== 'leaders') return;
    const c = Z.lbC;
    $('#rcLabel').textContent = c != null ? 'რაუნდი #' + Z.roundNo(c) : '';
    const list = Z.allMsgs().filter((m) => m.c === c);
    const el = $('#rcList');
    const html = list.length ? list.map((m, i) => msgHtml(m, i, true)).join('') : '<li class="sys"><span>' + (c == null ? 'კომენტარები გამოჩნდება, როცა პირველი რაუნდი დასრულდება.' : 'ამ რაუნდზე ჯერ არავის დაუწერია.') + '</span></li>';
    const key = html.replace(/ \S+ წინ</g, '<') + list.map((m) => m.t).join('|');
    if (el._key !== key) { el._key = key; el.innerHTML = html; fillTexts(el, list); el.scrollTop = el.scrollHeight; }
    const inp = $('#rcInput');
    inp.disabled = c == null || !S.myId;
  }
  $('#rcForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const inp = $('#rcInput');
    if (Z.lbC == null) return;
    const t = inp.value; inp.value = '';
    if (await handleSend(t, Z.lbC, false)) renderRoundComments(); else inp.value = t;
  });
  Z.extraRenders.push(renderRoundComments);

  /* ---------- admin: tournament, transfers ---------- */
  const af = $('#admSocial');
  af.innerHTML =
    '<label class="check"><input type="checkbox" id="asTour"><span class="switch"></span><span><b>კვირის ტურნირი</b><small>პრიზები ავტომატურად ჩაირიცხება ორშაბათს 00:00-ის შემდეგ.</small></span></label>' +
    [0, 1, 2].map((i) => '<div class="rate-row"><label for="asP' + i + '"><span>' + (i + 1) + ' ადგილის პრიზი</span><small>0 = პრიზის გარეშე</small></label><input type="number" id="asP' + i + '" min="0" step="1" inputmode="numeric"></div>').join('') +
    '<div class="rate-row"><label for="asMin"><span>მინიმუმ თამაში</span><small>ტურნირში მონაწილეობისთვის</small></label><input type="number" id="asMin" min="1" step="1" inputmode="numeric"></div>' +
    '<label class="check"><input type="checkbox" id="asTx"><span class="switch"></span><span><b>გადარიცხვები მოთამაშეებს შორის</b><small>გამორთვისას „გადარიცხვის“ ღილაკი ქრება.</small></span></label>' +
    '<p class="muted note" style="margin:0">ჩატის მოდერაცია: ჩატში ნებისმიერ შეტყობინებას აქვს წაშლის და დადუმების ღილაკი შენთვის.</p>' +
    '<button class="btn primary" type="submit">შენახვა</button>';
  function fillSocial(force) {
    const cfg = Z.tourCfg();
    const set = (id, v, prop = 'value') => { const el = $('#' + id); if (force || document.activeElement !== el) el[prop] = v; };
    set('asTour', !!cfg.on, 'checked');
    [0, 1, 2].forEach((i) => set('asP' + i, (cfg.prizes || [])[i] || 0));
    set('asMin', cfg.min);
    set('asTx', S.config.tx !== false, 'checked');
  }
  af.addEventListener('submit', async (e) => {
    e.preventDefault();
    const prizes = [0, 1, 2].map((i) => Math.max(0, Math.floor(+$('#asP' + i).value || 0)));
    if (await Z.saveConfigPatch({ tour: { on: $('#asTour').checked, prizes, min: Math.max(1, Math.floor(+$('#asMin').value || 1)) }, tx: $('#asTx').checked })) Z.toast('შენახულია.', 'win');
  });
  let socialDirty = false;
  af.addEventListener('input', () => (socialDirty = true));
  Z.extraRenders.push(() => { if (Z.view === 'admin' && S.isAdmin && !socialDirty) fillSocial(false); });
  af.addEventListener('submit', () => (socialDirty = false));
})();
