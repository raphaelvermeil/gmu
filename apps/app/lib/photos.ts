import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

const LONG_EDGE = 2000; // R2.14

// Opens the photo library and returns one photo resized to a long edge of at most 2,000 px,
// re-encoded as JPEG (G2.6). Null when the user cancels. Must run from a button press on web.
export async function pickPhoto(): Promise<string | null> {
  const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', exif: false });
  const asset = picked.canceled ? null : picked.assets[0];
  if (!asset) return null;

  const context = ImageManipulator.manipulate(asset.uri);
  if (Math.max(asset.width, asset.height) > LONG_EDGE) {
    context.resize(
      asset.width >= asset.height
        ? { width: LONG_EDGE, height: null }
        : { width: null, height: LONG_EDGE },
    );
  }
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
  return saved.uri;
}

// PUTs the file to a signed upload URL from the API. The API never sees the bytes (R2.13).
export async function uploadPhoto(uploadUrl: string, uri: string): Promise<void> {
  const file = await (await fetch(uri)).blob();
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/jpeg' },
    body: file,
  });
  if (!res.ok) throw new Error(`The upload failed (${res.status})`);
}
