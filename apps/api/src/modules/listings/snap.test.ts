import { describe, expect, it } from 'vitest';
import { CELL_DEGREES, snapToGrid } from './snap.ts';

// Metres per degree of latitude, and a plain haversine distance, for the bound checks.
const EARTH_RADIUS_M = 6_371_008.8;
const M_PER_DEG_LAT = (Math.PI / 180) * EARTH_RADIUS_M;
const rad = (deg: number) => (deg * Math.PI) / 180;

function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

// The farthest a point can be from its cell's centre: half the cell's diagonal.
function halfDiagonalM(lat: number, precision: '1km' | '5km'): number {
  const cell = CELL_DEGREES[precision];
  const height = cell.lat * M_PER_DEG_LAT;
  const width = cell.lng * M_PER_DEG_LAT * Math.cos(rad(lat));
  return Math.hypot(height, width) / 2;
}

// A fixed pseudo-random sequence, so the test is the same on every run.
function* points(count: number) {
  let seed = 42;
  const next = () => (seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31;
  for (let i = 0; i < count; i++) {
    yield { lat: 45.4 + next() * 0.3, lng: -73.75 + next() * 0.3 }; // around Montreal
  }
}

describe('snapToGrid (R2.1, R2.2, G2.5)', () => {
  it('is deterministic: the same inputs give the same output', () => {
    for (const p of points(200)) {
      for (const precision of ['1km', '5km'] as const) {
        expect(snapToGrid(p, precision)).toEqual(snapToGrid({ ...p }, precision));
      }
    }
  });

  it('gives two points in one 1 km cell the same public point', () => {
    // Both lie in the cell 45.495..45.504 by -73.5744..-73.5616.
    const a = snapToGrid({ lat: 45.496, lng: -73.574 }, '1km');
    const b = snapToGrid({ lat: 45.503, lng: -73.562 }, '1km');
    expect(a).toEqual(b);
  });

  it('gives points in different cells different public points', () => {
    const a = snapToGrid({ lat: 45.496, lng: -73.574 }, '1km');
    const b = snapToGrid({ lat: 45.506, lng: -73.574 }, '1km');
    expect(a).not.toEqual(b);
  });

  it('a coarser precision gives a larger cell', () => {
    expect(CELL_DEGREES['5km'].lat).toBeGreaterThan(CELL_DEGREES['1km'].lat);
    expect(CELL_DEGREES['5km'].lng).toBeGreaterThan(CELL_DEGREES['1km'].lng);
    // About 2.7 km apart: different 1 km cells, one 5 km cell.
    const a = { lat: 45.496, lng: -73.574 };
    const b = { lat: 45.52, lng: -73.54 };
    expect(snapToGrid(a, '1km')).not.toEqual(snapToGrid(b, '1km'));
    expect(snapToGrid(a, '5km')).toEqual(snapToGrid(b, '5km'));
  });

  it('a 1 km cell is about 1 km by 1 km in Montreal', () => {
    // A 1 km square has a half diagonal of about 707 m.
    const halfDiagonal = halfDiagonalM(45.5, '1km');
    expect(halfDiagonal).toBeGreaterThan(690);
    expect(halfDiagonal).toBeLessThan(720);
  });

  it('never moves a point farther than half the cell diagonal', () => {
    for (const p of points(2_000)) {
      for (const precision of ['1km', '5km'] as const) {
        const snapped = snapToGrid(p, precision);
        expect(distanceM(p, snapped)).toBeLessThanOrEqual(halfDiagonalM(p.lat, precision) + 1);
      }
    }
  });

  it('moves a point that is not a cell centre', () => {
    const p = { lat: 45.4961, lng: -73.5739 };
    expect(snapToGrid(p, '1km')).not.toEqual(p);
  });
});
