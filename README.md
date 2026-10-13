# ზარაფხანა

ვირტუალური კოინების საიტი. ადმინი არიცხავს კოინებს. მოთამაშეები დებენ ოთხ რისკის დონეზე და ყოველ 24 საათში იგებენ შედეგს. საიტზე აგრეთვე არის:

- თამაშები: პოკერი, ბინგო, დუელები და სხვა;
- ბანკი, დაზღვევა, აუქციონი და კლანები;
- სეზონის საშვი;
- სამართლიანი თამაშის (provably fair) შემოწმება.

**ტექნიკური მხარე:**

- ფრონტი სტატიკურია და GitHub Pages-ზე დგას.
- სერვერი არის Supabase: Postgres, RLS და RPC ფუნქციები, ხოლო pg_cron ყოველ წუთს ამუშავებს რაუნდებს.
- ბალანსს მხოლოდ სერვერი ცვლის. ბრაუზერი მხოლოდ კითხულობს მონაცემებს და იძახებს ფუნქციებს.

## 1. ბაზის მომზადება (ერთხელ)

1. Supabase-ში გახსენი პროექტი, მერე **SQL Editor → New query**.
2. ჩასვი ფაილი [`supabase/zarapkhana-setup.sql`](supabase/zarapkhana-setup.sql) მთლიანად და დააჭირე **Run**. თუ გამოჩნდება გაფრთხილება „destructive operation“, დაადასტურე „Run this query“.
3. ფაილის ხელახლა გაშვება უსაფრთხოა: არსებულ მონაცემებს არ შლის, მხოლოდ ანახლებს ფუნქციებს.

> ამ პროექტში (`hpcmgthvyanerhejjhfk`) ბაზის დიდი ნაწილი უკვე დაყენებულია. დარჩენილია მხოლოდ [`supabase/zarapkhana-finish.sql`](supabase/zarapkhana-finish.sql), რომელიც ზემოთ აღწერილი წესით უნდა გაუშვა.

შემოწმება:

```sql
select jobname, schedule from cron.job;        -- უნდა ჩანდეს zar-tick, * * * * *
select count(*) from public.items;             -- მაღაზიის ნივთები (> 0)
```

თუ `cron.job` არ არსებობს, ჩართე გაფართოება **Database → Extensions → pg_cron** და კიდევ ერთხელ გაუშვი setup ფაილი. სანამ cron არ მუშაობს, საიტი თავად „უბიძგებს“ სერვერს, როცა ვინმე შემოდის.

## 2. ავტორიზაცია

**Authentication → URL Configuration:**

- **Site URL:** `https://<მომხმარებელი>.github.io/<რეპო>/`
- **Redirect URLs:** იგივე მისამართი, ბოლოში `**`-ით, მაგ. `https://<მომხმარებელი>.github.io/<რეპო>/**`

**ელფოსტა + პაროლი და ბმული ელფოსტაზე** (Authentication → Providers → Email) ჩართულია თავიდანვე.

- Supabase-ის სტანდარტული ფოსტა საათში მხოლოდ რამდენიმე წერილს აგზავნის.
- რეალური მოხმარებისთვის **Authentication → Emails → SMTP Settings**-ში მიაბი საკუთარი SMTP (მაგ. Resend, Brevo).
- ტესტირებისას შეგიძლია გამორთო „Confirm email“.

**Google:**

1. გახსენი [Google Cloud Console](https://console.cloud.google.com/), მერე **APIs & Services → Credentials → Create credentials → OAuth client ID**, ტიპი **Web application**.
2. **Authorized redirect URI**:
   `https://hpcmgthvyanerhejjhfk.supabase.co/auth/v1/callback`
3. Client ID და Client Secret ჩაწერე Supabase-ში: **Authentication → Providers → Google**, შემდეგ **Enable**.

## 3. პირველი ადმინი

ვინც **პირველი დარეგისტრირდება**, ავტომატურად ადმინი ხდება. მერე ადმინის პანელიდან სხვებსაც შეუძლია მისცეს ადმინის უფლება.

## 4. GitHub Pages

საიტი იხსნება მისამართზე **https://bakakuri.github.io/zarapkhana/**. ფაილებს GitHub Pages `gh-pages` ბრანჩიდან კითხულობს, რომელიც `main`-ის ასლია.

თუ გინდა, რომ Pages პირდაპირ `main`-იდან განახლდეს, გახსენი **Settings → Pages → Build and deployment** და აირჩიე:

- **Source:** Deploy from a branch;
- **Branch:** `main`;
- **Folder:** `/ (root)`.

## ფაილები

| ფაილი | რა არის |
|---|---|
| `index.html`, `app.css` | გვერდი და დიზაინი (ორი თემა, ანიმაციები) |
| `config.js` | Supabase-ის მისამართი და საჯარო (anon) გასაღები |
| `core.js`, `ui.js`, `gate.js` | კავშირი სერვერთან, რეალურ დროში განახლება, შესვლა |
| `views.js`, `extra-ui.js`, `more-ui.js`, `social*.js`, `me.js`, `hist.js` | გვერდები: ინვესტიცია, ბანკი, ბაზარი, კლანები, მაღაზია, ჩემი გვერდი |
| `games*.js`, `play2.js`, `poker.js`, `bingo.js` | თამაშები |
| `admin.js` | ადმინის პანელი |
| `i18n*.js` | ინგლისური თარგმანი |
| `supabase/migrations/*.sql` | ბაზის სქემა ნაწილებად |
| `supabase/zarapkhana-setup.sql` | ყველა მიგრაცია ერთ ფაილში (ახალი პროექტისთვის) |
| `supabase/zarapkhana-finish.sql` | ამ პროექტის დასასრულებელი ნაწილი |

`config.js`-ში მხოლოდ **საჯარო** anon გასაღებია. ის ბრაუზერისთვისაა განკუთვნილი და უსაფრთხოა, რადგან ყველა ჩაწერა RLS-ით და სერვერის ფუნქციებით მოწმდება. `service_role` გასაღები არასდროს ჩაწერო საიტის ფაილებში.

## ადგილობრივად გაშვება

```bash
python3 -m http.server 8080
# გახსენი http://localhost:8080
```

ადგილობრივად შესვლისთვის Supabase-ის Redirect URLs-ში დაამატე `http://localhost:8080/**`.
