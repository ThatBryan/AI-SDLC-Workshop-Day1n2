import { describe, expect, it } from 'vitest';
import { getTagTextColor } from '../lib/tagColor';

function contrastRatio(colorA: string, colorB: string): number {
  const luminance = (color: string) => {
    const channel = (start: number) => {
      const value = Number.parseInt(color.slice(start, start + 2), 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  };
  const values = [luminance(colorA), luminance(colorB)].sort((a, b) => b - a);
  return ((values[0] ?? 0) + 0.05) / ((values[1] ?? 0) + 0.05);
}

describe('tag text color contrast', () => {
  it.each([
    '#000000',
    '#FFFFFF',
    '#808080',
    '#12AB34',
    '#224466',
    '#FFFF00',
    '#767676',
  ])('keeps text contrast at AA level for %s', (background) => {
    expect(contrastRatio(getTagTextColor(background), background)).toBeGreaterThanOrEqual(4.5);
  });

  it('uses the darker foreground when white text would fail contrast', () => {
    expect(getTagTextColor('#12AB34')).toBe('#000000');
    expect(getTagTextColor('#224466')).toBe('#FFFFFF');
  });

  it('rejects malformed colors instead of hiding invalid stored data', () => {
    expect(() => getTagTextColor('not-a-color')).toThrow(RangeError);
  });
});
