import { load } from 'varlock';
import { ENV } from 'varlock/env';

// varlock's CLI generates this augmentation from the schema; we inline it so `ENV.KEY` stays fully typed.
declare module 'varlock/env' {
  interface TypedEnvSchema {
    DEMO_APP_ENV: 'development' | 'preview' | 'production';
    DEMO_API_PORT: number;
    DEMO_API_URL: string;
    DEMO_SECRET_KEY: string;
  }
}

export interface VarlockItem {
  key: string;
  value: string | null;
  jsType: string;
  isSensitive: boolean;
}

export interface VarlockConfig {
  items: VarlockItem[];
  apiUrl: string;
  apiPort: number;
}

let cached: VarlockConfig | null = null;

export async function loadVarlockConfig(): Promise<VarlockConfig> {
  if (cached) {
    return cached;
  }

  await load();

  const graph = JSON.parse(process.env.__VARLOCK_ENV ?? '{}') as {
    config?: Record<string, { value: unknown; isSensitive?: boolean }>;
  };

  const items: VarlockItem[] = Object.entries(graph.config ?? {}).map(([key, item]) => ({
    key,
    isSensitive: Boolean(item.isSensitive),
    jsType: typeof item.value,
    value: item.isSensitive ? null : String(item.value),
  }));

  cached = { items, apiUrl: ENV.DEMO_API_URL, apiPort: ENV.DEMO_API_PORT };
  return cached;
}
