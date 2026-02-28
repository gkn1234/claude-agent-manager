import { db } from './db';
import { config } from './schema';
import { eq } from 'drizzle-orm';

const CONFIG_DEFAULTS: Record<string, string> = {
  max_concurrent: '2',
  command_timeout: '1800',
  log_retention_days: '30',
  poll_interval: '5',
};

export const CONFIG_KEYS = Object.keys(CONFIG_DEFAULTS) as Array<keyof typeof CONFIG_DEFAULTS>;

export function getConfig(key: string, defaultValue?: string): string {
  const row = db.select().from(config).where(eq(config.key, key)).get();
  if (row) return row.value;
  return defaultValue ?? CONFIG_DEFAULTS[key] ?? '';
}

export function setConfig(key: string, value: string): void {
  db.insert(config)
    .values({ key, value })
    .onConflictDoUpdate({ target: config.key, set: { value } })
    .run();
}

export function getAllConfig(): Record<string, string> {
  const rows = db.select().from(config).all();
  const result: Record<string, string> = { ...CONFIG_DEFAULTS };
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}
