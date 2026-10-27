import { describe, it, expect } from 'vitest';
import { B2C_TRAFFIC_SOURCE_IDS, TRAFFIC_SOURCES, trafficSourceId } from './traffic-sources';

describe('trafficSourceId', () => {
  it('resolves the exact names Metrika returns (lang=en) to lastTrafficSource ids', () => {
    expect(trafficSourceId('Search engine traffic')).toBe('organic');
    expect(trafficSourceId('Direct traffic')).toBe('direct');
    expect(trafficSourceId('Link traffic')).toBe('referral');
    expect(trafficSourceId('Social network traffic')).toBe('social');
    expect(trafficSourceId('Recommendation system traffic')).toBe('recommend');
    expect(trafficSourceId('Ad traffic')).toBe('ad');
    expect(trafficSourceId('Cached page traffic')).toBe('saved');
    expect(trafficSourceId('Mailing traffic')).toBe('email');
    expect(trafficSourceId('Messenger traffic')).toBe('messenger');
  });

  it('accepts raw ids, Russian names and legacy plural spellings, case-insensitively', () => {
    expect(trafficSourceId('organic')).toBe('organic');
    expect(trafficSourceId('Переходы из социальных сетей')).toBe('social');
    expect(trafficSourceId('Social networks traffic')).toBe('social');
    expect(trafficSourceId('  recommendation SYSTEMS traffic ')).toBe('recommend');
  });

  it('returns undefined for unknown / empty values', () => {
    expect(trafficSourceId('unknown')).toBeUndefined();
    expect(trafficSourceId('')).toBeUndefined();
    expect(trafficSourceId(null)).toBeUndefined();
    expect(trafficSourceId(undefined)).toBeUndefined();
  });

  it('classifies every Metrika source as B2C (B2B lives in manual deals)', () => {
    expect(B2C_TRAFFIC_SOURCE_IDS.size).toBe(TRAFFIC_SOURCES.length);
    expect(new Set(TRAFFIC_SOURCES.map((s) => s.id)).size).toBe(TRAFFIC_SOURCES.length);
  });
});
