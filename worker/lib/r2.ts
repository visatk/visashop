/**
 *  R2 helpers.
 *
 *  We use the Cloudflare R2 binding (`env.BUCKET`) for direct reads,
 *  writes, and deletes inside the worker. Presigned URLs are produced
 *  with `aws4fetch` — Cloudflare's recommended Workers-native SigV4
 *  client. It is one tiny file (~3 KB) and avoids pulling the full
 *  AWS SDK into the Worker bundle.
 *
 *  Presigning needs an account-level Access Key ID / Secret Access
 *  Key created via R2 → "Manage R2 API tokens".
 *
 *  Refer to:
 *    https://developers.cloudflare.com/r2/api/s3/presigned-urls/
 *    https://developers.cloudflare.com/r2/objects/upload-objects/
 */
import { AwsClient } from 'aws4fetch';
import type { AppEnv } from '../env';

function r2Endpoint(env: AppEnv): string {
  if (!env.R2_ACCOUNT_ID) {
    throw new Error('R2_ACCOUNT_ID var is not configured');
  }
  return `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
}

function awsClient(env: AppEnv): AwsClient {
  if (!env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    throw new Error('R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY secrets missing');
  }
  return new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    service: 's3',
    region: 'auto',
  });
}

/**
 *  RFC 6266-compliant `attachment; filename*=UTF-8''<percent-encoded>` so
 *  non-ASCII filenames render correctly in browsers without breaking
 *  older clients.
 */
function contentDispositionFor(filename: string): string {
  const safe = filename.replace(/[\\/]/g, '_').replace(/"/g, '');
  const ascii = safe.replace(/[^\x20-\x7E]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

/**
 *  Build a presigned URL by composing an unsigned URL, then asking
 *  `aws4fetch` to sign the query parameters in place.
 */
async function presign(
  env: AppEnv,
  method: 'GET' | 'PUT' | 'HEAD' | 'DELETE',
  r2Key: string,
  expiresInSeconds: number,
  extraQuery: Record<string, string> = {},
  signedHeaders: Record<string, string> = {},
): Promise<string> {
  const url = new URL(`${r2Endpoint(env)}/${env.R2_BUCKET_NAME}/${r2Key.replace(/^\//, '')}`);
  // X-Amz-Expires must be 1..604800.
  const ttl = Math.max(1, Math.min(604_800, Math.floor(expiresInSeconds)));
  url.searchParams.set('X-Amz-Expires', String(ttl));
  for (const [k, v] of Object.entries(extraQuery)) url.searchParams.set(k, v);

  const signed = await awsClient(env).sign(
    new Request(url.toString(), { method, headers: signedHeaders }),
    { aws: { signQuery: true } },
  );
  return signed.url;
}

export async function presignDownloadUrl(
  env: AppEnv,
  r2Key: string,
  expiresInSeconds = 3600,
  filename?: string,
): Promise<string> {
  const extra: Record<string, string> = {};
  if (filename) extra['response-content-disposition'] = contentDispositionFor(filename);
  return presign(env, 'GET', r2Key, expiresInSeconds, extra);
}

export async function presignUploadUrl(
  env: AppEnv,
  r2Key: string,
  contentType?: string,
  expiresInSeconds = 600,
): Promise<string> {
  const headers: Record<string, string> = {};
  if (contentType) headers['content-type'] = contentType;
  return presign(env, 'PUT', r2Key, expiresInSeconds, {}, headers);
}

export async function deleteObject(env: AppEnv, r2Key: string): Promise<void> {
  // The bound R2Bucket already has full delete permission — no need to
  // make an external SigV4 request.
  await env.BUCKET.delete(r2Key);
}

/**
 *  Multipart upload helpers for large files (> ~95 MB recommended).
 *  See https://developers.cloudflare.com/r2/api/workers/workers-multipart-usage/
 */
export async function createMultipart(
  env: AppEnv,
  r2Key: string,
  contentType?: string,
): Promise<{ uploadId: string; key: string }> {
  const upload = await env.BUCKET.createMultipartUpload(r2Key, {
    httpMetadata: contentType ? { contentType } : undefined,
  });
  return { uploadId: upload.uploadId, key: upload.key };
}
