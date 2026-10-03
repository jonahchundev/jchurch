import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

// Downsizes to a 512px-wide JPEG so uploads stay well under the 1 MB server cap.
// The picker's square crop (allowsEditing) has already made the image square.
export async function resizeToSquareJpeg(
  uri: string,
): Promise<{ data: string; uri: string }> {
  const context = ImageManipulator.manipulate(uri);
  context.resize({ width: 512 });
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({
    compress: 0.7,
    format: SaveFormat.JPEG,
    base64: true,
  });
  if (!saved.base64) throw new Error("Could not read the photo data.");
  return { data: saved.base64, uri: saved.uri };
}
