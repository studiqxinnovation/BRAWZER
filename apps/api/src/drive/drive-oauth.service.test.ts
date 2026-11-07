import { describe, it, expect, vi, beforeEach } from "vitest";
import { DriveOAuthService, IOAuthConfig, IOAuthHttpClient, IDriveTokenRepository } from "./drive-oauth.service";

const config: IOAuthConfig = {
  clientId: "client-id",
  clientSecret: "client-secret",
  redirectUri: "https://brawzer.app/auth/drive/callback",
};

const mockHttp: IOAuthHttpClient = {
  exchangeCode: vi.fn().mockResolvedValue({ access_token: "access-123", refresh_token: "refresh-456", expires_in: 3600 }),
  refreshToken: vi.fn().mockResolvedValue({ access_token: "access-new", expires_in: 3600 }),
};

const mockRepo: IDriveTokenRepository = {
  save: vi.fn().mockResolvedValue(undefined),
  findByUser: vi.fn(),
  delete: vi.fn().mockResolvedValue(undefined),
};

describe("DriveOAuthService", () => {
  let service: DriveOAuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new DriveOAuthService(config, mockHttp, mockRepo);
  });

  it("builds a valid Google auth URL", () => {
    const url = service.buildAuthUrl("state-xyz");
    expect(url).toContain("accounts.google.com");
    expect(url).toContain("client_id=client-id");
    expect(url).toContain("state=state-xyz");
    expect(url).toContain("drive.file");
  });

  it("exchanges code and saves tokens", async () => {
    await service.handleCallback("user-1", "auth-code");
    expect(mockHttp.exchangeCode).toHaveBeenCalledWith(expect.objectContaining({ code: "auth-code" }));
    expect(mockRepo.save).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-1", accessToken: "access-123" }));
  });

  it("returns stored token when not expired", async () => {
    (mockRepo.findByUser as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      userId: "user-1", accessToken: "access-valid", refreshToken: "refresh-456",
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });
    expect(await service.getValidAccessToken("user-1")).toBe("access-valid");
    expect(mockHttp.refreshToken).not.toHaveBeenCalled();
  });

  it("refreshes token when expired", async () => {
    (mockRepo.findByUser as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      userId: "user-1", accessToken: "access-old", refreshToken: "refresh-456",
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(await service.getValidAccessToken("user-1")).toBe("access-new");
    expect(mockHttp.refreshToken).toHaveBeenCalled();
  });

  it("returns null when no tokens stored", async () => {
    (mockRepo.findByUser as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    expect(await service.getValidAccessToken("user-1")).toBeNull();
  });

  it("deletes tokens on revoke", async () => {
    await service.revokeAccess("user-1");
    expect(mockRepo.delete).toHaveBeenCalledWith("user-1");
  });
});
