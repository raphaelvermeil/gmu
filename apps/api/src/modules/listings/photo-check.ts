// R2.15, G2.6: what makes an uploaded photo acceptable. Used by the listing photo job and,
// through this module, by the avatar job (G2.14).
import exifr from 'exifr';

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const LOCATION_KEY = /gps|latitude|longitude/i;

export type PhotoCheck = { ok: true } | { ok: false; reason: 'size' | 'type' | 'location' };

export async function checkPhoto(bytes: Uint8Array): Promise<PhotoCheck> {
  if (bytes.length === 0 || bytes.length > MAX_PHOTO_BYTES) return { ok: false, reason: 'size' };
  // JPEG only after re-encoding in the app: a JPEG starts with FF D8 FF.
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    return { ok: false, reason: 'type' };
  }
  let segments: Record<string, unknown> | undefined;
  try {
    segments = await exifr.parse(bytes, {
      tiff: true,
      gps: true,
      xmp: true,
      iptc: true,
      mergeOutput: false,
    });
  } catch {
    return { ok: false, reason: 'type' }; // metadata we cannot read is not accepted
  }
  return hasLocation(segments) ? { ok: false, reason: 'location' } : { ok: true };
}

// Any key that names a GPS tag or a coordinate, in any metadata block, at any depth.
function hasLocation(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, v]) => LOCATION_KEY.test(key) || hasLocation(v));
}
