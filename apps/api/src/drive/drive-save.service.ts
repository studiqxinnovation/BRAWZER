export interface DriveFile {
  sessionId: string;
  userId: string;
  driveFileId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  savedAt: Date;
}

export interface IDriveClient {
  upload(params: {
    userId: string;
    filename: string;
    mimeType: string;
    buffer: Buffer;
  }): Promise<{ fileId: string }>;
}

export interface IDownloadEvent {
  sessionId: string;
  userId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  tempUrl: string;
}

export interface IDriveSaveRepository {
  save(file: DriveFile): Promise<void>;
  findBySession(sessionId: string): Promise<DriveFile[]>;
  findByUser(userId: string): Promise<DriveFile[]>;
}

export class DriveSaveService {
  constructor(
    private readonly driveClient: IDriveClient,
    private readonly repo: IDriveSaveRepository
  ) {}

  async handleDownload(event: IDownloadEvent): Promise<DriveFile> {
    const response = await fetch(event.tempUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch temp file: ${response.status} ${event.tempUrl}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    const { fileId } = await this.driveClient.upload({
      userId: event.userId,
      filename: event.filename,
      mimeType: event.mimeType,
      buffer,
    });

    const record: DriveFile = {
      sessionId: event.sessionId,
      userId: event.userId,
      driveFileId: fileId,
      filename: event.filename,
      mimeType: event.mimeType,
      sizeBytes: event.sizeBytes,
      savedAt: new Date(),
    };

    await this.repo.save(record);
    return record;
  }
}
