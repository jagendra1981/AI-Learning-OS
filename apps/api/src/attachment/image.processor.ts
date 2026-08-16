import sharp from 'sharp';
import { C033_LIMITS } from './attachment.types';
import { AttachmentValidationError } from './attachment.validator';

export type SafeImage = {
  bytes: Buffer;
  width: number;
  height: number;
  format: 'jpeg' | 'png' | 'webp';
};

export async function inspectAndSanitize(
  input: Buffer,
  declaredMime: string,
): Promise<SafeImage> {
  const format =
    declaredMime === 'image/jpeg'
      ? 'jpeg'
      : declaredMime === 'image/png'
        ? 'png'
        : declaredMime === 'image/webp'
          ? 'webp'
          : null;
  if (!format) throw new AttachmentValidationError('FILE_TYPE_NOT_ALLOWED');
  try {
    const metadata = await sharp(input, {
      failOn: 'error',
      limitInputPixels: C033_LIMITS.maxPixels,
    }).metadata();
    if (metadata.format !== format || !metadata.width || !metadata.height)
      throw new AttachmentValidationError('IMAGE_INVALID');
    if (
      metadata.width > C033_LIMITS.maxWidth ||
      metadata.height > C033_LIMITS.maxHeight ||
      metadata.width * metadata.height > C033_LIMITS.maxPixels
    )
      throw new AttachmentValidationError('IMAGE_TOO_LARGE');
    let bytes: Buffer | undefined;
    try {
      const normalized = sharp(input, {
        failOn: 'error',
        limitInputPixels: C033_LIMITS.maxPixels,
      })
        .rotate()
        .resize({
          width: C033_LIMITS.maxNormalizedEdge,
          height: C033_LIMITS.maxNormalizedEdge,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .removeAlpha();
      bytes =
        format === 'jpeg'
          ? await normalized.jpeg().toBuffer()
          : format === 'png'
            ? await normalized.png().toBuffer()
            : await normalized.webp().toBuffer();
    } finally {
      // C033 V1 uses bounded in-memory buffers only. No temporary file or
      // derivative is created; references are released on every exit path.
      input = Buffer.alloc(0);
    }
    if (!bytes) throw new AttachmentValidationError('IMAGE_INVALID');
    const out = await sharp(bytes, {
      failOn: 'error',
      limitInputPixels: C033_LIMITS.maxNormalizedPixels,
    }).metadata();
    if (
      !out.width ||
      !out.height ||
      out.width * out.height > C033_LIMITS.maxNormalizedPixels
    )
      throw new AttachmentValidationError('IMAGE_TOO_LARGE');
    return { bytes, width: out.width, height: out.height, format };
  } catch (error) {
    if (error instanceof AttachmentValidationError) throw error;
    throw new AttachmentValidationError('IMAGE_INVALID');
  }
}
