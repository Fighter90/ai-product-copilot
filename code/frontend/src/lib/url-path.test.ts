import { describe, it, expect } from 'vitest';
import { displayPath } from './url-path';

describe('displayPath', () => {
  it('strips scheme and host, keeping path, query and hash', () => {
    expect(displayPath('https://productcamp.ru/tickets?utm=x#buy')).toBe('/tickets?utm=x#buy');
  });

  it('maps a bare host (with or without trailing slash) to «/»', () => {
    expect(displayPath('https://productcamp.ru/')).toBe('/');
    expect(displayPath('https://productcamp.ru')).toBe('/');
  });

  it('handles protocol-relative URLs and query right after the host', () => {
    expect(displayPath('//productcamp.ru/lp')).toBe('/lp');
    expect(displayPath('http://productcamp.ru?a=1')).toBe('/?a=1');
  });

  it('leaves paths and non-URL labels unchanged', () => {
    expect(displayPath('/lp')).toBe('/lp');
    expect(displayPath('(not set)')).toBe('(not set)');
  });
});
