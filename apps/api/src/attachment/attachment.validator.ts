import { createHash } from 'node:crypto';
import {
  ALLOWED_IMAGE_MIME,
  C033_LIMITS,
  AllowedImageMime,
} from './attachment.types';

export class AttachmentValidationError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}
export const normalizeFilename = (value: string) =>
  value
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\\/]+/g, '_') // eslint-disable-line no-control-regex
    .trim()
    .slice(0, C033_LIMITS.maxFilenameChars);

export function detectMime(prefix: Buffer): AllowedImageMime {
  if (
    prefix.length >= 3 &&
    prefix[0] === 0xff &&
    prefix[1] === 0xd8 &&
    prefix[2] === 0xff
  )
    return 'image/jpeg';
  if (
    prefix.length >= 8 &&
    prefix.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return 'image/png';
  if (
    prefix.length >= 12 &&
    prefix.subarray(0, 4).toString('ascii') === 'RIFF' &&
    prefix.subarray(8, 12).toString('ascii') === 'WEBP'
  )
    return 'image/webp';
  throw new AttachmentValidationError('FILE_TYPE_NOT_ALLOWED');
}

export function validateDeclaredMime(
  value: string,
): asserts value is AllowedImageMime {
  if (!(ALLOWED_IMAGE_MIME as readonly string[]).includes(value))
    throw new AttachmentValidationError('FILE_TYPE_NOT_ALLOWED');
}
export function validateSize(size: number) {
  if (!Number.isInteger(size) || size < 0 || size > C033_LIMITS.maxBytes)
    throw new AttachmentValidationError('FILE_TOO_LARGE');
}
export function validateSignature(
  declared: string,
  prefix: Buffer,
): AllowedImageMime {
  validateDeclaredMime(declared);
  const detected = detectMime(prefix);
  if (detected !== declared)
    throw new AttachmentValidationError('FILE_INVALID');
  return detected;
}
export const checksum = (bytes: Buffer) =>
  createHash('sha256').update(bytes).digest('hex');

export type ImageInspection = {
  mime: AllowedImageMime;
  width: number;
  height: number;
  pixels: number;
};
const bounds = (width: number, height: number) => {
  if (
    !width ||
    !height ||
    width > C033_LIMITS.maxWidth ||
    height > C033_LIMITS.maxHeight ||
    width * height > C033_LIMITS.maxPixels
  )
    throw new AttachmentValidationError('IMAGE_TOO_LARGE');
  return { width, height, pixels: width * height };
};
export function inspectImage(bytes: Buffer, declared: string): ImageInspection {
  const mime = validateSignature(declared, bytes.subarray(0, 64));
  if (mime === 'image/png') {
    if (
      bytes.length < 24 ||
      bytes.subarray(12, 16).toString('ascii') !== 'IHDR'
    )
      throw new AttachmentValidationError('IMAGE_INVALID');
    return { mime, ...bounds(bytes.readUInt32BE(16), bytes.readUInt32BE(20)) };
  }
  if (mime === 'image/webp') {
    if (bytes.length < 30) throw new AttachmentValidationError('IMAGE_INVALID');
    const chunk = bytes.subarray(12, 16).toString('ascii');
    if (chunk === 'VP8X')
      return {
        mime,
        ...bounds(
          bytes[24] | (bytes[25] << 8) | ((bytes[26] << 16) + 1),
          bytes[27] | (bytes[28] << 8) | ((bytes[29] << 16) + 1),
        ),
      };
    if (
      chunk === 'VP8 ' &&
      bytes.length > 30 &&
      bytes[23] === 0x9d &&
      bytes[24] === 0x01 &&
      bytes[25] === 0x2a
    )
      return {
        mime,
        ...bounds(bytes.readUInt16LE(26), bytes.readUInt16LE(28)),
      };
    if (chunk === 'VP8L' && bytes.length > 25 && bytes[21] === 0x2f)
      return {
        mime,
        ...bounds(
          1 + (bytes[22] | ((bytes[23] & 0x3f) << 8)),
          1 + ((bytes[23] >> 6) | (bytes[24] << 2) | ((bytes[25] & 0xf) << 10)),
        ),
      };
    throw new AttachmentValidationError('IMAGE_INVALID');
  }
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = bytes[i + 1];
    const length = bytes.readUInt16BE(i + 2);
    if (length < 2 || i + 2 + length > bytes.length)
      throw new AttachmentValidationError('IMAGE_INVALID');
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    )
      return {
        mime,
        ...bounds(bytes.readUInt16BE(i + 5), bytes.readUInt16BE(i + 7)),
      };
    i += 2 + length;
  }
  throw new AttachmentValidationError('IMAGE_INVALID');
}
