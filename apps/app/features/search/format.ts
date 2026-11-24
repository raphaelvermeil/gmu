export function formatDistance(metres: number): string {
  return metres < 1000 ? 'less than 1 km away' : `${Math.round(metres / 1000)} km away`;
}

// A calendar date, YYYY-MM-DD, n days later.
export function addDays(date: string, n: number): string {
  return new Date(Date.parse(date) + n * 86_400_000).toISOString().slice(0, 10);
}

// Both ends count (G3.4).
export function countedDays(from: string, to: string): number {
  return (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1;
}
