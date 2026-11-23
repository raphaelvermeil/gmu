import type { Listing } from '@gear/shared';
import { config } from '../../lib/config';
import { formatCents } from '../listings/format';

// Without a token, so only an active listing and its verified photos ever reach the tags.
export async function listingMetadata(id: string) {
  const res = await fetch(`${config.apiUrl}/v1/listings/${encodeURIComponent(id)}`);
  if (!res.ok) return { title: 'Listing not found', robots: { index: false } };
  const l = (await res.json()) as Listing;
  const price = l.daily_price_cents ? `${formatCents(l.daily_price_cents)} a day` : '';
  const description = [price, l.description.slice(0, 200)].filter(Boolean).join('. ');
  const images = l.images[0] ? [l.images[0].url] : [];
  return { title: l.title, description, openGraph: { title: l.title, description, images } };
}
