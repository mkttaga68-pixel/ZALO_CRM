/**
 * Centralized configuration loader.
 * All environment variables are read once at startup and typed here.
 */

// SECURITY FIX (A2): JWT_SECRET and ENCRYPTION_KEY must NOT fall back to dev
// defaults when NODE_ENV=production. Webhook signature forgery / token forgery
// possible if dev defaults leak to a prod container with missing env vars.
import {
  STORAGE_PROFILES,
  isStorageProviderId,
  type StorageProviderId,
} from '../shared/storage/s3-storage.js';

const isProd = process.env.NODE_ENV === 'production';

const DEV_JWT_FALLBACK = 'dev-secret-change-me';
const DEV_ENC_FALLBACK = 'dev-key-change-me-16b';

export function envValue(name: string): string | undefined {
  const value = process.env[name];
  if (value == null) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return '';
  const quote = trimmed[0];
  if (quote === '"' || quote === "'") return trimmed;
  const commentAt = trimmed.search(/\s+#/);
  return (commentAt >= 0 ? trimmed.slice(0, commentAt) : trimmed).trim();
}

/**
 * STORAGE_PROVIDER sai chính tả sẽ sinh URL ảnh sai một cách IM LẶNG (chèn/không
 * chèn tên bucket), nên fail-fast ngay lúc boot thay vì âm thầm fallback.
 * Mặc định 'r2' = hành vi của code trước khi có adapter, để deploy cũ không đổi.
 */
function requireStorageProvider(value: string | undefined): StorageProviderId {
  const raw = (value || '').trim();
  if (!raw) return 'r2';
  if (!isStorageProviderId(raw)) {
    throw new Error(
      `[config] FATAL: STORAGE_PROVIDER='${raw}' không hợp lệ. ` +
        `Giá trị cho phép: ${Object.keys(STORAGE_PROFILES).join(' | ')}.`,
    );
  }
  return raw;
}

function requireSecret(name: string, devFallback: string, value: string | undefined): string {
  if (isProd) {
    if (!value || value === devFallback || value.length < 32) {
      // Fail-fast: better to crash boot than run prod with forgeable secrets.
      throw new Error(
        `[config] FATAL: ${name} must be set (≥32 chars, not the dev default) when NODE_ENV=production. ` +
        `Set ${name} in environment before starting the server.`,
      );
    }
    return value;
  }
  return value || devFallback;
}

export const config = {
  port: parseInt(envValue('PORT') || '3000'),
  host: envValue('HOST') || '0.0.0.0',
  nodeEnv: envValue('NODE_ENV') || 'development',
  jwtSecret: requireSecret('JWT_SECRET', DEV_JWT_FALLBACK, envValue('JWT_SECRET')),
  encryptionKey: requireSecret('ENCRYPTION_KEY', DEV_ENC_FALLBACK, envValue('ENCRYPTION_KEY')),
  databaseUrl: envValue('DATABASE_URL') || 'postgresql://crmuser:password@localhost:5432/zalocrm',
  uploadDir: envValue('UPLOAD_DIR') || '/var/lib/zalo-crm/files',
  appUrl: envValue('APP_URL') || 'http://localhost:3000',

  /* --- Object storage (S3-compatible: minio | r2) cho chat attachments ---
   * STORAGE_PROVIDER quyết định hình dạng URL công khai và cách tạo bucket.
   * Xem shared/storage/s3-storage.ts (bảng STORAGE_PROFILES) để biết khác biệt.
   * Mặc định 'r2' để deploy đang chạy R2 mà chưa khai biến này không bị đổi hành vi. */
  storageProvider: requireStorageProvider(envValue('STORAGE_PROVIDER')),
  s3Endpoint: envValue('S3_ENDPOINT') || 'http://localhost:9000',
  /** Origin công khai, KHÔNG chứa tên bucket — adapter tự ghép theo provider. */
  s3PublicUrl: envValue('S3_PUBLIC_URL') || 'http://localhost:9000',
  s3Bucket: envValue('S3_BUCKET') || 'zalocrm-attachments',
  s3AccessKey: envValue('S3_ACCESS_KEY') || 'minioadmin',
  s3SecretKey: envValue('S3_SECRET_KEY') || 'minioadmin',
  /** Rỗng = để profile của provider tự quyết (minio: us-east-1, r2: auto). */
  s3Region: envValue('S3_REGION') || '',
  /** Cache-Control max-age (giây) cho object upload. Mặc định 3 ngày. */
  s3CacheMaxAge: parseInt(envValue('S3_CACHE_MAX_AGE') || '259200'),
  /** Host/prefix kho cũ còn sót trong DB, phân cách bằng dấu phẩy. */
  s3LegacyUrlPrefixes: (envValue('S3_LEGACY_URL_PREFIXES') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  aiDefaultProvider: envValue('AI_DEFAULT_PROVIDER') || 'anthropic',
  aiDefaultModel: envValue('AI_DEFAULT_MODEL') || 'claude-sonnet-4-6',

  /* Legacy keys (kept for backward compat) */
  anthropicApiKey: envValue('ANTHROPIC_API_KEY') || envValue('ANTHROPIC_AUTH_TOKEN') || '',
  geminiApiKey: envValue('GEMINI_API_KEY') || envValue('GEMINI_AUTH_TOKEN') || '',

  /* --- AI Provider configs --- */
  anthropicBaseUrl: envValue('ANTHROPIC_BASE_URL') || 'https://api.anthropic.com',
  anthropicAuthToken: envValue('ANTHROPIC_AUTH_TOKEN') || envValue('ANTHROPIC_API_KEY') || '',
  anthropicDefaultOpusModel: envValue('ANTHROPIC_DEFAULT_OPUS_MODEL') || '',
  anthropicDefaultSonnetModel: envValue('ANTHROPIC_DEFAULT_SONNET_MODEL') || '',
  anthropicDefaultHaikuModel: envValue('ANTHROPIC_DEFAULT_HAIKU_MODEL') || '',

  /* --- Claude Code CLI provider (gói cước Pro/Max qua OAuth, KHÔNG dùng API key) --- */
  claudeCliEnabled: (envValue('CLAUDE_CLI_ENABLED') || '') === '1',
  claudeCliBin: envValue('CLAUDE_CLI_BIN') || 'claude',
  claudeCliModel: envValue('CLAUDE_CLI_MODEL') || 'claude-sonnet-4-6',

  geminiBaseUrl: envValue('GEMINI_BASE_URL') || 'https://generativelanguage.googleapis.com',
  geminiAuthToken: envValue('GEMINI_AUTH_TOKEN') || envValue('GEMINI_API_KEY') || '',
  geminiDefaultProModel: envValue('GEMINI_DEFAULT_PRO_MODEL') || '',
  geminiDefaultFlashModel: envValue('GEMINI_DEFAULT_FLASH_MODEL') || '',

  openaiBaseUrl: envValue('OPENAI_BASE_URL') || 'https://api.openai.com',
  openaiAuthToken: envValue('OPENAI_AUTH_TOKEN') || '',
  openaiDefaultGpt4oModel: envValue('OPENAI_DEFAULT_GPT4O_MODEL') || '',
  openaiDefaultGpt4oMiniModel: envValue('OPENAI_DEFAULT_GPT4O_MINI_MODEL') || '',

  qwenBaseUrl: envValue('QWEN_BASE_URL') || 'https://dashscope.aliyuncs.com',
  qwenAuthToken: envValue('QWEN_AUTH_TOKEN') || '',
  qwenDefaultPlusModel: envValue('QWEN_DEFAULT_PLUS_MODEL') || '',
  qwenDefaultTurboModel: envValue('QWEN_DEFAULT_TURBO_MODEL') || '',
  qwenDefaultMaxModel: envValue('QWEN_DEFAULT_MAX_MODEL') || '',

  kimiBaseUrl: envValue('KIMI_BASE_URL') || 'https://api.moonshot.cn',
  kimiAuthToken: envValue('KIMI_AUTH_TOKEN') || '',
  kimiDefaultMoonshotV1Model: envValue('KIMI_DEFAULT_MOONSHOT_V1_MODEL') || '',

  isProduction: process.env.NODE_ENV === 'production',
};
