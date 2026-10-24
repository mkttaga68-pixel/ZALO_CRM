/**
 * s3-storage.ts — lớp lưu trữ S3-compatible dùng chung cho MinIO và Cloudflare R2.
 *
 * Mọi khác biệt giữa hai hạ tầng nằm GỌN trong bảng STORAGE_PROFILES bên dưới.
 * Chuyển MinIO ↔ R2 chỉ cần đổi biến môi trường STORAGE_PROVIDER, không sửa code.
 * Thêm nhà cung cấp khác (Backblaze B2, Wasabi...) = thêm một dòng vào bảng đó.
 *
 * Khác biệt cốt lõi là HÌNH DẠNG URL CÔNG KHAI:
 *   - MinIO dùng path-style  → {origin}/{bucket}/{key}
 *   - R2 dùng custom domain đã trỏ vào gốc bucket → {origin}/{key}
 * Chèn/không chèn bucket sai một nhịp là mọi ảnh 404 — đã xảy ra thật khi chuyển
 * MinIO sang R2 (URL lặp tên bucket hai lần).
 *
 * createS3Storage() là factory nhận toàn bộ cấu hình qua tham số — nhờ vậy test
 * dựng được nhiều profile trong cùng một process, không phụ thuộc biến môi trường.
 * index.ts là nơi duy nhất dựng instance thật từ config.
 */
import {
  S3Client,
  PutObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  PutBucketPolicyCommand,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';

export type StorageProviderId = 'minio' | 'r2';

export interface StorageProfile {
  id: StorageProviderId;
  /** Tên bucket có nằm trong path của URL công khai hay không (path-style vs bucket-at-root). */
  bucketInPublicPath: boolean;
  /** Tự tạo bucket + set policy public-read khi ensureBucket(). R2 tạo sẵn ngoài app. */
  autoCreateBucket: boolean;
  /**
   * Khi tải file về, có thử thêm URL qua S3_ENDPOINT nội bộ hay không.
   * MinIO trong cùng docker network đọc được mà không cần ký request; còn endpoint
   * S3 API của R2 bắt buộc SigV4 nên fetch trần sẽ 401 — thử là vô ích.
   */
  endpointDownloadFallback: boolean;
  defaultRegion: string;
}

export const STORAGE_PROFILES: Record<StorageProviderId, StorageProfile> = {
  minio: {
    id: 'minio',
    bucketInPublicPath: true,
    autoCreateBucket: true,
    endpointDownloadFallback: true,
    defaultRegion: 'us-east-1',
  },
  r2: {
    id: 'r2',
    bucketInPublicPath: false,
    autoCreateBucket: false,
    endpointDownloadFallback: false,
    defaultRegion: 'auto',
  },
};

export function isStorageProviderId(value: string): value is StorageProviderId {
  return Object.prototype.hasOwnProperty.call(STORAGE_PROFILES, value);
}

export interface UploadResult {
  key: string;
  url: string;
  size: number;
  mimeType: string;
}

export interface S3StorageOptions {
  provider: StorageProviderId;
  /** Endpoint S3 API mà backend gọi (trong docker network). */
  endpoint: string;
  /** Origin công khai cho browser/Zalo CDN. KHÔNG chứa tên bucket — adapter tự ghép. */
  publicUrl: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  /** Để rỗng thì lấy defaultRegion của profile. */
  region?: string;
  /** Cache-Control max-age (giây). Mặc định 3 ngày, khớp lifecycle rule của bucket R2. */
  cacheMaxAge?: number;
  /**
   * Host/prefix của kho cũ còn sót trong DB. Dùng cho isOwnStorageUrl() để media cũ
   * không bị mirror lại thành vòng lặp sau khi đổi hạ tầng.
   */
  legacyUrlPrefixes?: string[];
}

export interface S3Storage {
  readonly provider: StorageProviderId;
  readonly bucket: string;
  /** Prefix mà mọi key được ghép vào để thành URL công khai. */
  readonly publicPrefix: string;
  publicUrlForKey(key: string): string;
  keyFromUrl(url: string): string | null;
  isOwnStorageUrl(value: string): boolean;
  downloadCandidates(url: string): string[];
  uploadBuffer(buffer: Buffer, mimeType: string, originalName?: string): Promise<UploadResult>;
  ensureBucket(): Promise<void>;
}

/** Mặc định 3 ngày — bucket R2 có lifecycle xoá object sau 3 ngày nên không cache lâu hơn. */
const DEFAULT_CACHE_MAX_AGE = 3 * 24 * 60 * 60;

/** URL kho MinIO cũ còn sót trong DB từ trước 2026-08-13. */
const BUILTIN_LEGACY_PREFIXES = ['127.0.0.1:9000/'];

const stripTrailingSlash = (value: string): string => value.replace(/\/+$/, '');

export function createS3Storage(options: S3StorageOptions): S3Storage {
  const profile = STORAGE_PROFILES[options.provider];
  if (!profile) throw new Error(`[storage] Unknown provider: ${options.provider}`);

  const bucket = options.bucket;
  const endpoint = stripTrailingSlash(options.endpoint);
  const publicBase = stripTrailingSlash(options.publicUrl);
  const cacheMaxAge = options.cacheMaxAge ?? DEFAULT_CACHE_MAX_AGE;
  const legacyPrefixes = [...BUILTIN_LEGACY_PREFIXES, ...(options.legacyUrlPrefixes ?? [])];

  // Ghép bucket vào prefix công khai theo profile. Guard endsWith: nếu người vận hành
  // đã tự đặt bucket vào S3_PUBLIC_URL thì KHÔNG ghép lần hai — đúng cái bug "URL lặp
  // bucket hai lần → mọi ảnh 404" từng xảy ra trước đây.
  const publicPrefix =
    profile.bucketInPublicPath && !publicBase.endsWith(`/${bucket}`)
      ? `${publicBase}/${bucket}`
      : publicBase;

  // Path-style của S3 API luôn có bucket, bất kể URL công khai có hay không.
  const endpointPrefix = `${endpoint}/${bucket}`;

  // Các prefix trỏ thẳng vào gốc object, dùng để suy ngược ra key.
  const objectRootPrefixes = [...new Set([publicPrefix, endpointPrefix])];

  const s3Client = new S3Client({
    region: options.region || profile.defaultRegion,
    endpoint,
    credentials: {
      accessKeyId: options.accessKey,
      secretAccessKey: options.secretKey,
    },
    forcePathStyle: true,
  });

  function publicUrlForKey(key: string): string {
    return `${publicPrefix}/${key}`;
  }

  function keyFromUrl(url: string): string | null {
    for (const prefix of objectRootPrefixes) {
      if (url.startsWith(`${prefix}/`)) {
        const key = url.slice(prefix.length + 1);
        if (key) return key;
      }
    }
    return null;
  }

  function isOwnStorageUrl(value: string): boolean {
    // Khớp ở mức ORIGIN, rộng hơn mức bucket: thà nhận dư một URL của chính mình
    // còn hơn bỏ sót rồi mirror lặp vô hạn (mỗi tin đến lại tự sao chép thêm một bản).
    if (publicBase && value.startsWith(`${publicBase}/`)) return true;
    if (endpoint && value.startsWith(`${endpoint}/`)) return true;
    // Prefix legacy có thể chỉ là host:port chứ không phải origin đầy đủ nên dùng includes.
    return legacyPrefixes.some((prefix) => prefix && value.includes(prefix));
  }

  function downloadCandidates(url: string): string[] {
    const candidates = [url];
    if (profile.endpointDownloadFallback) {
      const key = keyFromUrl(url);
      if (key) candidates.push(`${endpointPrefix}/${key}`);
    }
    return [...new Set(candidates)];
  }

  async function uploadBuffer(
    buffer: Buffer,
    mimeType: string,
    originalName?: string,
  ): Promise<UploadResult> {
    const ext = originalName ? extname(originalName) : mimeToExt(mimeType);
    const key = `${new Date().toISOString().slice(0, 10)}/${randomUUID()}${ext}`;
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
        ContentLength: buffer.length,
        CacheControl: `public, max-age=${cacheMaxAge}`,
      }),
    );
    return { key, url: publicUrlForKey(key), size: buffer.length, mimeType };
  }

  async function ensureBucket(): Promise<void> {
    if (!profile.autoCreateBucket) {
      // R2: bucket được tạo sẵn ngoài app — chỉ xác nhận tồn tại.
      await s3Client.send(new HeadBucketCommand({ Bucket: bucket }));
      return;
    }

    try {
      await s3Client.send(new CreateBucketCommand({ Bucket: bucket }));
    } catch (err) {
      const name = (err as { name?: string }).name;
      if (name !== 'BucketAlreadyOwnedByYou' && name !== 'BucketAlreadyExists') throw err;
    }

    // Cho đọc công khai: Zalo CDN phải fetch được URL ảnh ta gửi qua zca-js.
    // Key là UUID ngẫu nhiên nên không liệt kê/đoán được. KHÔNG mở quyền ghi.
    await s3Client.send(
      new PutBucketPolicyCommand({
        Bucket: bucket,
        Policy: JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Principal: { AWS: ['*'] },
              Action: ['s3:GetObject'],
              Resource: [`arn:aws:s3:::${bucket}/*`],
            },
          ],
        }),
      }),
    );
    await s3Client.send(new HeadBucketCommand({ Bucket: bucket }));
  }

  return {
    provider: profile.id,
    bucket,
    publicPrefix,
    publicUrlForKey,
    keyFromUrl,
    isOwnStorageUrl,
    downloadCandidates,
    uploadBuffer,
    ensureBucket,
  };
}

function mimeToExt(mime: string): string {
  if (mime === 'image/jpeg') return '.jpg';
  if (mime === 'image/png') return '.png';
  if (mime === 'image/webp') return '.webp';
  if (mime === 'image/gif') return '.gif';
  if (mime === 'video/mp4') return '.mp4';
  if (mime === 'video/quicktime') return '.mov';
  if (mime === 'video/webm') return '.webm';
  return '';
}
