/*
 * S3 CORS configuration required for browser direct uploads:
 *
 * [
 *   {
 *     "AllowedHeaders": ["Content-Type"],
 *     "AllowedMethods": ["PUT", "GET"],
 *     "AllowedOrigins": ["https://your-production-domain.com", "http://localhost:5173"],
 *     "ExposeHeaders": ["ETag"],
 *     "MaxAgeSeconds": 3000
 *   }
 * ]
 */

import { S3Client, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getConfig } from "../config";
import crypto from "crypto";

function getS3Client(): S3Client {
  const { AWS_REGION } = getConfig();
  return new S3Client({ region: AWS_REGION });
}

function getBucket(): string {
  return getConfig().S3_BUCKET;
}

export function sanitizeFilename(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9.\-_]/g, "_")
    .slice(0, 100);
}

export function buildEventKey(
  eventId: number,
  fileType: "photo" | "report" | "poster" | "document",
  originalName: string
): string {
  const folderMap: Record<string, string> = {
    photo: "photos",
    report: "reports",
    poster: "posters",
    document: "documents",
  };
  const uuid = crypto.randomUUID();
  const sanitized = sanitizeFilename(originalName);
  return `events/event-${eventId}/${folderMap[fileType]}/${uuid}-${sanitized}`;
}

export async function getUploadUrl({
  key,
  contentType,
}: {
  key: string;
  contentType: string;
}): Promise<string> {
  const client = getS3Client();
  const command = new PutObjectCommand({
    Bucket: getBucket(),
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(client, command, { expiresIn: 300 });
}

export async function getDownloadUrl(key: string): Promise<string> {
  const client = getS3Client();
  const command = new GetObjectCommand({
    Bucket: getBucket(),
    Key: key,
  });
  return getSignedUrl(client, command, { expiresIn: 300 });
}

export async function putObject(
  key: string,
  body: Buffer,
  contentType: string
): Promise<void> {
  const client = getS3Client();
  await client.send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
}

export async function deleteObject(key: string): Promise<void> {
  const client = getS3Client();
  await client.send(
    new DeleteObjectCommand({
      Bucket: getBucket(),
      Key: key,
    })
  );
}

export async function headObject(key: string): Promise<boolean> {
  const client = getS3Client();
  try {
    await client.send(new HeadObjectCommand({ Bucket: getBucket(), Key: key }));
    return true;
  } catch {
    return false;
  }
}
