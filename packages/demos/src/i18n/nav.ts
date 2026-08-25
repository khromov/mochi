export type PageId = 'home' | 'about' | 'demos';

export const LOCALES = [
  { code: 'en', name: 'English' },
  { code: 'sv', name: 'Svenska' },
  { code: 'uk', name: 'Українська' },
] as const;

const SUBPATH: Record<PageId, string> = {
  home: '',
  about: '/about',
  demos: '/demos',
};

/** Build a trailing-slashed URL for a page in a given locale (English has no prefix). */
export const localePath = (locale: string, page: PageId): string => {
  const loc = locale === 'en' ? '' : `/${locale}`;
  return `/i18n${loc}${SUBPATH[page]}/`;
};
