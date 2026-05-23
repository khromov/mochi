import { deepMerge, type MetaTagsProps } from 'svelte-meta-tags';

const SITE_URL = 'https://mochi.fast';
const DEFAULT_OG_IMAGE = `${SITE_URL}/og-default.jpg`;
const DEFAULT_DESCRIPTION = 'An experimental SSR framework for Svelte 5 + Bun with islands-based selective hydration.';

export const baseMetaTags: MetaTagsProps = {
  titleTemplate: '%s — Mochi',
  description: DEFAULT_DESCRIPTION,
  canonical: `${SITE_URL}/`,
  openGraph: {
    type: 'website',
    siteName: 'Mochi',
    url: `${SITE_URL}/`,
    title: 'Mochi — SSR Framework for Svelte 5 + Bun',
    description: DEFAULT_DESCRIPTION,
    images: [{ url: DEFAULT_OG_IMAGE, width: 1200, height: 630, alt: 'Mochi' }],
  },
  twitter: {
    cardType: 'summary_large_image',
    title: 'Mochi — SSR Framework for Svelte 5 + Bun',
    description: DEFAULT_DESCRIPTION,
    image: DEFAULT_OG_IMAGE,
    imageAlt: 'Mochi',
  },
};

// Page wrappers pass only `title`/`description`/`canonical`; this propagates
// them into `openGraph` and `twitter` so social cards reflect the page, not
// the site-wide brand defaults.
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
