// @ts-check

/**
 * Languages: the CLI speaks English and Turkish. The language comes from TWOEARL_LANG, then the
 * usual LC_ALL, LC_MESSAGES and LANG (tr_TR.UTF-8 → Turkish), else English. Messages are written
 * in English and looked up here; anything not in the table (a tool's own output, a server's
 * message) is shown as it is.
 *
 * Adding a language: a table in MESSAGES and its HELP text.
 */

/** @typedef {'en' | 'tr'} Locale */

/** @param {NodeJS.ProcessEnv} env @returns {Locale} */
export function localeFrom(env) {
  for (const name of ['TWOEARL_LANG', 'LC_ALL', 'LC_MESSAGES', 'LANG']) {
    const value = (env[name] ?? '').toLowerCase();
    if (!value || value === 'c' || value === 'posix') continue;
    return value.startsWith('tr') ? 'tr' : 'en';
  }
  return 'en';
}

/** @type {Record<Exclude<Locale, 'en'>, Record<string, string>>} */
const MESSAGES = {
  tr: {
    'Not signed in. Run `2earl login` first.': 'Giriş yapılmadı. Önce `2earl login` çalıştırın.',
    'Your sign-in expired. Run `2earl login`.':
      'Girişinizin süresi doldu. `2earl login` çalıştırın.',
    'Your sign-in expired or was revoked. Run `2earl login`.':
      'Girişinizin süresi doldu ya da iptal edildi. `2earl login` çalıştırın.',
    'Signed in.': 'Giriş yapıldı.',
    'Signed out.': 'Çıkış yapıldı.',
    'You weren’t signed in.': 'Giriş yapmamıştınız.',
    '  Waiting for you to approve…': '  Onaylamanız bekleniyor…',
    '  Open   {0}': '  Açın   {0}',
    '  Code   {0}': '  Kod    {0}',
    '  Or open {0} and check the code matches.':
      '  Ya da {0} adresini açın ve kodun eşleştiğini denetleyin.',
    'Usage: 2earl call <tool> [json arguments]': 'Kullanım: 2earl call <araç> [json argümanları]',
    'Usage: 2earl prompts get <id> [--fill name=value ...]':
      'Kullanım: 2earl prompts get <kimlik> [--fill ad=değer ...]',
    '--fill takes name=value, not "{0}"': '--fill ad=değer biçimini alır, "{0}" değil',
    'Usage: 2earl prompts save --title <title> [--file <path>]':
      'Kullanım: 2earl prompts save --title <başlık> [--file <yol>]',
    'The prompt is empty: pass --file, or pipe the text in.':
      'Prompt boş: --file verin ya da metni standart girdiden aktarın.',
    'Saved: {0}': 'Kaydedildi: {0}',
    'Usage: 2earl prompts search|get|save …': 'Kullanım: 2earl prompts search|get|save …',
    'Usage: 2earl sessions load <id or title>':
      'Kullanım: 2earl sessions load <kimlik ya da başlık>',
    'Usage: 2earl sessions note <id or title> <text> [--kind note]':
      'Kullanım: 2earl sessions note <kimlik ya da başlık> <metin> [--kind note]',
    'Saved to the session.': 'Oturuma kaydedildi.',
    'Usage: 2earl sessions list|load|note …': 'Kullanım: 2earl sessions list|load|note …',
    'Unknown command "{0}". Run `2earl --help`.':
      'Bilinmeyen komut "{0}". `2earl --help` çalıştırın.',
    'Sign-in was refused on the approval page.': 'Giriş onay sayfasında reddedildi.',
    'The code expired before it was approved. Run `2earl login` again.':
      'Kodun süresi onaylanmadan doldu. `2earl login` komutunu yeniden çalıştırın.',
    'login.2earl.com doesn’t accept this version of the CLI. Update it.':
      'login.2earl.com bu CLI sürümünü kabul etmiyor. Güncelleyin.',
    'Sign-in failed ({0}).': 'Giriş başarısız ({0}).',
    'Tool arguments must be a JSON object, e.g. \'{"query":"email"}\'':
      'Araç argümanları bir JSON nesnesi olmalı, ör. \'{"query":"email"}\'',
    'Nothing yet.': 'Henüz bir şey yok.',
    'Account      {0}': 'Hesap        {0}',
    'App          {0}': 'Uygulama     {0}',
    'Permissions  {0}': 'İzinler      {0}',
    unknown: 'bilinmiyor',
    none: 'yok',
    done: 'tamam',
  },
};

/** The text in the language; text the table doesn't have stays as it is. */
export function translate(/** @type {string} */ text, /** @type {Locale} */ locale) {
  if (locale === 'en') return text;
  const table = MESSAGES[locale];
  if (table[text] !== undefined) return table[text];
  for (const [english, translation] of Object.entries(table)) {
    if (!english.includes('{0}')) continue;
    const [before = '', after = ''] = english.split('{0}');
    if (
      text.startsWith(before) &&
      text.endsWith(after) &&
      text.length >= before.length + after.length
    ) {
      const value = text.slice(before.length, text.length - after.length);
      return translation.replace('{0}', table[value] ?? value);
    }
  }
  return text;
}

/** The address to approve a device at, in the language (login.2earl.com reads ?lang=). */
export function withLanguage(/** @type {string} */ address, /** @type {Locale} */ locale) {
  if (locale === 'en') return address;
  try {
    const url = new URL(address);
    url.searchParams.set('lang', locale);
    return url.toString();
  } catch {
    return address;
  }
}
