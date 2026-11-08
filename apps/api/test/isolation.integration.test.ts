/**
 * The isolation checks from the Phase 3 and 5 reviews, run against the real
 * images: what a page inside a session can and cannot reach, and what the
 * container is started with. They need the local Docker engine (`docker`
 * on the PATH), as the browser tests do, so that a change to the runtime,
 * the egress or the orchestrator can't weaken the boundary unnoticed.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { browserSessionSchema, profileSchema } from "@brawzer/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness, type TestBrowser } from "./support/harness.js";

const exec = promisify(execFile);
let h: Harness;

beforeAll(async () => {
  h = await createHarness({
    ipPrefix: "100.70.0",
    // The production firewall: private ranges dropped at the network level too.
    env: { BROWSER_TEST_SITE: "true", PROXY_TEST_ALLOW_PRIVATE: "false" },
  });
  await h.listen();
});

afterAll(async () => {
  await h.close();
});

async function docker(args: string[]): Promise<string> {
  const { stdout } = await exec("docker", args, { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
  return stdout.trim();
}

/** Runs a Node script inside a session's runtime container, as the engine's own user. */
function probe(sessionId: string, script: string): Promise<string> {
  return docker(["exec", `brawzer-runtime-${sessionId}`, "node", "-e", script]);
}

/** Fetches a URL the way a page would: through the filtering proxy inside the container. */
function throughProxy(sessionId: string, url: string): Promise<string> {
  return probe(
    sessionId,
    `const http=require("node:http");const u=new URL(${JSON.stringify(url)});
     const req=http.request({host:"127.0.0.1",port:3128,method:u.protocol==="https:"?"CONNECT":"GET",path:u.protocol==="https:"?u.host+":443":u.href,headers:{host:u.host}},(res)=>{let b="";res.on("data",(c)=>b+=c);res.on("end",()=>console.log(JSON.stringify({status:res.statusCode,body:b.slice(0,200)})))});
     req.on("connect",(res)=>{console.log(JSON.stringify({status:res.statusCode,body:"tunnel"}));process.exit(0)});
     req.on("error",(e)=>console.log(JSON.stringify({error:e.code})));req.end();`,
  );
}

async function withSession(client: TestBrowser, profileId: string | null) {
  const response = await client.post("/browser/sessions", profileId ? { profileId } : {});
  expect(response.statusCode, response.body).toBe(201);
  const session = browserSessionSchema.parse(response.json());
  return session;
}

async function endSession(client: TestBrowser, id: string) {
  expect((await client.delete(`/browser/sessions/${id}`)).statusCode).toBe(204);
}

describe("session isolation, checked against the real containers", () => {
  it("starts the runtime hardened and in the egress sidecar's network namespace", async () => {
    const client = h.browser();
    await h.signUp(client, h.uniqueEmail("isolation-container"));
    const session = await withSession(client, null);
    try {
      const runtime = JSON.parse(
        await docker([
          "inspect",
          "--format",
          "{{json .HostConfig}}",
          `brawzer-runtime-${session.id}`,
        ]),
      ) as Record<string, unknown>;
      expect(runtime.ReadonlyRootfs).toBe(true);
      expect(runtime.CapDrop).toEqual(["ALL"]);
      expect(runtime.CapAdd ?? null).toBeFalsy();
      expect(runtime.SecurityOpt).toEqual(
        expect.arrayContaining(["no-new-privileges", expect.stringMatching(/^seccomp=/)]),
      );
      expect(runtime.PidsLimit).toBe(1024);
      expect(runtime.Memory).toBe(2048 * 1024 * 1024);
      expect(runtime.MemorySwap).toBe(runtime.Memory);
      expect((runtime.Tmpfs as Record<string, string>)["/tmp"]).toMatch(/noexec/);
      expect(runtime.NetworkMode).toMatch(/^container:/);
      expect(runtime.PortBindings ?? {}).toEqual({});

      const egressName = `brawzer-egress-${session.id}`;
      const egress = JSON.parse(
        await docker(["inspect", "--format", "{{json .HostConfig}}", egressName]),
      ) as Record<string, unknown>;
      expect(egress.CapDrop).toEqual(["ALL"]);
      expect(egress.CapAdd).toEqual(expect.arrayContaining(["NET_ADMIN", "SETUID", "SETGID"]));
      expect(egress.ReadonlyRootfs).toBe(true);

      // One network namespace for the pair; the engine has no network of its own.
      const ns = 'console.log(require("node:fs").readlinkSync("/proc/self/ns/net"))';
      expect(await probe(session.id, ns)).toBe(
        await docker(["exec", egressName, "node", "-e", ns]),
      );

      // Inside the runtime: a read-only root, a noexec scratch space, no capabilities.
      const status = await probe(
        session.id,
        `const fs=require("node:fs"),cp=require("node:child_process");
         const out={};
         try{fs.writeFileSync("/usr/brawzer-probe","");out.root="writable"}catch(e){out.root=e.code}
         try{fs.copyFileSync("/bin/true","/tmp/brawzer-probe");fs.chmodSync("/tmp/brawzer-probe",0o755);cp.execFileSync("/tmp/brawzer-probe");out.tmp="ran"}catch(e){out.tmp=e.code}
         const s=fs.readFileSync("/proc/self/status","utf8");
         out.caps=/CapEff:\\s*(\\w+)/.exec(s)[1];out.noNewPrivs=/NoNewPrivs:\\s*(\\d)/.exec(s)[1];out.uid=process.getuid();
         console.log(JSON.stringify(out))`,
      );
      expect(JSON.parse(status)).toEqual({
        root: "EROFS",
        tmp: "EACCES",
        caps: "0000000000000000",
        noNewPrivs: "1",
        uid: 10001,
      });

      // The sidecar's rules: nothing leaves except from the egress user, and private ranges never do.
      const rules = await docker([
        "exec",
        "-u",
        "0",
        egressName,
        "nft",
        "list",
        "table",
        "inet",
        "brawzer",
      ]);
      expect(rules).toContain("policy drop");
      expect(rules).toContain("meta skuid 10002 accept");
      expect(rules).toMatch(/10\.0\.0\.0\/8.*drop/);
      // Which is the user the egress process runs as.
      const uids = await docker([
        "exec",
        egressName,
        "sh",
        "-c",
        'for p in /proc/[0-9]*; do grep -q "^node" "$p/comm" 2>/dev/null && awk "/^Uid:/{print \\$2}" "$p/status"; done | sort -u',
      ]);
      expect(uids).toBe("10002");
    } finally {
      await endSession(client, session.id);
    }
  }, 120_000);

  for (const engine of ["bee", "firefox"] as const) {
    it(`gives a ${engine} page no way out but the filtering proxy`, async () => {
      const client = h.browser();
      await h.signUp(client, h.uniqueEmail(`isolation-${engine}`));
      let profileId: string | null = null;
      if (engine === "firefox") {
        const created = await client.post("/profiles", { name: "Firefox", color: "teal", engine });
        expect(created.statusCode, created.body).toBe(201);
        profileId = profileSchema.parse(created.json()).id;
      }
      const session = await withSession(client, profileId);
      try {
        expect(session.engine).toBe(engine);

        // No route out and no name resolution for the engine's user.
        const direct = await probe(
          session.id,
          `const net=require("node:net");const dns=require("node:dns");
           const out={};let left=2;const done=()=>{if(--left===0)console.log(JSON.stringify(out))};
           const s=net.connect({host:"1.1.1.1",port:443});const t=setTimeout(()=>{out.connect="timeout";s.destroy();done()},4000);
           s.on("connect",()=>{clearTimeout(t);out.connect="connected";s.destroy();done()});s.on("error",(e)=>{clearTimeout(t);out.connect=e.code;done()});
           const r=new dns.Resolver({timeout:2000,tries:1});r.resolve4("example.com",(e)=>{out.dns=e?e.code:"resolved";done()});`,
        );
        const outside = JSON.parse(direct) as { connect: string; dns: string };
        expect(outside.connect).not.toBe("connected");
        expect(outside.dns).not.toBe("resolved");

        // The proxy refuses private addresses, the engine's own services, the
        // vendor's services, and loopback (the agent and the engine's own port).
        for (const url of [
          "http://10.0.0.1/",
          "http://192.168.1.1/",
          "http://169.254.169.254/latest/meta-data/",
          "http://127.0.0.1:7000/healthz",
          "http://localhost:7000/healthz",
          "http://127.0.0.1:9222/json",
          "http://[::1]:7000/healthz",
          "http://update.googleapis.com/",
          "http://safebrowsing.googleapis.com/",
          "https://10.0.0.1/",
          "https://127.0.0.1:7000/",
        ]) {
          const answer = JSON.parse(await throughProxy(session.id, url)) as {
            status?: number;
            body?: string;
            error?: string;
          };
          expect(answer, url).toMatchObject({ status: 403 });
          if (answer.body !== "tunnel") expect(answer.body, url).toContain("Blocked by Brawzer");
        }

        // What it does serve itself: Brawzer's start page, and the test site in tests.
        expect(JSON.parse(await throughProxy(session.id, "http://bee.invalid/"))).toMatchObject({
          status: 200,
        });
        expect(
          JSON.parse(await throughProxy(session.id, "http://testsite.invalid/")),
        ).toMatchObject({
          status: 200,
        });

        // Nothing debuggable listens where a page could reach it directly.
        const debug = await probe(
          session.id,
          `const net=require("node:net");const s=net.connect({host:"127.0.0.1",port:9222});
           s.on("connect",()=>{console.log("open");s.destroy()});s.on("error",(e)=>console.log(e.code));`,
        );
        if (engine === "bee") expect(debug).toBe("ECONNREFUSED");
      } finally {
        await endSession(client, session.id);
      }
    }, 120_000);
  }
});
