// FR-85: the profile photo in the browser. The picture is cut to its centred square and drawn at
// 256 px before it is sent, so the API only stores it.

export const PHOTO_SIZE = 256;
export const PHOTO_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

// The centred square of a picture, in its own pixels.
export function squareCrop(width: number, height: number) {
  const size = Math.min(width, height);
  return { x: Math.floor((width - size) / 2), y: Math.floor((height - size) / 2), size };
}

// Keys under profile: what the API's refusal means for the person choosing the photo.
export function photoError(status: number): 'photoTooBig' | 'photoType' | 'photoFailed' {
  if (status === 413) return 'photoTooBig';
  if (status === 415) return 'photoType';
  return 'photoFailed';
}
