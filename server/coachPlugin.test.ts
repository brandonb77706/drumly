import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readDotEnv } from './coachPlugin';

describe('readDotEnv', () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  afterEach(() => {
    if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved;
  });

  it('reads the key and model from the .env file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'drumly-env-'));
    writeFileSync(join(dir, '.env'), 'ANTHROPIC_API_KEY=sk-test\nCOACH_MODEL=claude-haiku-5-5\n');
    expect(readDotEnv(join(dir, '.env'))).toEqual({ apiKey: 'sk-test', model: 'claude-haiku-5-5' });
  });

  it('no .env means no key, even if the shell has one', () => {
    process.env.ANTHROPIC_API_KEY = 'from-shell';
    expect(readDotEnv(join(tmpdir(), 'drumly-no-such-dir', '.env'))).toEqual({});
  });
});
