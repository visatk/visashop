/**
 *  R2 helpers — uses the Cloudflare R2 binding for everything except
 *  presigned download URLs, which are issued via the AWS S3 SDK
 *  (R2 is S3-compatible). Presigning needs an account-level Access
 *  Key ID / Secret Access Key created in the R2 dashboard.
 */
import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { AppEnv } from '../env';

function s3Client(env: AppEnv): S3Client {
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    throw new Error('R2 presign credentials missing (R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY)');
  }
  return new S3Client({
    region: 'auto',
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  });
}

export async function presignDownloadUrl(
  env: AppEnv,
  r2Key: string,
  expiresInSeconds = 3600,
  filename?: string,
): Promise<string> {
  const cmd = new GetObjectCommand({
    Bucket: env.R2_BUCKET_NAME,
    Key: r2Key,
    ResponseContentDisposition: filename
      ? `attachment; filename="${encodeURIComponent(filename)}"`
      : undefined,
  });
  return await getSignedUrl(s3Client(env), cmd, { expiresIn: expiresInSeconds });
}

export async function presignUploadUrl(
  env: AppEnv,
  r2Key: string,
  contentType?: string,
  expiresInSeconds = 600,
): Promise<string> {
  const cmd = new PutObjectCommand({
    Bucket: env.R2_BUCKET_NAME,
    Key: r2Key,
    ContentType: contentType,
  });
  return await getSignedUrl(s3Client(env), cmd, { expiresIn: expiresInSeconds });
}

export async function deleteObject(env: AppEnv, r2Key: string): Promise<void> {
  await s3Client(env).send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: r2Key }));
}

/**
 *  Multipart upload helpers for large files (>= ~95 MB recommended).
 *  We expose the createMultipartUpload + presigned UploadPart URLs
 *  so the admin can upload directly from the browser.
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
