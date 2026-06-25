import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Client } from 'minio';
import { randomUUID } from 'crypto';
import type { Readable } from 'stream';

export const BLOG_PREFIX = 'blog';

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
};

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: Client;
  private readonly bucket = process.env.MINIO_BUCKET ?? '';
  private readonly endpoint = process.env.MINIO_ENDPOINT ?? '';
  private readonly useSSL = process.env.MINIO_USE_SSL !== 'false';
  private readonly port = Number(process.env.MINIO_PORT ?? (this.useSSL ? 443 : 80));

  constructor() {
    this.client = new Client({
      endPoint: this.endpoint,
      port: this.port,
      useSSL: this.useSSL,
      accessKey: process.env.MINIO_ACCESS_KEY ?? '',
      secretKey: process.env.MINIO_SECRET_KEY ?? '',
      region: process.env.MINIO_REGION ?? 'us-east-1',
    });
  }

  async onModuleInit() {
    if (!this.endpoint || !this.bucket) {
      this.logger.warn('MinIO not configured — image upload disabled.');
      return;
    }
    try {
      const exists = await this.client.bucketExists(this.bucket);
      if (!exists) {
        this.logger.warn(`MinIO bucket "${this.bucket}" not found.`);
      }
    } catch (err) {
      this.logger.warn(`MinIO connectivity check failed: ${err}`);
    }
  }

  isImage(mimetype: string): boolean {
    return mimetype in MIME_EXT;
  }

  /** Uploads an image buffer and returns its public (proxied) URL. */
  async uploadImage(
    buffer: Buffer,
    mimetype: string,
  ): Promise<{ url: string; key: string }> {
    const ext = MIME_EXT[mimetype] ?? 'bin';
    const file = `${randomUUID()}.${ext}`;
    const key = `${BLOG_PREFIX}/${file}`;

    await this.client.putObject(this.bucket, key, buffer, buffer.length, {
      'Content-Type': mimetype,
    });

    return { url: this.publicUrl(file), key };
  }

  /** Streams a stored object (used by the public media proxy). */
  async getObject(
    key: string,
  ): Promise<{ stream: Readable; contentType: string; size: number }> {
    const stat = await this.client.statObject(this.bucket, key);
    const stream = await this.client.getObject(this.bucket, key);
    return {
      stream,
      contentType: stat.metaData?.['content-type'] ?? 'application/octet-stream',
      size: stat.size,
    };
  }

  /** Public URL served through our own backend (no public bucket required). */
  private publicUrl(file: string): string {
    const base = (process.env.APP_PUBLIC_URL ?? '').replace(/\/$/, '');
    return `${base}/media/${BLOG_PREFIX}/${file}`;
  }
}
