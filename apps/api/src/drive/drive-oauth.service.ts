export interface DriveTokens {
  userId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

export interface IDriveTokenRepository {
  save(tokens: DriveTokens): Promise<void>;
  findByUser(userId: string): Promise<DriveTokens | null>;
  delete(userId: string): Promise<void>;
}

export interface IOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface IOAuthHttpClient {
  exchangeCode(params: {
    code: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  }): Promise<{ access_token: string; refresh_token: string; expires_in: number }>;
  refreshToken(params: {
    refreshToken: string;
    clientId: string;
    clientSecret: string;
  }): Promise<{ access_token: string; expires_in: number }>;
}

export class DriveOAuthService {
  constructor(
    private readonly config: IOAuthConfig,
    private readonly httpClient: IOAuthHttpClient,
    private readonly tokenRepo: IDriveTokenRepository
  ) {}

  buildAuthUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: "code",
      scope: "https://www.googleapis.com/auth/drive.file",
      access_type: "offline",
      prompt: "consent",
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  async handleCallback(userId: string, code: string): Promise<void> {
    const tokens = await this.httpClient.exchangeCode({
      code,
      clientId: this.config.clientId,
      clientSecret: this.config.clientSecret,
      redirectUri: this.config.redirectUri,
    });
    await this.tokenRepo.save({
      userId,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    });
  }

  async getValidAccessToken(userId: string): Promise<string | null> {
    const stored = await this.tokenRepo.findByUser(userId);
    if (!stored) return null;
    if (stored.expiresAt > new Date(Date.now() + 60_000)) return stored.accessToken;
    const refreshed = await this.httpClient.refreshToken({
      refreshToken: stored.refreshToken,
      clientId: this.config.clientId,
      clientSecret: this.config.clientSecret,
    });
    await this.tokenRepo.save({
      ...stored,
      accessToken: refreshed.access_token,
      expiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
    });
    return refreshed.access_token;
  }

  async revokeAccess(userId: string): Promise<void> {
    await this.tokenRepo.delete(userId);
  }
}
