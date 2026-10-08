import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "./env.ts";

let client: S3Client | undefined;
let publicClient: S3Client | undefined;

function s3(forBrowser = false) {
  const e = env();
  // Presigned URLs the browser will hit must be signed against the endpoint the browser can reach.
  const endpoint = forBrowser ? (e.S3_PUBLIC_ENDPOINT ?? e.S3_ENDPOINT) : e.S3_ENDPOINT;
  const make = () => new S3Client({
    region: e.S3_REGION,
    endpoint,
    forcePathStyle: e.S3_FORCE_PATH_STYLE,
    credentials: { accessKeyId: e.S3_ACCESS_KEY, secretAccessKey: e.S3_SECRET_KEY },
  });
  if (forBrowser) return (publicClient ??= make());
  return (client ??= make());
}

export const keys = {
  original: (studioId: string, eventId: string, photoId: string, ext: string) => `s/${studioId}/e/${eventId}/orig/${photoId}.${ext}`,
  derivativePrefix: (studioId: string, eventId: string, photoId: string) => `s/${studioId}/e/${eventId}/d/${photoId}/`,
  hero: (studioId: string, eventId: string, rand: string) => `s/${studioId}/e/${eventId}/site/hero-${rand}.jpg`,
  zip: (studioId: string, eventId: string, zipId: string, part: number) => `s/${studioId}/e/${eventId}/zip/${zipId}-${part}.zip`,
};

/** Browser-facing presigned PUT for a single original. (Multipart upload is a Phase-1 follow-up.) */
export async function presignUpload(key: string, contentType: string, ttlSec = 900) {
  const cmd = new PutObjectCommand({ Bucket: env().S3_BUCKET, Key: key, ContentType: contentType });
  return getSignedUrl(s3(true), cmd, { expiresIn: ttlSec });
}

/** Short-lived presigned GET. Used for clean web images and originals after an entitlement check. */
export async function presignDownload(key: string, ttlSec = 300, filename?: string) {
  const cmd = new GetObjectCommand({
    Bucket: env().S3_BUCKET,
    Key: key,
    ResponseContentDisposition: filename ? `attachment; filename="${filename.replace(/"/g, "")}"` : undefined,
  });
  return getSignedUrl(s3(true), cmd, { expiresIn: ttlSec });
}

/**
 * URL for a derivative with an unguessable key. In production this goes through a CDN
 * with long cache headers; locally it's a presigned GET with a long TTL.
 */
export async function derivativeUrl(key: string) {
  return presignDownload(key, 60 * 60 * 24);
}

export async function putObject(key: string, body: Uint8Array | Buffer, contentType: string) {
  await s3().send(new PutObjectCommand({ Bucket: env().S3_BUCKET, Key: key, Body: body, ContentType: contentType }));
}

export async function headObject(key: string) {
  try {
    return await s3().send(new HeadObjectCommand({ Bucket: env().S3_BUCKET, Key: key }));
  } catch {
    return null;
  }
}

export async function deleteObject(key: string) {
  await s3().send(new DeleteObjectCommand({ Bucket: env().S3_BUCKET, Key: key }));
}
