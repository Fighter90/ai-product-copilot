import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  buildHypothesisUrl,
  parseHypothesisSeed,
  hasSeed,
  dropHypothesisSeedParams,
  storeHypothesisSeed,
  loadHypothesisSeed,
  clearHypothesisSeed,
} from './hypothesis-prefill';

describe('buildHypothesisUrl', () => {
  it('targets the v3 report page (legacy /hypotheses dropped the query on redirect — ANA-24)', () => {
    expect(buildHypothesisUrl({})).toBe('/app/report');
  });

  it('omits empty-string fields', () => {
    expect(buildHypothesisUrl({ segment: '', evidence: 'CR 0.7%' })).toBe(
      '/app/report?evidence=CR+0.7%25',
    );
  });

  it('URL-encodes all provided fields', () => {
    const url = buildHypothesisUrl({
      segment: 'Подкаст & радио',
      evidence: 'CR 0.7% при 1300 визитах',
    });
    const seed = parseHypothesisSeed(url.split('?')[1] ?? '');
    expect(seed.segment).toBe('Подкаст & радио');
    expect(seed.evidence).toBe('CR 0.7% при 1300 визитах');
  });
});

describe('parseHypothesisSeed', () => {
  it('round-trips every field through build → parse', () => {
    const seed = {
      segment: 'organic',
      trouble: 'низкая конверсия',
      action: 'оставить заявку',
      barrier: 'длинная форма',
      evidence: 'CR 0.5% при 2000 визитах',
    };
    const url = buildHypothesisUrl(seed);
    const search = url.split('?')[1] ?? '';
    expect(parseHypothesisSeed(search)).toEqual(seed);
  });

  it('accepts a URLSearchParams instance', () => {
    const params = new URLSearchParams({ segment: 'paid' });
    expect(parseHypothesisSeed(params)).toEqual({ segment: 'paid' });
  });

  it('ignores empty values and missing keys', () => {
    expect(parseHypothesisSeed('segment=&evidence=x')).toEqual({ evidence: 'x' });
    expect(parseHypothesisSeed('')).toEqual({});
  });
});

describe('hasSeed', () => {
  it('is false for an empty seed', () => {
    expect(hasSeed({})).toBe(false);
    expect(hasSeed({ segment: '' })).toBe(false);
  });

  it('is true when any field is populated', () => {
    expect(hasSeed({ evidence: 'CR 0.7%' })).toBe(true);
  });
});

describe('dropHypothesisSeedParams', () => {
  it('removes only the seed params and keeps the rest (?snapshot=…)', () => {
    expect(dropHypothesisSeedParams('?segment=x&snapshot=snap-1&trouble=y')).toBe(
      '?snapshot=snap-1',
    );
  });

  it('returns an empty search when only seed params were present', () => {
    expect(dropHypothesisSeedParams('?segment=x&evidence=y')).toBe('');
    expect(dropHypothesisSeedParams('')).toBe('');
  });
});

describe('sessionStorage draft (ANA-24)', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => sessionStorage.clear());

  it('stores, loads and clears the draft', () => {
    expect(loadHypothesisSeed()).toEqual({});
    storeHypothesisSeed({ segment: 'Подкаст', evidence: 'CR 1%' });
    expect(loadHypothesisSeed()).toEqual({ segment: 'Подкаст', evidence: 'CR 1%' });
    clearHypothesisSeed();
    expect(loadHypothesisSeed()).toEqual({});
  });

  it('overwrites a previous draft', () => {
    storeHypothesisSeed({ segment: 'old' });
    storeHypothesisSeed({ segment: 'new', trouble: 'низкая конверсия' });
    expect(loadHypothesisSeed()).toEqual({ segment: 'new', trouble: 'низкая конверсия' });
  });

  it('returns an empty seed for malformed stored data', () => {
    sessionStorage.setItem('pca.hypothesis-prefill', 'not-json{');
    expect(loadHypothesisSeed()).toEqual({});
  });
});
