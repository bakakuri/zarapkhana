/* ზარაფხანა — English mode: dictionary-based translation of the rendered page */
(function () {
  const Z = window.Z;
  const GEO = 'Ⴀ-ჿ';
  const hasGeo = new RegExp('[' + GEO + ']');
  Z.lang = Z.store.get('zar-lang', 'ka') === 'en' ? 'en' : 'ka';
  Z.setLang = (l) => { Z.store.set('zar-lang', l === 'en' ? 'en' : 'ka'); location.reload(); };
  const btn = document.getElementById('langBtn');
  if (btn) { btn.setAttribute('translate', 'no'); btn.textContent = Z.lang === 'en' ? 'ქა' : 'EN'; btn.title = Z.lang === 'en' ? 'ქართული' : 'English'; }
  if (Z.lang !== 'en') { Z.t = (s) => s; return; }

  document.documentElement.lang = 'en';
  document.title = 'Zarapkhana';
  const D = Z.I18N || {}, EX = Z.I18N_EXACT || {};
  const keys = Object.keys(D).sort((a, b) => b.length - a.length);
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const RE = new RegExp('(?<![' + GEO + '])(?:' + keys.map(esc).join('|') + ')(?![' + GEO + '])', 'g');
  const TR = { 'ა': 'a', 'ბ': 'b', 'გ': 'g', 'დ': 'd', 'ე': 'e', 'ვ': 'v', 'ზ': 'z', 'თ': 't', 'ი': 'i', 'კ': 'k', 'ლ': 'l', 'მ': 'm', 'ნ': 'n', 'ო': 'o', 'პ': 'p', 'ჟ': 'zh', 'რ': 'r', 'ს': 's', 'ტ': 't', 'უ': 'u', 'ფ': 'p', 'ქ': 'k', 'ღ': 'gh', 'ყ': 'q', 'შ': 'sh', 'ჩ': 'ch', 'ც': 'ts', 'ძ': 'dz', 'წ': 'ts', 'ჭ': 'ch', 'ხ': 'kh', 'ჯ': 'j', 'ჰ': 'h' };
  Z.i18nMiss = new Set();
  const translit = (w) => { const t = [...w].map((c) => TR[c] ?? c).join(''); return t.charAt(0).toUpperCase() + t.slice(1); };
  const SUFFIX = new RegExp('(\\d[\\d.,\\u202F]*%?)\\s*-(ზე|ში|დან|მდე|ს|ის|თან|ით|მა|ია)(?![' + GEO + '])', 'g');
  const UNITS = { 'დ': 'd', 'სთ': 'h', 'წთ': 'm', 'წ': 's' };
  const UNIT = new RegExp('(\\d)(დ|სთ|წთ|წ)(?![' + GEO + '])', 'g');
  Z.t = (s) => {
    if (!s || !hasGeo.test(s)) return s;
    const tr = s.trim();
    if (EX[tr] != null) return s.replace(tr, EX[tr]);
    let out = s.replace(RE, (m) => D[m]);
    if (hasGeo.test(out)) out = out.replace(SUFFIX, '$1').replace(UNIT, (m, n, u) => n + UNITS[u]).replace(RE, (m) => D[m]);
    out = out.replace(/„/g, '“');
    if (hasGeo.test(out)) Z.i18nMiss.add(s.trim()), out = out.replace(new RegExp('[' + GEO + ']+', 'g'), translit);
    return out;
  };
  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE']);
  const ATTRS = ['placeholder', 'title', 'aria-label'];
  const blocked = (el) => !el || SKIP.has(el.tagName) || el.closest('[translate="no"]');
  function trText(n) {
    const v = n.nodeValue;
    if (!v || !hasGeo.test(v) || blocked(n.parentElement)) return;
    if (n.parentElement.matches('.av, .avatar')) { const c = [...v.trim()].map((x) => TR[x] ?? x).join(''); n.nodeValue = c.charAt(0).toUpperCase() + c.slice(1); return; }
    const t = Z.t(v);
    if (t !== v) n.nodeValue = t;
  }
  function trEl(el) {
    if (!el.getAttribute || blocked(el)) return;
    for (const a of ATTRS) { const v = el.getAttribute(a); if (v && hasGeo.test(v)) el.setAttribute(a, Z.t(v)); }
    if (el.tagName === 'INPUT' && el.type === 'text' && hasGeo.test(el.value) && document.activeElement !== el && el.classList.contains('pfO')) el.value = Z.t(el.value);
  }
  function walk(node) {
    if (node.nodeType === 3) return trText(node);
    if (node.nodeType !== 1 || SKIP.has(node.tagName)) return;
    trEl(node);
    const tw = document.createTreeWalker(node, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let n;
    while ((n = tw.nextNode())) (n.nodeType === 3 ? trText(n) : trEl(n));
  }
  walk(document.body);
  new MutationObserver((ms) => {
    for (const m of ms) {
      if (m.type === 'characterData') trText(m.target);
      else if (m.type === 'attributes') trEl(m.target);
      else for (const n of m.addedNodes) walk(n);
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
})();
