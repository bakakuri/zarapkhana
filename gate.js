/* ზარაფხანა — sign in, sign up, magic link, Google, password reset, first-run setup notice */
(function () {
  const Z = window.Z;
  const S = Z.state;
  const { $ } = Z;
  const gate = $('#gate'), body = $('#gateBody'), app = $('#app');
  let tab = 'in', shownMode = null, sent = '';

  function field(id, label, type, ph, auto) {
    return '<div class="field"><label class="field-lbl" for="' + id + '">' + label + '</label><input id="' + id + '" type="' + type + '" placeholder="' + (ph || '') + '"' + (auto ? ' autocomplete="' + auto + '"' : '') + '></div>';
  }
  const googleBtn = '<button type="button" class="btn ghost wide google-btn" id="gGoogle"><svg><use href="#i-google"/></svg><span>Google-ით შესვლა</span></button>';
  function render() {
    if (S.mode === 'loading') { body.innerHTML = '<div class="gate-loading"><span class="spinner" aria-label="იტვირთება"></span></div>'; return; }
    if (S.mode === 'setup') {
      body.innerHTML = '<div class="gate-setup"><h2>საიტი ჯერ არ არის დაკავშირებული</h2><p class="muted">ფაილში <code>config.js</code> უნდა ჩაიწეროს Supabase პროექტის მისამართი და საჯარო გასაღები. ამის შემდეგ გვერდი თავისით იმუშავებს.</p></div>';
      return;
    }
    if (S.recovery) {
      body.innerHTML = '<form class="gate-form" id="gForm"><h2>ახალი პაროლი</h2>' + field('gPass', 'ახალი პაროლი (მინიმუმ 6 სიმბოლო)', 'password', '', 'new-password') +
        '<button class="btn primary wide" type="submit">შენახვა</button><p class="gate-msg" id="gMsg"></p></form>';
      $('#gForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const { error } = await Z.auth.newPassword($('#gPass').value);
        if (error) return msgOut(error.message, 'loss');
        S.recovery = false; msgOut('პაროლი შეიცვალა.', 'win'); setTimeout(() => { history.replaceState(null, '', Z.siteUrl() + '#home'); location.reload(); }, 900);
      });
      return;
    }
    const ref = Z.store.get('zar-ref', '');
    const tabs = '<div class="seg big-seg gate-tabs" role="tablist">' + [['in', 'შესვლა'], ['up', 'რეგისტრაცია'], ['link', 'ბმული ელფოსტაზე']].map(([k, l]) => '<button type="button" data-tab="' + k + '" class="' + (tab === k ? 'on' : '') + '">' + l + '</button>').join('') + '</div>';
    let form = '';
    if (sent) form = '<div class="gate-sent"><span class="big-coin"><svg><use href="#i-borj"/></svg></span><h2>შეამოწმე ელფოსტა</h2><p>ბმული გაიგზავნა მისამართზე <b>' + Z.esc(sent) + '</b>. გახსენი წერილი და დააჭირე ბმულს. თუ არ ჩანს, ნახე სპამიც.</p><button class="btn ghost" id="gBack">უკან</button></div>';
    else if (tab === 'in') form = '<form class="gate-form" id="gForm" autocomplete="on">' + field('gEmail', 'ელფოსტა', 'email', 'name@mail.ge', 'email') + field('gPass', 'პაროლი', 'password', '', 'current-password') +
      '<button class="btn primary wide" type="submit">შესვლა</button><button type="button" class="link" id="gForgot">დაგავიწყდა პაროლი?</button><div class="gate-or"><span>ან</span></div>' + googleBtn + '<p class="gate-msg" id="gMsg"></p></form>';
    else if (tab === 'up') form = '<form class="gate-form" id="gForm" autocomplete="on">' + field('gName', 'სახელი (ასე გამოჩნდები რეიტინგში)', 'text', 'მაგ.: ნინო', 'nickname') + field('gEmail', 'ელფოსტა', 'email', 'name@mail.ge', 'email') + field('gPass', 'პაროლი (მინიმუმ 6 სიმბოლო)', 'password', '', 'new-password') +
      (ref ? '<p class="note gate-ref">მოგიწვია მეგობარმა · კოდი <b>' + Z.esc(ref) + '</b>. აქტიური თამაშის შემდეგ ორივე მიიღებთ ბონუსს.</p>' : '') +
      '<button class="btn primary wide" type="submit">ანგარიშის შექმნა</button><div class="gate-or"><span>ან</span></div>' + googleBtn + '<p class="gate-msg" id="gMsg"></p></form>';
    else form = '<form class="gate-form" id="gForm">' + field('gEmail', 'ელფოსტა', 'email', 'name@mail.ge', 'email') + field('gName', 'სახელი (თუ ახალი ხარ)', 'text', 'სურვილისამებრ', 'nickname') +
      '<p class="muted note">პაროლი არ გჭირდება: გამოგიგზავნით ერთჯერად ბმულს, რომლითაც პირდაპირ შეხვალ.</p><button class="btn primary wide" type="submit">ბმულის გაგზავნა</button><p class="gate-msg" id="gMsg"></p></form>';
    body.innerHTML = tabs + form;
    body.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; sent = ''; render(); }));
    const back = $('#gBack'); if (back) back.addEventListener('click', () => { sent = ''; render(); });
    const g = $('#gGoogle'); if (g) g.addEventListener('click', async () => { const { error } = await Z.auth.google(); if (error) msgOut(error.message, 'loss'); });
    const fg = $('#gForgot');
    if (fg) fg.addEventListener('click', async () => {
      const email = $('#gEmail').value.trim();
      if (!email) return msgOut('ჯერ ჩაწერე ელფოსტა.', 'loss');
      const { error } = await Z.auth.reset(email);
      if (error) return msgOut(error.message, 'loss');
      sent = email; render();
    });
    const f = $('#gForm');
    if (f) f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = f.querySelector('button[type=submit]'); btn.disabled = true;
      const email = ($('#gEmail') || {}).value?.trim(), pass = ($('#gPass') || {}).value, name = ($('#gName') || {}).value?.trim();
      try {
        if (tab === 'in') {
          const { error } = await Z.auth.signIn(email, pass);
          if (error) msgOut(/Invalid login/i.test(error.message) ? 'ელფოსტა ან პაროლი არასწორია.' : /confirm/i.test(error.message) ? 'ჯერ დაადასტურე ელფოსტა: ნახე წერილი.' : error.message, 'loss');
        } else if (tab === 'up') {
          if (!name || name.length < 2) { msgOut('ჩაწერე სახელი.', 'loss'); return; }
          if (!pass || pass.length < 6) { msgOut('პაროლი მინიმუმ 6 სიმბოლო უნდა იყოს.', 'loss'); return; }
          const { data, error } = await Z.auth.signUp(email, pass, name);
          if (error) msgOut(/registered/i.test(error.message) ? 'ეს ელფოსტა უკვე რეგისტრირებულია. სცადე შესვლა.' : error.message, 'loss');
          else if (!data.session) { sent = email; render(); }
        } else {
          const { error } = await Z.auth.magic(email, name);
          if (error) msgOut(error.message, 'loss'); else { sent = email; render(); }
        }
      } finally { btn.disabled = false; }
    });
  }
  function msgOut(t, kind) { const m = $('#gMsg'); if (m) { m.textContent = t; m.className = 'gate-msg ' + (kind || ''); } }
  function sync() {
    const showGate = S.mode === 'auth' || S.mode === 'setup' || S.mode === 'loading' || S.recovery;
    gate.hidden = !showGate;
    app.hidden = showGate;
    const key = S.mode + '|' + !!S.recovery;
    if (showGate && shownMode !== key) { shownMode = key; render(); }
  }
  Z.on(sync);
  sync();
})();
