import { describe, expect, it } from 'vitest';
import { photoError, squareCrop } from '../../src/lib/photo-form';

describe('photoError', () => {
  it.each([
    [413, 'photoTooBig'],
    [415, 'photoType'],
    [429, 'photoFailed'],
    [500, 'photoFailed'],
  ])('FR-85 NFR-17 maps %s to %s', (status, key) => {
    expect(photoError(status)).toBe(key);
  });
});

describe('squareCrop', () => {
  it('FR-85 takes the centred square of a wide or tall picture', () => {
    expect(squareCrop(400, 200)).toEqual({ x: 100, y: 0, size: 200 });
    expect(squareCrop(200, 500)).toEqual({ x: 0, y: 150, size: 200 });
    expect(squareCrop(300, 300)).toEqual({ x: 0, y: 0, size: 300 });
  });
});
