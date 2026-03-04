import { describe, it, expect, vi } from 'vitest';

// Mock db module to avoid SQLite connection in tests
vi.mock('../db', () => ({
  db: {},
}));

// Mock schema module
vi.mock('../schema', () => ({
  config: { key: 'key' },
}));

describe('autonomous mode config defaults', () => {
  it('should have max_autonomous_rounds default of 20', async () => {
    const { CONFIG_DEFAULTS } = await import('../config');
    expect(CONFIG_DEFAULTS.max_autonomous_rounds).toBe('20');
  });

  it('should have safety_net_delay_ms default of 3000', async () => {
    const { CONFIG_DEFAULTS } = await import('../config');
    expect(CONFIG_DEFAULTS.safety_net_delay_ms).toBe('3000');
  });

  it('should include autonomous config keys in CONFIG_KEYS', async () => {
    const { CONFIG_KEYS } = await import('../config');
    expect(CONFIG_KEYS).toContain('max_autonomous_rounds');
    expect(CONFIG_KEYS).toContain('safety_net_delay_ms');
  });
});
