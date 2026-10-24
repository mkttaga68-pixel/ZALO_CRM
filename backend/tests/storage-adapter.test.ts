/**
 * storage-adapter.test.ts — lớp lưu trữ S3-compatible (MinIO ↔ R2 qua env).
 *
 * Trọng tâm là HÌNH DẠNG URL, vì đó là chỗ hai hạ tầng khác nhau và cũng là chỗ
 * đã gây lỗi thật: thiếu tên bucket → ảnh 403, lặp tên bucket hai lần → ảnh 404.
 *
 * Quan trọng nhất: isOwnStorageUrl() là loop-guard. Nếu nó không nhận ra URL do
 * chính mình sinh, media đến sẽ bị mirror lại mỗi lần nhận → tự nhân bản vô hạn.
 *
 * Import s3-storage.js TRỰC TIẾP (không qua index.js) để không kéo theo config —
 * đó là lý do adapter được thiết kế thành factory nhận cấu hình qua tham số.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendMock = vi.fn();

vi.mock('@aws-sdk/client-s3', () => {
  class BaseCommand {
    constructor(public readonly input: Record<string, unknown>) {}
  }
  return {
    S3Client: class {
      send = sendMock;
    },
    PutObjectCommand: class extends BaseCommand {
      readonly kind = 'PutObject';
    },
    HeadBucketCommand: class extends BaseCommand {
      readonly kind = 'HeadBucket';
    },
    CreateBucketCommand: class extends BaseCommand {
      readonly kind = 'CreateBucket';
    },
    PutBucketPolicyCommand: class extends BaseCommand {
      readonly kind = 'PutBucketPolicy';
    },
  };
});

// Import AFTER mocks are registered
const { createS3Storage, STORAGE_PROFILES, isStorageProviderId } = await import(
  '../src/shared/storage/s3-storage.js'
);

const MINIO_BUCKET = 'zalocrm-attachments';
const R2_BUCKET = 'zalocrm-media';

const makeMinio = (publicUrl = 'http://localhost:9000') =>
  createS3Storage({
    provider: 'minio',
    endpoint: 'http://minio:9000',
    publicUrl,
    bucket: MINIO_BUCKET,
    accessKey: 'key',
    secretKey: 'secret',
  });

const makeR2 = () =>
  createS3Storage({
    provider: 'r2',
    endpoint: 'https://acct.r2.cloudflarestorage.com',
    publicUrl: 'https://crmcdn.shinsulab.com',
    bucket: R2_BUCKET,
    accessKey: 'key',
    secretKey: 'secret',
  });

const kindsSent = () => sendMock.mock.calls.map((c) => (c[0] as { kind: string }).kind);

beforeEach(() => {
  sendMock.mockReset();
  sendMock.mockResolvedValue({});
});

describe('publicUrlForKey — hình dạng URL theo provider', () => {
  it('minio (path-style) CHÈN tên bucket vào path', () => {
    expect(makeMinio().publicUrlForKey('2026-10-24/a.png')).toBe(
      `http://localhost:9000/${MINIO_BUCKET}/2026-10-24/a.png`,
    );
  });

  it('r2 (custom domain trỏ gốc bucket) KHÔNG chèn tên bucket', () => {
    expect(makeR2().publicUrlForKey('2026-10-24/a.png')).toBe(
      'https://crmcdn.shinsulab.com/2026-10-24/a.png',
    );
  });

  it('không lặp bucket hai lần khi S3_PUBLIC_URL đã chứa sẵn bucket', () => {
    // Đây đúng là bug cũ: URL lặp bucket → mọi ảnh 404.
    const s = makeMinio(`http://localhost:9000/${MINIO_BUCKET}`);
    expect(s.publicUrlForKey('2026-10-24/a.png')).toBe(
      `http://localhost:9000/${MINIO_BUCKET}/2026-10-24/a.png`,
    );
  });

  it('bỏ dấu / thừa ở cuối S3_PUBLIC_URL', () => {
    expect(makeMinio('http://localhost:9000///').publicUrlForKey('k.png')).toBe(
      `http://localhost:9000/${MINIO_BUCKET}/k.png`,
    );
  });
});

describe('keyFromUrl — phép nghịch của publicUrlForKey', () => {
  it('round-trip với cả hai provider', () => {
    for (const s of [makeMinio(), makeR2()]) {
      const key = '2026-10-24/abc.png';
      expect(s.keyFromUrl(s.publicUrlForKey(key))).toBe(key);
    }
  });

  it('nhận cả URL qua endpoint nội bộ (path-style luôn có bucket)', () => {
    expect(makeMinio().keyFromUrl(`http://minio:9000/${MINIO_BUCKET}/2026-10-24/a.png`)).toBe(
      '2026-10-24/a.png',
    );
  });

  it('trả null cho URL không thuộc kho của mình', () => {
    expect(makeMinio().keyFromUrl('https://zalo-cdn.example.com/x/y.jpg')).toBeNull();
  });

  it('trả null khi URL chỉ là prefix, không có key', () => {
    expect(makeMinio().keyFromUrl(`http://localhost:9000/${MINIO_BUCKET}/`)).toBeNull();
  });
});

describe('isOwnStorageUrl — loop-guard chống mirror vòng lặp', () => {
  it('nhận URL do chính mình sinh, ở cả hai provider', () => {
    for (const s of [makeMinio(), makeR2()]) {
      expect(s.isOwnStorageUrl(s.publicUrlForKey('2026-10-24/a.png'))).toBe(true);
    }
  });

  it('nhận URL qua endpoint nội bộ', () => {
    expect(makeMinio().isOwnStorageUrl(`http://minio:9000/${MINIO_BUCKET}/a.png`)).toBe(true);
  });

  it('nhận URL MinIO legacy 127.0.0.1:9000 còn sót trong DB trước 2026-08-13', () => {
    // Bỏ sót case này là media cũ bị mirror lại mỗi lần tin nhắn chảy qua.
    expect(
      makeR2().isOwnStorageUrl(`http://127.0.0.1:9000/${MINIO_BUCKET}/2026-05-25/image.jpg`),
    ).toBe(true);
  });

  it('nhận prefix legacy do người vận hành tự khai', () => {
    const s = createS3Storage({
      provider: 'r2',
      endpoint: 'https://acct.r2.cloudflarestorage.com',
      publicUrl: 'https://crmcdn.shinsulab.com',
      bucket: R2_BUCKET,
      accessKey: 'k',
      secretKey: 's',
      legacyUrlPrefixes: ['files.zalocrm.shinsulab.com/'],
    });
    expect(s.isOwnStorageUrl('https://files.zalocrm.shinsulab.com/old/a.png')).toBe(true);
  });

  it('TỪ CHỐI URL ngoài — nếu không thì media Zalo sẽ không bao giờ được mirror', () => {
    for (const s of [makeMinio(), makeR2()]) {
      expect(s.isOwnStorageUrl('https://f9-zpg.zdn.vn/abc/photo.jpg')).toBe(false);
    }
  });
});

describe('downloadCandidates — URL dự phòng khi tải file về', () => {
  it('minio: thêm URL qua endpoint nội bộ, GIỮ NGUYÊN tên bucket', () => {
    // Regression: bản vá cũ cắt prefix public khỏi path làm URL endpoint MẤT bucket → 404.
    const s = makeMinio();
    const url = s.publicUrlForKey('2026-10-24/a.png');
    expect(s.downloadCandidates(url)).toEqual([
      url,
      `http://minio:9000/${MINIO_BUCKET}/2026-10-24/a.png`,
    ]);
  });

  it('r2: chỉ URL công khai — endpoint S3 của R2 đòi SigV4 nên fetch trần vô ích', () => {
    const s = makeR2();
    const url = s.publicUrlForKey('2026-10-24/a.png');
    expect(s.downloadCandidates(url)).toEqual([url]);
  });

  it('URL ngoài thì trả về chính nó, không bịa thêm', () => {
    const url = 'https://f9-zpg.zdn.vn/abc/photo.jpg';
    expect(makeMinio().downloadCandidates(url)).toEqual([url]);
  });
});

describe('uploadBuffer', () => {
  it('sinh key dạng YYYY-MM-DD/<uuid><ext> và trả URL công khai khớp provider', async () => {
    const s = makeMinio();
    const res = await s.uploadBuffer(Buffer.from('abc'), 'image/png', 'anh.png');

    expect(res.key).toMatch(/^\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}\.png$/);
    expect(res.url).toBe(s.publicUrlForKey(res.key));
    expect(res.size).toBe(3);
    expect(res.mimeType).toBe('image/png');
  });

  it('suy ra đuôi file từ mimeType khi không có tên gốc', async () => {
    const res = await makeMinio().uploadBuffer(Buffer.from('x'), 'video/mp4');
    expect(res.key).toMatch(/\.mp4$/);
  });

  it('gửi PutObject với đúng bucket, content-type và Cache-Control', async () => {
    await makeMinio().uploadBuffer(Buffer.from('abc'), 'image/png', 'a.png');

    const input = (sendMock.mock.calls[0][0] as { input: Record<string, unknown> }).input;
    expect(input.Bucket).toBe(MINIO_BUCKET);
    expect(input.ContentType).toBe('image/png');
    expect(input.ContentLength).toBe(3);
    expect(input.CacheControl).toBe('public, max-age=259200');
  });

  it('tôn trọng cacheMaxAge tuỳ chỉnh', async () => {
    const s = createS3Storage({
      provider: 'minio',
      endpoint: 'http://minio:9000',
      publicUrl: 'http://localhost:9000',
      bucket: MINIO_BUCKET,
      accessKey: 'k',
      secretKey: 's',
      cacheMaxAge: 60,
    });
    await s.uploadBuffer(Buffer.from('x'), 'image/png', 'a.png');
    const input = (sendMock.mock.calls[0][0] as { input: Record<string, unknown> }).input;
    expect(input.CacheControl).toBe('public, max-age=60');
  });
});

describe('ensureBucket — theo autoCreateBucket của profile', () => {
  it('minio: tạo bucket, set policy public-read, rồi xác nhận', async () => {
    await makeMinio().ensureBucket();
    expect(kindsSent()).toEqual(['CreateBucket', 'PutBucketPolicy', 'HeadBucket']);
  });

  it('minio: bucket đã tồn tại thì bỏ qua lỗi và vẫn set policy', async () => {
    sendMock.mockImplementationOnce(() => {
      const err = new Error('exists') as Error & { name: string };
      err.name = 'BucketAlreadyOwnedByYou';
      return Promise.reject(err);
    });
    await expect(makeMinio().ensureBucket()).resolves.toBeUndefined();
    expect(kindsSent()).toEqual(['CreateBucket', 'PutBucketPolicy', 'HeadBucket']);
  });

  it('minio: lỗi tạo bucket thật thì NÉM RA, không che', async () => {
    sendMock.mockImplementationOnce(() => {
      const err = new Error('sai key') as Error & { name: string };
      err.name = 'SignatureDoesNotMatch';
      return Promise.reject(err);
    });
    await expect(makeMinio().ensureBucket()).rejects.toThrow('sai key');
  });

  it('r2: CHỈ kiểm tra tồn tại — bucket R2 tạo sẵn ngoài app', async () => {
    await makeR2().ensureBucket();
    expect(kindsSent()).toEqual(['HeadBucket']);
  });
});

describe('bảng profile', () => {
  it('khác biệt hạ tầng chỉ nằm trong STORAGE_PROFILES', () => {
    expect(STORAGE_PROFILES.minio.bucketInPublicPath).toBe(true);
    expect(STORAGE_PROFILES.r2.bucketInPublicPath).toBe(false);
    expect(STORAGE_PROFILES.minio.autoCreateBucket).toBe(true);
    expect(STORAGE_PROFILES.r2.autoCreateBucket).toBe(false);
    expect(STORAGE_PROFILES.minio.defaultRegion).toBe('us-east-1');
    expect(STORAGE_PROFILES.r2.defaultRegion).toBe('auto');
  });

  it('isStorageProviderId chặn giá trị lạ (typo env sẽ fail-fast lúc boot)', () => {
    expect(isStorageProviderId('minio')).toBe(true);
    expect(isStorageProviderId('r2')).toBe(true);
    expect(isStorageProviderId('s3')).toBe(false);
    expect(isStorageProviderId('')).toBe(false);
    expect(isStorageProviderId('toString')).toBe(false);
  });

  it('provider cho biết mình là ai, để log boot nói đúng', () => {
    expect(makeMinio().provider).toBe('minio');
    expect(makeR2().provider).toBe('r2');
  });
});
