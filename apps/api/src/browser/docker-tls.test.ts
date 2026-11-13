import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import https from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DockerClient } from "./docker.js";

/**
 * The engine's certificate names the runtime host (an address, in
 * production), while the request carries Host: docker. Node would check the
 * certificate against "docker" and refuse; the client must check it against
 * the host it connected to.
 */
describe("DockerClient over mutual TLS", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "brawzer-docker-tls-"));
  let server: https.Server;
  let port = 0;
  let lastHost = "";
  const pem = (name: string) => readFileSync(path.join(dir, name), "utf8");

  beforeAll(async () => {
    const openssl = (...args: string[]) =>
      execFileSync("openssl", args, { cwd: dir, stdio: "pipe" });
    openssl("ecparam", "-genkey", "-name", "prime256v1", "-out", "ca-key.pem");
    openssl(
      "req",
      "-x509",
      "-new",
      "-key",
      "ca-key.pem",
      "-days",
      "2",
      "-subj",
      "/CN=test CA",
      "-out",
      "ca.pem",
    );
    openssl("ecparam", "-genkey", "-name", "prime256v1", "-out", "server-key.pem");
    openssl(
      "req",
      "-new",
      "-key",
      "server-key.pem",
      "-subj",
      "/CN=127.0.0.1",
      "-out",
      "server.csr",
    );
    writeFileSync(
      path.join(dir, "ext.cnf"),
      "subjectAltName=IP:127.0.0.1\nextendedKeyUsage=serverAuth\n",
    );
    openssl(
      "x509",
      "-req",
      "-in",
      "server.csr",
      "-CA",
      "ca.pem",
      "-CAkey",
      "ca-key.pem",
      "-CAcreateserial",
      "-days",
      "2",
      "-extfile",
      "ext.cnf",
      "-out",
      "server-cert.pem",
    );
    openssl("ecparam", "-genkey", "-name", "prime256v1", "-out", "key.pem");
    openssl("req", "-new", "-key", "key.pem", "-subj", "/CN=brawzer-api", "-out", "client.csr");
    writeFileSync(path.join(dir, "client-ext.cnf"), "extendedKeyUsage=clientAuth\n");
    openssl(
      "x509",
      "-req",
      "-in",
      "client.csr",
      "-CA",
      "ca.pem",
      "-CAkey",
      "ca-key.pem",
      "-CAcreateserial",
      "-days",
      "2",
      "-extfile",
      "client-ext.cnf",
      "-out",
      "cert.pem",
    );

    server = https.createServer(
      {
        ca: pem("ca.pem"),
        cert: pem("server-cert.pem"),
        key: pem("server-key.pem"),
        requestCert: true,
        rejectUnauthorized: true,
      },
      (request, response) => {
        lastHost = request.headers.host ?? "";
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ Id: "any" }));
      },
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as { port: number }).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  });

  it("checks the engine's certificate against the address it connected to, not the Host header", async () => {
    const client = new DockerClient({
      kind: "tcp",
      host: "127.0.0.1",
      port,
      tls: { ca: pem("ca.pem"), cert: pem("cert.pem"), key: pem("key.pem") },
    });
    expect(await client.hasImage("any")).toBe(true);
    expect(lastHost).toBe("docker");
  });

  it("still refuses a certificate for another host", async () => {
    const client = new DockerClient({
      kind: "tcp",
      host: "localhost",
      port,
      tls: { ca: pem("ca.pem"), cert: pem("cert.pem"), key: pem("key.pem") },
    });
    await expect(client.ping()).rejects.toThrow(/altnames|does not match/);
  });
});
