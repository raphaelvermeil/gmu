import type { Listing } from '@gear/shared';

export const statusLabel: Record<Listing['status'], string> = {
  draft: 'Draft',
  active: 'Published',
  paused: 'Paused',
  archived: 'Archived',
};

export const conditionLabel = { like_new: 'Like new', good: 'Good', fair: 'Fair' } as const;

// R2.7: what the API says is missing before publishing, in plain words.
export const missingLabel: Record<string, string> = {
  phone: 'verify your phone number (on your profile)',
  category: 'choose a category',
  price: 'set a daily price',
  pickup_location: 'choose a pickup location',
  verified_photo: 'add a photo and wait for it to be checked',
};

// Integer cents to "$25.00". Money stays in cents everywhere else (invariant 9).
export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// "25" or "25.50" to cents. Null when the text is not a price.
export function parseDollars(text: string): number | null {
  const match = /^\s*(\d{1,6})(?:[.,](\d{1,2}))?\s*$/.exec(text);
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? '0').padEnd(2, '0'));
}
