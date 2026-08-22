import { deepMerge, type MetaTagsProps } from 'svelte-meta-tags';

const SITE_URL = 'https://demos.mochi.fast';
const DEFAULT_OG_IMAGE = `${SITE_URL}/og-default.jpg`;
const DEFAULT_DESCRIPTION = 'A small collection of real apps built on the Mochi framework — server-rendered Svelte with islands of hydration.';

// No `titleTemplate` — each demo sets its own full title rather than getting a "— Mochi Demos" suffix that'd conflict with its branding.
export const baseMetaTags: MetaTagsProps = {
  description: DEFAULT_DESCRIPTION,
  canonical: `${SITE_URL}/`,
  openGraph: {
    type: 'website',
    siteName: 'Mochi Demos',
    url: `${SITE_URL}/`,
    title: 'Mochi Demos',
    description: DEFAULT_DESCRIPTION,
    images: [{ url: DEFAULT_OG_IMAGE, width: 1200, height: 630, alt: 'Mochi Demos' }],
  },
  twitter: {
    cardType: 'summary_large_image',
    title: 'Mochi Demos',
    description: DEFAULT_DESCRIPTION,
    image: DEFAULT_OG_IMAGE,
    imageAlt: 'Mochi Demos',
  },
};

export function mergeMetaTags(overrides: MetaTagsProps = {}): MetaTagsProps {
  const propagated: MetaTagsProps = {
    ...overrides,
    openGraph: {
      ...(overrides.title ? { title: overrides.title } : {}),
      ...(overrides.description ? { description: overrides.description } : {}),
      ...(overrides.canonical ? { url: overrides.canonical } : {}),
      ...overrides.openGraph,
    },
    twitter: {
      ...(overrides.title ? { title: overrides.title } : {}),
      ...(overrides.description ? { description: overrides.description } : {}),
      ...overrides.twitter,
    },
  };
  return deepMerge(baseMetaTags, propagated);
}
