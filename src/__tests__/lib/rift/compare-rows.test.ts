import { describe, it, expect } from 'vitest';
import { computeCompareRows } from '@/lib/rift/compare-rows';

describe('computeCompareRows', () => {
  const own = {
    source: { Title: 'Home', Body: 'Welcome' },
    target: { Title: 'Home', Body: 'Howdy' },
  };

  it('defaults to only-different rows when showAllFields is false', () => {
    const result = computeCompareRows(own, null, false, false);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ name: 'Body', source: 'Welcome', target: 'Howdy', isDifferent: true });
  });

  it('returns all own fields when showAllFields is true', () => {
    const result = computeCompareRows(own, null, true, false);
    expect(result.map((r) => r.name)).toEqual(['Body', 'Title']);
    expect(result.find((r) => r.name === 'Title')?.isDifferent).toBe(false);
    expect(result.find((r) => r.name === 'Body')?.isDifferent).toBe(true);
  });

  it('flags a field present on one side but not the other as different', () => {
    const partial = {
      source: { Title: 'Home', Only: 'X' },
      target: { Title: 'Home' },
    };
    const result = computeCompareRows(partial, null, true, false);
    const onlyRow = result.find((r) => r.name === 'Only');
    expect(onlyRow?.isDifferent).toBe(true);
    expect(onlyRow?.source).toBe('X');
    expect(onlyRow?.target).toBe('');
  });

  it('merges standard fields when showStandardFields is true', () => {
    const std = {
      source: { __Updated: '20260419T120000Z' },
      target: { __Updated: '20260420T090000Z' },
    };
    const result = computeCompareRows(own, std, true, true);
    expect(result.map((r) => r.name)).toEqual(['Body', 'Title', '__Updated']);
    expect(result.find((r) => r.name === '__Updated')?.isDifferent).toBe(true);
  });

  it('omits standard fields when showStandardFields is false even if provided', () => {
    const std = {
      source: { __Updated: '20260419T120000Z' },
      target: { __Updated: '20260419T120000Z' },
    };
    const result = computeCompareRows(own, std, true, false);
    expect(result.map((r) => r.name)).not.toContain('__Updated');
  });

  it('handles one-sided data (source-only row)', () => {
    const sourceOnly = { source: { Title: 'Home' }, target: undefined };
    const result = computeCompareRows(sourceOnly, null, true, false);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ name: 'Title', source: 'Home', target: '', isDifferent: true });
  });

  it('handles null ownFields gracefully (still loading)', () => {
    const result = computeCompareRows(null, null, true, false);
    expect(result).toEqual([]);
  });

  it('sorts fields alphabetically', () => {
    const unsorted = {
      source: { zebra: '1', apple: '2', mango: '3' },
      target: { zebra: '1', apple: '2', mango: '3' },
    };
    const result = computeCompareRows(unsorted, null, true, false);
    expect(result.map((r) => r.name)).toEqual(['apple', 'mango', 'zebra']);
  });
});
