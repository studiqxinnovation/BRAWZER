import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import type { StorageConfig } from "../config/env.js";

/**
 * What Brawzer needs from an object store. Keys are opaque strings; callers
 * decide the layout (`drive/<userId>/<fileId>`). The API is the store's only
 * client, and credentials never leave the server.
 */
export interface ObjectStore {
  /** Streams `body` into the store. Works without knowing the length up front. */
  put(key: string, body: Readable): Promise<void>;
  /** Null when there is no such object. */
  get(key: string): Promise<Readable | null>;
  delete(key: string): Promise<void>;
  deleteMany(keys: readonly string[]): Promise<void>;
  listKeys(prefix: string): AsyncIterable<string>;
  /** Fails when the bucket can't be reached. */
  ping(): Promise<void>;
  /** Development and tests: creates the bucket if it's missing. */
  ensureBucket(): Promise<void>;
}

export class S3ObjectStore implements ObjectStore {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(private readonly config: StorageConfig) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      region: config.region,
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      forcePathStyle: config.forcePathStyle,
      // A copy: the SDK records where credentials came from on the object
      // itself, and the config's objects are frozen.
      ...(config.credentials ? { credentials: { ...config.credentials } } : {}),
    });
  }

  async put(key: string, body: Readable): Promise<void> {
    const upload = new Upload({
      client: this.client,
      params: { Bucket: this.bucket, Key: key, Body: body },
      // 8 MiB parts, two in flight: bounded memory per upload.
      partSize: 8 * 1024 * 1024,
      queueSize: 2,
      leavePartsOnError: false,
    });
    await upload.done();
  }

  async get(key: string): Promise<Readable | null> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      const body = response.Body;
      if (!body) return null;
      if (body instanceof Readable) return body;
      // Other runtimes hand back a web stream.
      return Readable.fromWeb(body.transformToWebStream() as WebReadableStream);
    } catch (error) {
      if (error instanceof S3ServiceException && error.name === "NoSuchKey") return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async deleteMany(keys: readonly string[]): Promise<void> {
    for (let start = 0; start < keys.length; start += 1000) {
      const batch = keys.slice(start, start + 1000);
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
        }),
      );
    }
  }

  async *listKeys(prefix: string): AsyncIterable<string> {
    let token: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }),
      );
      for (const object of page.Contents ?? []) {
        if (object.Key) yield object.Key;
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
  }

  async ping(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.ping();
    } catch (error) {
      const status =
        error instanceof S3ServiceException ? error.$metadata.httpStatusCode : undefined;
      if (status !== 404 && !(error instanceof S3ServiceException && error.name === "NotFound")) {
        throw error;
      }
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
  }

  destroy(): void {
    this.client.destroy();
  }
}
