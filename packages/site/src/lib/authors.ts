export interface AuthorMeta {
  name: string;
  avatar: string;
  bio?: { label: string; href: string };
}

export const authors: Record<string, AuthorMeta> = {
  stanislav: {
    name: 'Stanislav',
    avatar: '/authors/stanislav-khromov.jpg',
    bio: { label: 'Personal website', href: 'https://stanislav.garden' },
  },
};

export function getAuthor(slug: string): AuthorMeta {
  const author = authors[slug];
  if (!author) {
    throw new Error(`Unknown author slug: ${slug}`);
  }
  return author;
}
