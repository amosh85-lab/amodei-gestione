// /guida — guida rapida personalizzata per ruolo + lingua.
//
// IMPORTANTE: i TITOLI delle sezioni restano in ITALIANO (riferiscono nomi
// reali della UI italiana — "Cassa", "Turni", ecc.). Solo le DESCRIZIONI
// (e i messaggi UI come "Lingua", "Se qualcosa non funziona") sono tradotti.
//
// admin → solo italiano (Amos)
// manager/staff → IT + descrizioni in EN, UK, BN, KA, RU
// Lingua selezionata persistita in localStorage.

import { getCurrentUser } from '../js/auth.js';
import { setHeader } from '../js/app-shell.js';
import { navigate } from '../js/router.js';
import { icon } from '../js/icons.js';

const LANG_KEY = 'amodei.guide_lang';
const LANGS = [
  { code: 'it', label: '🇮🇹 Italiano' },
  { code: 'en', label: '🇬🇧 English' },
  { code: 'uk', label: '🇺🇦 Українська' },
  { code: 'bn', label: '🇧🇩 বাংলা' },
  { code: 'ka', label: '🇬🇪 ქართული' },
  { code: 'ru', label: '🇷🇺 Русский' },
];

export async function mountGuide(container, _params, _query) {
  const user = getCurrentUser();
  const role = user?.role || 'staff';

  setHeader({ title: 'Guida rapida', brand: true, backHref: '/' });

  let lang = 'it';
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved && LANGS.some((l) => l.code === saved)) lang = saved;
  } catch (_) {}

  function render() {
    const showLangPicker = role !== 'admin';
    container.innerHTML = `
      <section class="container container--narrow" style="padding-block: var(--space-20); padding-bottom: 96px;">
        <div class="card card--elevated" style="padding: var(--space-16); margin-bottom: var(--space-16);">
          <p class="muted text-xs" style="margin:0; text-transform: uppercase; letter-spacing: var(--letter-spacing-wide);">${UI[lang].loggedAs}</p>
          <p style="margin: var(--space-4) 0 0 0; font-family: var(--font-display); font-size: 1.4rem; font-weight: 600;">${escapeHtml(user?.full_name || '')} <span class="badge badge--success" style="margin-left: var(--space-4);">${escapeHtml(role)}</span></p>
          ${showLangPicker ? `
            <div style="margin-top: var(--space-12);">
              <label class="label" for="lang-picker" style="margin:0;">${UI[lang].languageLabel}</label>
              <select id="lang-picker" class="input">
                ${LANGS.map((l) => `<option value="${l.code}" ${lang === l.code ? 'selected' : ''}>${l.label}</option>`).join('')}
              </select>
            </div>
          ` : ''}
        </div>

        ${role === 'admin' ? renderAdminGuideIT()
          : role === 'manager' ? renderManagerGuide(lang)
          : renderStaffGuide(lang)}

        <div style="margin-top: var(--space-20); padding: var(--space-16); border: 1px dashed var(--border-strong); border-radius: var(--radius-md); background: var(--cream-soft);">
          <p style="margin:0; font-weight: 500;">${UI[lang].troubleTitle}</p>
          <p class="muted text-sm" style="margin: var(--space-4) 0 0 0;">${UI[lang].troubleText}</p>
        </div>
      </section>
    `;

    container.querySelector('#lang-picker')?.addEventListener('change', (e) => {
      lang = e.target.value;
      try { localStorage.setItem(LANG_KEY, lang); } catch (_) {}
      render();
    });
    container.querySelectorAll('[data-go]').forEach((b) => {
      b.addEventListener('click', () => navigate(b.dataset.go));
    });
  }

  render();
}

// =========================================================================
// UI labels comuni (etichette interfaccia, queste sì tradotte)
// =========================================================================

const UI = {
  it: { loggedAs: 'Stai entrando come',  languageLabel: 'Lingua',
        troubleTitle: 'Se qualcosa non funziona',
        troubleText: 'Chiudi e riapri l\'app. Se persiste, chiama l\'amministratore.' },
  en: { loggedAs: 'Logged in as',         languageLabel: 'Language',
        troubleTitle: 'If something doesn\'t work',
        troubleText: 'Close and reopen the app. If the issue persists, call the administrator.' },
  uk: { loggedAs: 'Ви увійшли як',        languageLabel: 'Мова',
        troubleTitle: 'Якщо щось не працює',
        troubleText: 'Закрийте та відкрийте додаток знову. Якщо проблема залишається, зверніться до адміністратора.' },
  bn: { loggedAs: 'লগ ইন করেছেন',         languageLabel: 'ভাষা',
        troubleTitle: 'কিছু কাজ না করলে',
        troubleText: 'অ্যাপটি বন্ধ করে আবার খুলুন। সমস্যা থাকলে অ্যাডমিনিস্ট্রেটরকে কল করুন।' },
  ka: { loggedAs: 'ავტორიზებული ხართ როგორც', languageLabel: 'ენა',
        troubleTitle: 'თუ რამე არ მუშაობს',
        troubleText: 'დახურეთ და თავიდან გახსენით აპლიკაცია. თუ პრობლემა გრძელდება, დარეკეთ ადმინისტრატორთან.' },
  ru: { loggedAs: 'Вы вошли как',         languageLabel: 'Язык',
        troubleTitle: 'Если что-то не работает',
        troubleText: 'Закройте и откройте приложение заново. Если проблема не исчезает, позвоните администратору.' },
};

// =========================================================================
// STAFF GUIDE: struttura comune (titoli IT) + descrizioni per lingua
// =========================================================================

// Titoli, numerazione, route, btn label — SEMPRE in italiano (corrispondono
// alla UI dell'app).
const STAFF_BASE = {
  introTitle: 'Le 3 cose principali',
  sections: [
    { num: '1', title: '🟡 Segnalare scorte che finiscono', route: '/segnala', btn: 'Segnala scorta' },
    { num: '2', title: '💸 Registrare una spesa fatta in cassa', route: '/cassa', btn: 'Apri Cassa' },
    { num: '3', title: '🧾 Chiudere POS a fine servizio', route: '/cassa', btn: 'Apri Cassa' },
  ],
  otherTitle: 'Altre cose utili',
};

// Solo testo descrittivo per ogni lingua.
const STAFF_TEXT = {
  it: {
    introSubtitle: 'Quello che ti serve sapere ogni giorno.',
    bodies: [
      'Vai su <strong>Segnala</strong> dalla home. Cerca il prodotto, tocca <strong>SCARSO</strong> o <strong>FINITO</strong>. Il prodotto sparisce dalla lista, l\'amministrazione viene avvisata.',
      'Vai su <strong>Cassa → Pranzo</strong> (o <strong>Cena</strong>). Nella sezione <strong>Spese</strong> tocca <strong>+ Aggiungi spesa</strong>. Compila descrizione, importo, categoria. Se puoi, scatta foto dello scontrino.',
      'Vai su <strong>Cassa → Pranzo</strong> (o <strong>Cena</strong> a fine sera). Tocca <strong>Chiudi sessione POS</strong>, inserisci il totale incassato col POS, conferma.',
    ],
    otherItems: [
      '<strong>Pasti staff:</strong> se mangi al bar, registra il pasto da <strong>Pasti staff</strong>',
      '<strong>I miei turni:</strong> vedi quante ore hai fatto questo mese da <strong>I miei turni</strong>',
      'Cose che NON puoi vedere: stipendi, fatture, pagamenti, acconti dei colleghi. È normale.',
    ],
  },
  en: {
    introSubtitle: 'What you need to know every day.',
    bodies: [
      'Go to <strong>Segnala</strong> from the home screen. Find the product, tap <strong>SCARSO</strong> (low) or <strong>FINITO</strong> (out). The product disappears from the list, the administration is notified.',
      'Go to <strong>Cassa → Pranzo</strong> (lunch) or <strong>Cena</strong> (dinner). In the <strong>Spese</strong> section tap <strong>+ Aggiungi spesa</strong>. Fill in description, amount, category. If you can, take a photo of the receipt.',
      'Go to <strong>Cassa → Pranzo</strong> or <strong>Cena</strong> at end of night. Tap <strong>Chiudi sessione POS</strong>, enter the total collected via POS, confirm.',
    ],
    otherItems: [
      '<strong>Pasti staff:</strong> if you eat at the bar, record the meal from <strong>Pasti staff</strong>',
      '<strong>I miei turni:</strong> see how many hours you worked this month from <strong>I miei turni</strong>',
      'Things you CAN\'T see: salaries, invoices, payments, advances given to colleagues. This is normal.',
    ],
  },
  uk: {
    introSubtitle: 'Що вам потрібно знати щодня.',
    bodies: [
      'Перейдіть до <strong>Segnala</strong> на головному екрані. Знайдіть продукт, торкніться <strong>SCARSO</strong> (мало) або <strong>FINITO</strong> (закінчилося). Продукт зникне зі списку, адміністрація отримає сповіщення.',
      'Перейдіть до <strong>Cassa → Pranzo</strong> (обід) або <strong>Cena</strong> (вечеря). У розділі <strong>Spese</strong> торкніться <strong>+ Aggiungi spesa</strong>. Заповніть опис, суму, категорію. Якщо можете — сфотографуйте чек.',
      'Перейдіть до <strong>Cassa → Pranzo</strong> або <strong>Cena</strong> наприкінці вечора. Торкніться <strong>Chiudi sessione POS</strong>, введіть загальну суму, отриману через POS, підтвердіть.',
    ],
    otherItems: [
      '<strong>Pasti staff:</strong> якщо їсте в барі, зареєструйте прийом їжі в розділі <strong>Pasti staff</strong>',
      '<strong>I miei turni:</strong> подивіться скільки годин ви відпрацювали цього місяця в <strong>I miei turni</strong>',
      'Що ви НЕ можете побачити: зарплати, рахунки, платежі, аванси колег. Це нормально.',
    ],
  },
  bn: {
    introSubtitle: 'প্রতিদিন যা জানা প্রয়োজন।',
    bodies: [
      'হোম স্ক্রিন থেকে <strong>Segnala</strong>-এ যান। পণ্য খুঁজুন, <strong>SCARSO</strong> (কম) বা <strong>FINITO</strong> (শেষ) ট্যাপ করুন। পণ্যটি তালিকা থেকে চলে যাবে, প্রশাসন বিজ্ঞপ্তি পাবে।',
      '<strong>Cassa → Pranzo</strong> (দুপুর) বা <strong>Cena</strong> (রাত)-এ যান। <strong>Spese</strong> বিভাগে <strong>+ Aggiungi spesa</strong> ট্যাপ করুন। বিবরণ, পরিমাণ, ক্যাটাগরি পূরণ করুন। সম্ভব হলে রসিদের ছবি তুলুন।',
      'রাত শেষে <strong>Cassa → Pranzo</strong> বা <strong>Cena</strong>-তে যান। <strong>Chiudi sessione POS</strong> ট্যাপ করুন, POS-এ সংগ্রহকৃত মোট পরিমাণ লিখুন, নিশ্চিত করুন।',
    ],
    otherItems: [
      '<strong>Pasti staff:</strong> বারে খেলে, <strong>Pasti staff</strong> থেকে রেকর্ড করুন',
      '<strong>I miei turni:</strong> <strong>I miei turni</strong>-এ এই মাসে কত ঘণ্টা কাজ করেছেন দেখুন',
      'যা আপনি দেখতে পারবেন না: বেতন, বিল, পেমেন্ট, সহকর্মীদের অগ্রিম। এটা স্বাভাবিক।',
    ],
  },
  ka: {
    introSubtitle: 'რა უნდა იცოდე ყოველდღე.',
    bodies: [
      'მთავარი ეკრანიდან გადადით <strong>Segnala</strong>-ზე. იპოვეთ პროდუქტი, შეეხეთ <strong>SCARSO</strong> (ცოტა) ან <strong>FINITO</strong> (დასრულდა). პროდუქტი გაქრება სიიდან, ადმინისტრაცია მიიღებს შეტყობინებას.',
      'გადადით <strong>Cassa → Pranzo</strong> (სადილი) ან <strong>Cena</strong> (ვახშამი)-ზე. <strong>Spese</strong> განყოფილებაში შეეხეთ <strong>+ Aggiungi spesa</strong>. შეავსეთ აღწერა, თანხა, კატეგორია. შესაძლებლობის შემთხვევაში გადაიღეთ ჩეკის ფოტო.',
      'საღამოს ბოლოს გადადით <strong>Cassa → Pranzo</strong> ან <strong>Cena</strong>-ზე. შეეხეთ <strong>Chiudi sessione POS</strong>, შეიყვანეთ POS-ით ნაშოვნი მთლიანი თანხა, დაადასტურეთ.',
    ],
    otherItems: [
      '<strong>Pasti staff:</strong> თუ ბარში ჭამ, ჩაიწერე კვება <strong>Pasti staff</strong>-დან',
      '<strong>I miei turni:</strong> ნახე ამ თვეში რამდენი საათი იმუშავე <strong>I miei turni</strong>-დან',
      'რას ვერ ხედავ: ხელფასები, ანგარიშები, გადახდები, კოლეგების ავანსები. ეს ნორმალურია.',
    ],
  },
  ru: {
    introSubtitle: 'Что нужно знать каждый день.',
    bodies: [
      'Перейдите в <strong>Segnala</strong> с главного экрана. Найдите продукт, нажмите <strong>SCARSO</strong> (мало) или <strong>FINITO</strong> (закончилось). Продукт исчезнет из списка, администрация получит уведомление.',
      'Перейдите в <strong>Cassa → Pranzo</strong> (обед) или <strong>Cena</strong> (ужин). В разделе <strong>Spese</strong> нажмите <strong>+ Aggiungi spesa</strong>. Заполните описание, сумму, категорию. Если можете — сфотографируйте чек.',
      'В конце вечера перейдите в <strong>Cassa → Pranzo</strong> или <strong>Cena</strong>. Нажмите <strong>Chiudi sessione POS</strong>, введите общую сумму, полученную через POS, подтвердите.',
    ],
    otherItems: [
      '<strong>Pasti staff:</strong> если едите в баре, зарегистрируйте приём пищи в <strong>Pasti staff</strong>',
      '<strong>I miei turni:</strong> посмотрите сколько часов отработали в этом месяце в <strong>I miei turni</strong>',
      'Что вы НЕ можете видеть: зарплаты, счета, платежи, авансы коллег. Это нормально.',
    ],
  },
};

// =========================================================================
// MANAGER GUIDE: struttura comune + descrizioni per lingua
// =========================================================================

const MANAGER_BASE = {
  introTitle: 'Cosa fai tu',
  sections: [
    { num: '💰', title: 'Cassa giornaliera',       route: '/cassa',     btn: 'Cassa oggi' },
    { num: '🛒', title: 'Riordini ai fornitori',   route: '/riordini',  btn: 'Apri Riordini' },
    { num: '🧾', title: 'Fatture',                  route: '/fatture',   btn: 'Fatture' },
    { num: '🕒', title: 'Turni dei dipendenti',     route: '/turni',     btn: 'Turni di oggi' },
    { num: '💸', title: 'Acconti dipendenti',       route: '/acconti',   btn: 'Vedi acconti' },
  ],
  otherTitle: 'Quello che NON puoi vedere',
};

const MANAGER_TEXT = {
  it: {
    introSubtitle: 'Gestisci la giornata operativa: cassa, riordini, fatture, turni dello staff.',
    bodies: [
      'Tab <strong>Pranzo</strong> → chiudi POS pranzo + aggiungi spese + inserisci cash extra fondo (NETTO). Tab <strong>Cena</strong> → idem a fine giornata. Tab <strong>Totale</strong> mostra il calcolato + confronto con fiscale + Ipratico.',
      '<strong>Riordini → Aperte</strong>: vedi le segnalazioni dello staff raggruppate per fornitore. Tocca <strong>Prepara ordine</strong> per generare una bozza e mandare il WhatsApp al fornitore. <strong>Riordini → Previsti</strong> ti dice automaticamente quanto manca a ogni stockout.',
      'Tutti i giorni: <strong>Fatture → + Nuova</strong> per registrare le fatture dei fornitori (importo, data, foto). Filtri per periodo/categoria/fornitore.',
      'Ogni giorno: <strong>Turni</strong> → scegli la data, inserisci le ore di chi ha lavorato (stepper + tasti rapidi 4/6/8h), salva tutto in un colpo. <strong>Turni settimanale</strong> ti mostra chi è in straordinario.',
      'Da <strong>Cassa → Pranzo/Cena → Aggiungi acconto</strong> registri gli anticipi dati ai ragazzi. Specifica per quale busta è (default automatico). La vista <strong>Acconti</strong> li raggruppa per mese di riferimento.',
    ],
    otherItems: [
      'Stato pagato/non-pagato delle fatture (solo admin)',
      'Pagamenti effettuati ai fornitori e scadenziario',
      'Stipendi calcolati, tariffe orarie e ore contrattuali specifiche dei colleghi',
      'Impostazioni di sistema (fondo cassa, soglie, utenti)',
    ],
  },
  en: {
    introSubtitle: 'You handle the day-to-day: cash, reorders, invoices, staff shifts.',
    bodies: [
      '<strong>Pranzo</strong> tab → close lunch POS + add expenses + enter cash above the float (NET of float). <strong>Cena</strong> tab → same at end of day. <strong>Totale</strong> tab shows the computed total + comparison with fiscal + Ipratico.',
      '<strong>Riordini → Aperte</strong>: see staff alerts grouped by supplier. Tap <strong>Prepara ordine</strong> to generate a draft and send the WhatsApp to the supplier. <strong>Riordini → Previsti</strong> tells you automatically how much time before each stockout.',
      'Every day: <strong>Fatture → + Nuova</strong> to record supplier invoices (amount, date, photo). Filters by period / category / supplier.',
      'Every day: <strong>Turni</strong> → pick the date, enter hours for everyone who worked (stepper + quick buttons 4/6/8h), save it all at once. <strong>Turni settimanale</strong> shows you who is over contract hours.',
      'From <strong>Cassa → Pranzo/Cena → Aggiungi acconto</strong> you record advances given to staff. Specify which payroll it belongs to (automatic default). The <strong>Acconti</strong> view groups them by reference month.',
    ],
    otherItems: [
      'Paid/unpaid status of invoices (admin only)',
      'Payments made to suppliers and payment schedule',
      'Calculated salaries, hourly rates, specific contract hours of colleagues',
      'System settings (cash float, thresholds, users)',
    ],
  },
  uk: {
    introSubtitle: 'Ви керуєте щоденними операціями: каса, замовлення, рахунки, зміни персоналу.',
    bodies: [
      'Вкладка <strong>Pranzo</strong> → закрийте POS обіду + додайте витрати + введіть готівку понад фонд каси (ЧИСТО). Вкладка <strong>Cena</strong> → те ж саме в кінці дня. Вкладка <strong>Totale</strong> показує розрахункову суму + порівняння з фіскальним + Ipratico.',
      '<strong>Riordini → Aperte</strong>: дивіться сповіщення персоналу за постачальниками. Торкніться <strong>Prepara ordine</strong> щоб створити чернетку та надіслати WhatsApp постачальнику. <strong>Riordini → Previsti</strong> автоматично каже, скільки часу до кожного закінчення запасу.',
      'Щодня: <strong>Fatture → + Nuova</strong> для реєстрації рахунків постачальників (сума, дата, фото). Фільтри за періодом / категорією / постачальником.',
      'Щодня: <strong>Turni</strong> → виберіть дату, введіть години для всіх, хто працював (степер + швидкі кнопки 4/6/8 год), збережіть все одразу. <strong>Turni settimanale</strong> показує, хто понад контракт.',
      'З <strong>Cassa → Pranzo/Cena → Aggiungi acconto</strong> ви реєструєте аванси, видані персоналу. Вкажіть, до якої зарплати належить (автоматичний default). Розділ <strong>Acconti</strong> групує їх за місяцем нарахування.',
    ],
    otherItems: [
      'Статус оплачено/неоплачено рахунків (тільки адмін)',
      'Платежі, здійснені постачальникам, та графік платежів',
      'Розраховані зарплати, погодинні ставки, контрактні години колег',
      'Системні налаштування (фонд каси, пороги, користувачі)',
    ],
  },
  bn: {
    introSubtitle: 'আপনি দৈনন্দিন কাজ সামলান: ক্যাশ, পুনর্নবীকরণ, বিল, কর্মীদের শিফট।',
    bodies: [
      '<strong>Pranzo</strong> ট্যাব → দুপুরের POS বন্ধ করুন + খরচ যোগ করুন + ফান্ডের উপরে নগদ লিখুন (নেট)। <strong>Cena</strong> ট্যাব → দিনের শেষে একই। <strong>Totale</strong> ট্যাবে গণনা করা মোট + ফিসকেল + Ipratico-এর সঙ্গে তুলনা দেখা যাবে।',
      '<strong>Riordini → Aperte</strong>: কর্মীদের রিপোর্ট সরবরাহকারী অনুযায়ী দেখুন। <strong>Prepara ordine</strong> ট্যাপ করে খসড়া তৈরি করুন এবং সরবরাহকারীকে WhatsApp পাঠান। <strong>Riordini → Previsti</strong> স্বয়ংক্রিয়ভাবে বলে দেয় প্রতিটি স্টকআউট পর্যন্ত কত সময় বাকি।',
      'প্রতিদিন: <strong>Fatture → + Nuova</strong> সরবরাহকারীদের বিল নথিভুক্ত করতে (পরিমাণ, তারিখ, ছবি)। সময়কাল / ক্যাটাগরি / সরবরাহকারী দ্বারা ফিল্টার।',
      'প্রতিদিন: <strong>Turni</strong> → তারিখ বাছুন, যারা কাজ করেছে তাদের ঘণ্টা লিখুন (স্টেপার + দ্রুত বাটন 4/6/8 ঘণ্টা), একসাথে সব সেভ করুন। <strong>Turni settimanale</strong> দেখায় কে চুক্তির বেশি কাজ করেছে।',
      '<strong>Cassa → Pranzo/Cena → Aggiungi acconto</strong> থেকে কর্মীদের দেওয়া অগ্রিম নথিভুক্ত করুন। কোন বেতনের জন্য তা নির্দিষ্ট করুন (স্বয়ংক্রিয় ডিফল্ট)। <strong>Acconti</strong> ভিউ তাদের রেফারেন্স মাস অনুযায়ী গ্রুপ করে।',
    ],
    otherItems: [
      'বিলের পরিশোধিত/অপরিশোধিত অবস্থা (শুধু অ্যাডমিন)',
      'সরবরাহকারীদের করা পেমেন্ট এবং পেমেন্ট সময়সূচী',
      'গণনা করা বেতন, ঘণ্টা প্রতি হার, সহকর্মীদের নির্দিষ্ট চুক্তি ঘণ্টা',
      'সিস্টেম সেটিংস (ক্যাশ ফান্ড, থ্রেশহোল্ড, ব্যবহারকারী)',
    ],
  },
  ka: {
    introSubtitle: 'მართავთ ყოველდღიურ ოპერაციებს: სალარო, შეკვეთები, ანგარიშები, თანამშრომელთა ცვლები.',
    bodies: [
      'ჩანართი <strong>Pranzo</strong> → დახურეთ სადილის POS + დაამატეთ ხარჯები + შეიყვანეთ ნაღდი ფული ფონდის გარდა (წმინდა). ჩანართი <strong>Cena</strong> → იგივე დღის ბოლოს. ჩანართი <strong>Totale</strong> აჩვენებს გათვლილ ჯამს + შედარებას ფისკალურთან + Ipratico-სთან.',
      '<strong>Riordini → Aperte</strong>: ნახე თანამშრომელთა შეტყობინებები მომწოდებლების მიხედვით. შეეხე <strong>Prepara ordine</strong>-ს რომ შექმნა მონახაზი და გაუგზავნო WhatsApp მომწოდებელს. <strong>Riordini → Previsti</strong> ავტომატურად გეტყვის რამდენი დრო რჩება თითოეული მარაგის ამოწურვამდე.',
      'ყოველდღე: <strong>Fatture → + Nuova</strong> მომწოდებლების ანგარიშების რეგისტრაციისთვის (თანხა, თარიღი, ფოტო). ფილტრები პერიოდის / კატეგორიის / მომწოდებლის მიხედვით.',
      'ყოველდღე: <strong>Turni</strong> → აირჩიე თარიღი, შეიყვანე საათები ყველასთვის ვინც იმუშავა (სტეპერი + სწრაფი ღილაკები 4/6/8 საათი), შეინახე ერთად. <strong>Turni settimanale</strong> გიჩვენებს ვინ მუშაობს კონტრაქტზე ზევით.',
      '<strong>Cassa → Pranzo/Cena → Aggiungi acconto</strong>-დან არეგისტრირებთ თანამშრომლებზე გაცემულ ავანსებს. მიუთითე რომელ ხელფასს ეკუთვნის (ავტომატური default). <strong>Acconti</strong> ხედი მათ ჯგუფავს მითითებული თვის მიხედვით.',
    ],
    otherItems: [
      'ანგარიშების გადახდილი/გადაუხდელი სტატუსი (მხოლოდ ადმინი)',
      'მომწოდებლებზე გაცემული გადახდები და გადახდის გრაფიკი',
      'გათვლილი ხელფასები, საათობრივი ტარიფები, კოლეგების სპეციფიური საკონტრაქტო საათები',
      'სისტემის პარამეტრები (სალაროს ფონდი, ზღურბლები, მომხმარებლები)',
    ],
  },
  ru: {
    introSubtitle: 'Вы управляете повседневной работой: касса, заказы, счета, смены персонала.',
    bodies: [
      'Вкладка <strong>Pranzo</strong> → закройте POS обеда + добавьте расходы + введите наличные сверх фонда (ЧИСТО). Вкладка <strong>Cena</strong> → то же в конце дня. Вкладка <strong>Totale</strong> показывает расчётную сумму + сравнение с фискальным + Ipratico.',
      '<strong>Riordini → Aperte</strong>: смотрите уведомления персонала, сгруппированные по поставщикам. Нажмите <strong>Prepara ordine</strong>, чтобы создать черновик и отправить WhatsApp поставщику. <strong>Riordini → Previsti</strong> автоматически говорит, сколько времени до каждой нехватки.',
      'Каждый день: <strong>Fatture → + Nuova</strong> для регистрации счетов поставщиков (сумма, дата, фото). Фильтры по периоду / категории / поставщику.',
      'Каждый день: <strong>Turni</strong> → выберите дату, введите часы для всех, кто работал (степпер + быстрые кнопки 4/6/8 ч), сохраните всё сразу. <strong>Turni settimanale</strong> показывает, кто работает сверх контракта.',
      'Из <strong>Cassa → Pranzo/Cena → Aggiungi acconto</strong> регистрируете авансы, выданные персоналу. Укажите, к какой зарплате относится (автоматический default). Раздел <strong>Acconti</strong> группирует их по месяцу начисления.',
    ],
    otherItems: [
      'Статус оплачено/неоплачено счетов (только админ)',
      'Платежи поставщикам и график платежей',
      'Рассчитанные зарплаты, почасовые ставки, контрактные часы коллег',
      'Системные настройки (фонд кассы, пороги, пользователи)',
    ],
  },
};

// =========================================================================
// Renderers
// =========================================================================

function renderStaffGuide(lang) {
  return renderRoleGuide(STAFF_BASE, STAFF_TEXT[lang] || STAFF_TEXT.it);
}

function renderManagerGuide(lang) {
  return renderRoleGuide(MANAGER_BASE, MANAGER_TEXT[lang] || MANAGER_TEXT.it);
}

function renderRoleGuide(base, text) {
  // base contiene titoli IT (introTitle, sections[].title, otherTitle, num, route, btn).
  // text contiene SOLO descrizioni nella lingua scelta (introSubtitle, bodies[], otherItems[]).
  return `
    <h2 class="font-display" style="margin: var(--space-12) 0 var(--space-4) 0; font-size: 1.4rem;">${base.introTitle}</h2>
    <p class="muted text-sm" style="margin: 0 0 var(--space-16) 0;">${text.introSubtitle}</p>
    ${base.sections.map((s, i) => section(s, text.bodies[i] || '')).join('')}
    <h2 class="font-display" style="margin: var(--space-20) 0 var(--space-8) 0; font-size: 1.2rem;">${base.otherTitle}</h2>
    <ul style="padding-left: var(--space-20); margin: 0;">
      ${(text.otherItems || []).map((it) => `<li class="text-sm" style="margin-bottom: var(--space-4);">${it}</li>`).join('')}
    </ul>
  `;
}

function section(s, body) {
  return `
    <div class="card" style="padding: var(--space-16); margin-bottom: var(--space-12);">
      <div style="display: flex; align-items: baseline; gap: var(--space-8); margin-bottom: var(--space-8);">
        <span style="font-family: var(--font-display); font-size: 1.2rem; color: var(--terracotta);">${s.num}</span>
        <p style="margin:0; font-weight: 600;">${s.title}</p>
      </div>
      <p class="text-sm" style="margin: 0 0 var(--space-12) 0;">${body}</p>
      ${s.route ? `<button type="button" data-go="${s.route}" class="btn btn--secondary btn--sm">${escapeHtml(s.btn || 'Vai')}</button>` : ''}
    </div>
  `;
}

// =========================================================================
// ADMIN GUIDE (solo italiano)
// =========================================================================

function renderAdminGuideIT() {
  return `
    <h2 class="font-display" style="margin: var(--space-12) 0 var(--space-4) 0; font-size: 1.4rem;">Hai accesso a tutto</h2>
    <p class="muted text-sm" style="margin: 0 0 var(--space-16) 0;">Sei l'unico che può vedere stipendi, pagamenti, impostazioni di sistema, dati sensibili.</p>

    ${section({ num: '💰', title: 'Cassa, riordini, fatture', route: '/cassa', btn: 'Apri Cassa' },
      'Stesse cose del manager: <strong>Cassa</strong>, <strong>Riordini</strong>, <strong>Fatture</strong>, <strong>Turni</strong>, <strong>Acconti</strong>. In più tu vedi anche lo stato pagato delle fatture e il scadenziario.')}

    ${section({ num: '📊', title: 'Report di gestione', route: '/food-cost', btn: 'Food Cost' },
      '<strong>Magazzino → Sprechi</strong> (cosa hai buttato e quanto costa). <strong>Magazzino → Margini</strong> (quanto guadagni per prodotto). <strong>Cassa → Statistiche</strong> (trend incassi). <strong>Food Cost</strong> dalla home (incidenza cibo/bevande/consumo sui ricavi).')}

    ${section({ num: '💳', title: 'Pagamenti fornitori', route: '/fatture/da-pagare', btn: 'Scadenziario' },
      '<strong>Fatture → Scadenziario</strong> (icona orologio): vedi le fatture non pagate raggruppate per fornitore, selezioni quelle da saldare e registri il pagamento (bonifico/assegno/contanti). <strong>Fatture → Pagamenti</strong>: storico di tutti i pagamenti fatti.')}

    ${section({ num: '🕒', title: 'Turni e stipendi', route: '/stipendi', btn: 'Apri Stipendi' },
      '<strong>Stipendi</strong> dalla home: a fine mese vedi per ogni dipendente ore × tariffa = lordo − acconti = netto da consegnare. Bottone <strong>"Marca acconti saldati"</strong> li chiude in un click. <strong>Stime operative, non busta reale del commercialista.</strong>')}

    ${section({ num: '⚙️', title: 'Impostazioni', route: '/impostazioni', btn: 'Impostazioni' },
      '<strong>Impostazioni</strong>: fondo cassa (€200 default), categorie spese, soglia food cost (32% default), utenti (puoi aggiungere admin/manager/staff e impostare la tariffa €/h dei dipendenti).')}

    <h2 class="font-display" style="margin: var(--space-20) 0 var(--space-8) 0; font-size: 1.2rem;">Cose da fare periodicamente</h2>
    <ul style="padding-left: var(--space-20); margin: 0;">
      <li class="text-sm" style="margin-bottom: var(--space-4);"><strong>Ogni giorno:</strong> chiudi la cassa a fine servizio — POS + cash + fiscale + Ipratico (la PWA mostra in automatico la giornata operativa anche dopo mezzanotte, fino alle 6:00 del mattino)</li>
      <li class="text-sm" style="margin-bottom: var(--space-4);"><strong>Ogni settimana:</strong> guarda Riordini → Previsti per ordini in arrivo</li>
      <li class="text-sm" style="margin-bottom: var(--space-4);"><strong>Ogni mese:</strong> esporta CSV cassa per il commercialista (Cassa → Storico → 📤), controlla Food Cost, paga gli stipendi dalla pagina Stipendi</li>
      <li class="text-sm" style="margin-bottom: var(--space-4);"><strong>Ogni 6 mesi:</strong> ruota JWT_SECRET su Railway, cambia password admin</li>
    </ul>

    <p class="muted text-xs" style="margin: var(--space-16) 0 0 0;">Per problemi tecnici → <code>docs/MAINTENANCE.md</code> ha il runbook.</p>
  `;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
