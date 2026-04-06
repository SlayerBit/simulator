import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadConfig } from '../src/config/env.js';
import { assertSafetyGuards, SafetyError } from '../src/safety/guards.js';

describe('Reliability & Safety Tests', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.JWT_SECRET = 'test-secret';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
    process.env.ALLOWED_TARGET_NAMESPACES = 'default,simulator';
  });

  it('Memoizes config (BUG-34)', () => {
    const config1 = loadConfig();
    const config2 = loadConfig();
    expect(config1).toBe(config2);
  });

  it('Allows whitelisted namespaces (BUG-26)', () => {
    const target = { namespace: 'simulator', deploymentName: 'app' };
    expect(() => assertSafetyGuards({ target, durationSeconds: 60 })).not.toThrow();
  });

  it('Rejects blocked namespaces (BUG-26)', () => {
    const target = { namespace: 'kube-system', deploymentName: 'app' };
    expect(() => assertSafetyGuards({ target, durationSeconds: 60 })).toThrow(SafetyError);
  });
});
