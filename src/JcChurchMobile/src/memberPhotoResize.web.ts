// Web variant: expo-image-manipulator has no web support, so resize via canvas.
// Center-crops to a 512x512 JPEG (the web picker has no allowsEditing crop UI).
export async function resizeToSquareJpeg(
  uri: string,
): Promise<{ data: string; uri: string }> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new window.Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("Could not read the photo."));
    element.src = uri;
  });
  const size = 512;
  const scale = Math.max(size / image.width, size / image.height);
  const width = Math.round(image.width * scale);
  const height = Math.round(image.height * scale);
  const canvas = window.document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not process the photo.");
  context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
  const result = canvas.toDataURL("image/jpeg", 0.7);
  const data = result.split(",")[1];
  if (!data) throw new Error("Could not read the photo data.");
  return { data, uri: result };
}
