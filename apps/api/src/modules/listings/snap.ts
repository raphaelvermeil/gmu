// R2.1, R2.2, G2.5: the public point of a pickup location.
// A fixed grid in degrees, sized for Montreal (about 45.5° N). A point snaps to the centre of
// the cell it falls in, so every address in one cell shares one public point, and the public
// point is at most half a cell diagonal from the exact point (about 707 m for `1km`).
// It depends on the exact point and the precision only, so the same inputs give the same output.
export type Precision = '1km' | '5km';
export type Point = { lat: number; lng: number };

// 0.009° of latitude is about 1,000 m everywhere. 0.0128° of longitude is about 1,000 m at 45.5° N.
export const CELL_DEGREES: Record<Precision, Point> = {
  '1km': { lat: 0.009, lng: 0.0128 },
  '5km': { lat: 0.045, lng: 0.064 },
};

export function snapToGrid(point: Point, precision: Precision): Point {
  const cell = CELL_DEGREES[precision];
  return {
    lat: centre(point.lat, cell.lat),
    lng: centre(point.lng, cell.lng),
  };
}

// The centre of the cell that holds `value`, rounded to 6 decimals (about 0.1 m) to drop
// floating-point noise.
function centre(value: number, size: number): number {
  const index = Math.floor(value / size);
  return Math.round((index + 0.5) * size * 1e6) / 1e6;
}
