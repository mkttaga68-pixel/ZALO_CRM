/**
 * index.ts — điểm vào duy nhất của lớp lưu trữ.
 *
 * Dựng instance S3Storage MỘT LẦN lúc module load từ config (cùng idiom với
 * modules/ai/provider-registry.ts), rồi bọc lại thành các hàm rời để caller không
 * phải mang theo instance. Nhờ vậy signature phía gọi không đổi khi hạ tầng đổi.
 *
 * Chuyển MinIO ↔ R2: đổi STORAGE_PROVIDER trong .env, không sửa dòng code nào.
 */
import { config } from '../../config/index.js';
import { createS3Storage, type S3Storage } from './s3-storage.js';

export {
  STORAGE_PROFILES,
  isStorageProviderId,
  createS3Storage,
} from './s3-storage.js';
export type {
  StorageProviderId,
  StorageProfile,
  S3Storage,
  S3StorageOptions,
  UploadResult,
} from './s3-storage.js';

export const storage: S3Storage = createS3Storage({
  provider: config.storageProvider,
  endpoint: config.s3Endpoint,
  publicUrl: config.s3PublicUrl,
  bucket: config.s3Bucket,
  accessKey: config.s3AccessKey,
  secretKey: config.s3SecretKey,
  region: config.s3Region,
  cacheMaxAge: config.s3CacheMaxAge,
  legacyUrlPrefixes: config.s3LegacyUrlPrefixes,
});

/** URL công khai của một key (browser/Zalo CDN đọc được). */
export function publicUrlForKey(key: string): string {
  return storage.publicUrlForKey(key);
}

/** Suy ngược key từ một URL của kho mình; null nếu URL không thuộc kho. */
export function keyFromUrl(url: string): string | null {
  return storage.keyFromUrl(url);
}

/**
 * URL đã nằm trong kho của mình thì không mirror lại (tránh vòng lặp tự sao chép).
 * Nhận cả URL của kho cũ còn sót trong DB — xem legacyUrlPrefixes.
 */
export function isOwnStorageUrl(value: string): boolean {
  return storage.isOwnStorageUrl(value);
}

/** Danh sách URL để thử tải file về, theo thứ tự ưu tiên. */
export function downloadCandidates(url: string): string[] {
  return storage.downloadCandidates(url);
}

export function uploadBuffer(
  buffer: Buffer,
  mimeType: string,
  originalName?: string,
): ReturnType<S3Storage['uploadBuffer']> {
  return storage.uploadBuffer(buffer, mimeType, originalName);
}

/** Theo profile: MinIO tự tạo bucket + set policy; R2 chỉ kiểm tra tồn tại. */
export function ensureBucket(): Promise<void> {
  return storage.ensureBucket();
}
