// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../../sql-modules.d.ts" />
import postgres1 from './postgres/1_mochi_cache.sql' with { type: 'text' };
import sqlite1 from './sqlite/1_mochi_cache.sql' with { type: 'text' };
import type { StoreMigrationSet } from '../../migrations/storeMigrations';

export const CACHE_TABLE = 'mochi_cache';

export const cacheMigrations: StoreMigrationSet = {
  table: 'mochi_migrations_cache',
  sqlite: [{ id: 1, name: 'mochi_cache', sql: sqlite1 }],
  postgres: [{ id: 1, name: 'mochi_cache', sql: postgres1 }],
};
