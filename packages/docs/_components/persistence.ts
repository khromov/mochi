export type PersistenceStatus = 'yes' | 'no' | 'planned';

export interface Cell {
  status: PersistenceStatus;
  /** Marks the backend a feature uses when you configure nothing. */
  isDefault?: boolean;
}

export interface PersistenceRow {
  key: string;
  feature: string;
  href: string;
  memory: Cell;
  file: Cell;
  sqlite: Cell;
  postgres: Cell;
}

// Cells mean *built-in* support only — a backend reachable solely by writing
// your own adapter stays ❌.
export const persistenceRows: PersistenceRow[] = [
  {
    key: 'queues',
    feature: 'Queues',
    href: '/docs/queues/',
    memory: { status: 'yes', isDefault: true },
    file: { status: 'no' },
    sqlite: { status: 'yes' },
    postgres: { status: 'yes' },
  },
  {
    key: 'options',
    feature: 'Options',
    href: '/docs/options/',
    memory: { status: 'no' },
    file: { status: 'no' },
    sqlite: { status: 'yes' },
    postgres: { status: 'yes' },
  },
  {
    key: 'cache',
    feature: 'Cache',
    href: '/docs/cache/',
    memory: { status: 'yes', isDefault: true },
    file: { status: 'yes' },
    sqlite: { status: 'planned' },
    postgres: { status: 'planned' },
  },
  {
    key: 'image-cache',
    feature: 'Image cache',
    href: '/docs/images/',
    memory: { status: 'yes' },
    file: { status: 'yes', isDefault: true },
    sqlite: { status: 'no' },
    postgres: { status: 'no' },
  },
  {
    key: 'rate-limiting',
    feature: 'Rate limiting',
    href: '/docs/rate-limiting/',
    memory: { status: 'yes', isDefault: true },
    file: { status: 'no' },
    sqlite: { status: 'yes' },
    postgres: { status: 'yes' },
  },
  {
    key: 'captcha',
    feature: 'Captcha nonces',
    href: '/docs/captcha/',
    memory: { status: 'yes', isDefault: true },
    file: { status: 'no' },
    sqlite: { status: 'yes' },
    postgres: { status: 'no' },
  },
];
