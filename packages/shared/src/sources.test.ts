import { describe, expect, it } from 'vitest';
import { SOURCE_KEYS, sourceDefinition, sourceForUrl } from './sources.js';

describe('sourceForUrl', () => {
  it('matches store sites, short links and subdomains', () => {
    expect(sourceForUrl('https://www.savana.com/details/dress-123')).toBe('savana');
    expect(sourceForUrl('https://amzn.to/3xYz')).toBe('amazon');
    expect(sourceForUrl(' https://www.myntra.com/kurtas/123 ')).toBe('myntra');
    expect(sourceForUrl('https://meesho.com/s/p/abc')).toBe('meesho');
  });

  it('ignores other hosts and lookalikes', () => {
    expect(sourceForUrl('https://ekaro.in/enkr2024')).toBeNull();
    expect(sourceForUrl('https://notsavana.com/x')).toBeNull();
    expect(sourceForUrl('not a url')).toBeNull();
  });
});

describe('registry', () => {
  it('has a definition for every key', () => {
    for (const key of SOURCE_KEYS) expect(sourceDefinition(key)?.key).toBe(key);
    expect(SOURCE_KEYS).toContain('savana');
  });
});
