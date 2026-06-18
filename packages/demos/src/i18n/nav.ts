export type PageId = 'home' | 'about';

export const LOCALES = [
  { code: 'en', name: 'English' },
  { code: 'sv', name: 'Svenska' },
  { code: 'uk', name: 'Українська' },
] as const;

/** Build a trailing-slashed URL for a page in a given locale (English has no prefix). */
export const localePath = (locale: string, page: PageId): string => {
  const loc = locale === 'en' ? '' : `/${locale}`;
  const sub = page === 'about' ? '/about' : '';
  return `/i18n${loc}${sub}/`;
};
