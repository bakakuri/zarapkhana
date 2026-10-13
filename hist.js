/* ზარაფხანა — words for every kind of history entry, notification and feed item */
(function () {
  const Z = window.Z;
  const S = Z.state;
  Z.GAME_NAMES = { crash: 'რაკეტა', live: 'ცოცხალი რაკეტა', mines: 'ნაღმები', tower: 'კოშკი', plinko: 'Plinko', bj: 'ბლექჯეკი', hilo: 'მეტი თუ ნაკლები',
    roulette: 'რულეტკა', slot: 'სლოტი', keno: 'კენო', dice: 'კამათელი', wheel: 'ბედის ბორბალი', flip: 'ქოინის აგდება', poker: 'პოკერი', bingo: 'ბინგო', duel: 'დუელები' };
  Z.gameName = (k) => Z.GAME_NAMES[k] || 'თამაში';
  Z.itemName = (id) => { const it = S.items.get(id); return it ? (it.title ? 'ტიტული „' + it.title + '“' : it.name) : id || 'ნივთი'; };
  const tn = (t) => (t ? Z.tier(t).name.toLowerCase() : '');
  const nm = (p) => Z.nameOf(p);
  const q = (id) => { const p = S.preds.get(id); return p ? '„' + p.q + '“' : ''; };
  const QN = () => (Z.QUESTS || []);
  Z.histText = (h) => {
    switch (h.k) {
      case 'g': return Z.gameName(h.g) + (h.net > 0 || h.d > 0 ? ': მოგება' : (h.net ?? h.d) < 0 ? ': წაგება' : ': ფრე');
      case 'iw': return 'ინვესტიცია მოიგო (' + tn(h.t) + ')' + (h.cp ? ', მოგება ფსონს დაემატა' : '');
      case 'il': return 'ინვესტიცია წააგო (' + tn(h.t) + ')';
      case 'ib': return 'ინვესტიცია ჩაიდო (' + tn(h.t) + ')';
      case 'ir': return 'ინვესტიციის თანხა დაბრუნდა';
      case 'insp': return 'ინვესტიციის დაზღვევა (' + tn(h.t) + ')';
      case 'insb': return 'დაზღვევამ აგინაზღაურა (' + tn(h.t) + ')';
      case 'b': return 'შესვლის კალენდარი: დღე ' + (h.s || 1);
      case 'a': return (h.delta ?? h.d) >= 0 ? 'ადმინმა დაარიცხა' + (h.n ? ': ' + h.n : '') : 'ადმინმა ჩამოჭრა' + (h.n ? ': ' + h.n : '');
      case 'ti': return 'გადმორიცხვა: ' + nm(h.p) + (h.n ? ' — „' + h.n + '“' : '');
      case 'to': return 'გადარიცხვა: ' + nm(h.p) + (h.n ? ' — „' + h.n + '“' : '');
      case 'tw': return 'კვირის ტურნირი: ' + h.r + ' ადგილი';
      case 'qc': { const x = QN().find((y) => y.k === h.q); return 'დავალება შესრულდა' + (x ? ': ' + x.t : ''); }
      case 'lb': return 'ლატარიის ბილეთი ×' + (h.n || 1);
      case 'lw': return 'ლატარიის მოგება!';
      case 'dout': return 'დუელის გამოწვევა (' + (h.g === 'dice' ? 'კამათელი' : 'ქოინი') + ')';
      case 'din': return 'დუელის მიღება';
      case 'dw': return 'დუელი მოიგე: ' + nm(h.p);
      case 'dl': return 'დუელი წააგე: ' + nm(h.p);
      case 'dc': return 'დუელის ფსონი დაბრუნდა';
      case 'sb': return 'მაღაზია: ' + Z.itemName(h.i);
      case 'bxr': return 'ყუთიდან განმეორებული ნივთი, კოინებად: ' + Z.itemName(h.i);
      case 'rs': return 'ახალი სეზონი: ბალანსი დაყენდა საწყისზე';
      case 'pbet': return 'პროგნოზის ფსონი ' + q(h.q);
      case 'pwin': return 'პროგნოზი გამართლდა ' + q(h.q);
      case 'plose': return 'პროგნოზი არ გამართლდა ' + q(h.q);
      case 'pref': return 'პროგნოზი გაუქმდა, ფსონი დაბრუნდა';
      case 'sbuy': return 'აქციების ყიდვა: ' + h.n + ' ' + h.t;
      case 'ssell': return 'აქციების გაყიდვა: ' + h.n + ' ' + h.t + ' (' + Z.sfmt(h.pnl || 0) + ')';
      case 'lnout': return 'სესხის შეთავაზება: ' + nm(h.p);
      case 'lnin': return 'სესხი მიიღე: ' + nm(h.p);
      case 'lnpay': return 'სესხი დაფარე: ' + nm(h.p);
      case 'lndef': return 'სესხი ვერ დაფარე სრულად: ' + nm(h.p);
      case 'lnrec': return 'სესხი დაგიბრუნდა: ' + nm(h.p);
      case 'lnlost': return 'სესხი ნაწილობრივ დაგიბრუნდა: ' + nm(h.p);
      case 'lnback': return 'სესხის შეთავაზება დაიხურა';
      case 'cwin': return 'კლანის კვირის პრიზი';
      case 'cc': return 'კლანის შექმნა';
      case 'cdon': return 'შემოწირულობა კლანის ხაზინაში';
      case 'cpay': return 'კლანის ხაზინიდან გაცემა';
      case 'cb': return 'ქეშბექი: ' + Z.gameName(h.g);
      case 'abid': return 'ფსონი აუქციონზე: ' + Z.itemName(h.i);
      case 'aref': return 'აუქციონის ფსონი დაბრუნდა: ' + Z.itemName(h.i);
      case 'asold': return 'გაიყიდა აუქციონზე: ' + Z.itemName(h.i);
      case 'dp': return 'ანაბრის გახსნა: ' + h.days + ' დღე';
      case 'dpx': return 'ანაბარი ვადაზე ადრე დაიხურა';
      case 'dpm': return 'ანაბარი დასრულდა: +' + Z.fmt(h.i || 0) + ' პროცენტი';
      case 'pass': return 'სეზონის საშვი: საფეხური ' + h.t;
      case 'tok': return h.h === 'newyear' ? 'დაჭერილი ფიფქი' : 'დაჭერილი გოგრა';
      case 'ref': return 'მოწვევის ბონუსი';
      case 'refb': return 'მოწვეულმა მეგობარმა ბონუსი მოგიტანა: ' + nm(h.p);
      case 'pkin': return 'პოკერი: მაგიდასთან დაჯდომა';
      case 'pkout': return 'პოკერი: მაგიდიდან ადგომა' + (h.net ? ' (' + Z.sfmt(h.net) + ')' : '');
      case 'bgb': return 'ბინგოს ბარათი ×' + (h.n || 1);
      case 'bgw': return 'ბინგო! მოგება';
      case 'tax': return 'ქონების გადასახადი';
      default: return h.k || '';
    }
  };
  // notifications (bell)
  Z.noteText = (n) => {
    const m = n.meta || {}, d = n.d;
    switch (n.k) {
      case 'round': return 'რაუნდი #' + Z.roundNo(m.c) + ' დასრულდა: ' + (d > 0 ? 'შენმა ინვესტიციამ მოიგო' : d < 0 ? 'შენმა ინვესტიციამ წააგო' : 'შედეგი ნულოვანია');
      case 'ach': { const a = Z.achDef && Z.achDef(m.a); return 'ახალი მიღწევა: ' + (a ? a.name : m.a); }
      case 'lvl': return 'ახალი VIP დონე: ' + (Z.LEVELS[m.i] || {}).name;
      case 'a': return Z.histText({ k: 'a', d, delta: d, n: m.n });
      case 'ti': return Z.histText({ k: 'ti', p: m.p, n: m.n });
      case 'ref': return 'მოწვევის ბონუსი: ' + Z.fmt(d) + ' კოინი';
      case 'refb': return 'მოწვეული მეგობარი აქტიური გახდა, მიიღე ბონუსი: ' + nm(m.p);
      case 'lw': return 'მოიგე კვირის ლატარია!';
      case 'tw': return 'კვირის ტურნირი: ' + m.r + ' ადგილი!';
      case 'aexp': return 'აუქციონზე არავინ იყიდა, ნივთი დაგიბრუნდა: ' + Z.itemName(m.i);
      case 'asold': return 'აუქციონზე გაიყიდა: ' + Z.itemName(m.i) + ' · ' + nm(m.p);
      case 'awon': return 'აუქციონი მოიგე: ' + Z.itemName(m.i);
      case 'aout': return 'აუქციონზე გადაგასწრეს: ' + Z.itemName(m.i) + ', ფსონი დაგიბრუნდა';
      case 'dpm': return 'ანაბარი დასრულდა: +' + Z.fmt(d) + ' პროცენტი';
      case 'insoff': return 'დაზღვევა გაითიშა: შენატანისთვის ბალანსი არ იყო საკმარისი';
      case 'creq': return 'კლანში გაწევრიანებას ითხოვს: ' + nm(m.p);
      case 'cok': return 'მიგიღეს კლანში „' + m.c + '“';
      case 'cno': return 'კლანმა „' + m.c + '“ მოთხოვნა უარყო';
      case 'ckick': return 'კლანიდან „' + m.c + '“ გაგრიცხეს';
      case 'cgone': return 'კლანი „' + m.c + '“ დაიშალა' + (d ? ', ხაზინიდან მიიღე ' + Z.fmt(d) : '');
      case 'cpay': return 'კლანის ხაზინიდან მიიღე ' + Z.fmt(d) + ' კოინი';
      case 'cwar': return 'შენმა კლანმა მოიგო კლანების ომი! ხაზინას დაემატა ' + Z.fmt(d);
      case 'cwin': return 'შენი კლანი კვირის საუკეთესოა: +' + Z.fmt(d);
      case 'lnoffer': return 'სესხის შეთავაზება: ' + nm(m.p) + ' · ' + Z.fmt(d) + ' კოინი, ' + m.r + '%, ' + m.d + ' დღე';
      case 'lnacc': return 'შენი სესხი მიიღო: ' + nm(m.p);
      case 'lndec': return 'სესხზე უარი თქვა: ' + nm(m.p) + '. თანხა დაგიბრუნდა';
      case 'lnrec': return 'სესხი დაგიბრუნა: ' + nm(m.p);
      case 'lnlost': return 'სესხი სრულად ვერ დაფარა: ' + nm(m.p);
      case 'lnauto': return 'სესხის ვადა გავიდა, თანხა ავტომატურად ჩამოიჭრა';
      case 'lndef': return 'სესხის ვადა გავიდა და ბალანსი არ გეყო: სესხი გადაუხდელია';
      case 'pwin': return 'პროგნოზი გამართლდა ' + q(m.q);
      case 'plose': return 'პროგნოზი არ გამართლდა ' + q(m.q);
      case 'pref': return 'პროგნოზი გაუქმდა, ფსონი დაბრუნდა';
      case 'duel': return 'დუელში გიწვევს: ' + nm(m.p) + ' · ' + Z.fmt(d) + ' კოინი';
      case 'dw': return 'დუელი მოიგე: ' + nm(m.p);
      case 'dl': return 'დუელი წააგე: ' + nm(m.p);
      case 'tax': return 'ქონების გადასახადი';
      case 'bgw': return 'ბინგო! მოიგე ' + Z.fmt(d) + ' კოინი';
      default: return n.k;
    }
  };
  // public feed
  Z.feedText = (f) => {
    const m = f.meta || {};
    switch (f.k) {
      case 'g': return Z.gameName(m.g) + (m.m ? ' ×' + m.m : '');
      case 'iw': return 'ინვესტიცია მოიგო';
      case 'il': return 'ინვესტიცია წააგო';
      case 'lw': return 'ლატარია მოიგო';
      case 'dw': return 'დუელი მოიგო';
      case 'tw': return 'ტურნირის ' + m.r + ' ადგილი';
      case 'box': return 'ყუთიდან ლეგენდარული ნივთი: ' + Z.itemName(m.i);
      case 'pk': return 'პოკერის მაგიდასთან მოიგო';
      case 'bgw': return 'ბინგო!';
      default: return f.k;
    }
  };
})();
