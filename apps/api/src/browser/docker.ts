import http from "node:http";
import https from "node:https";

/**
 * The few Docker Engine API calls the orchestrator needs, over the engine's
 * Unix socket or, in production, a TLS-protected TCP endpoint on a separate
 * runtime host (ADR 0016). No client library: the surface is small, and
 * nothing here should ever be reachable from a request.
 */
const API_VERSION = "v1.44";

/** Where the engine is: a local socket, or a remote daemon over mutual TLS. */
export type DockerEndpoint =
  | { kind: "socket"; path: string }
  | {
      kind: "tcp";
      host: string;
      port: number;
      tls: { ca: string; cert: string; key: string } | null;
    };

export class DockerError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "DockerError";
  }
}

export interface ContainerSpec {
  name: string;
  image: string;
  env: readonly string[];
  labels: Readonly<Record<string, string>>;
  /** Container ports → each bound on the engine host to an ephemeral port. */
  publishPorts: readonly number[];
  /** The engine host's address to bind published ports on (loopback for a local engine). */
  publishHostIp: string;
  /** A network to join, or `container:<id>` to share another container's network namespace. */
  network: string;
  /** Omitted for a container that shares another's namespace or needs none. */
  seccompProfile?: object | undefined;
  /** Capabilities kept on top of none; the egress service needs a few (ADR 0014). */
  capAdd?: readonly string[] | undefined;
  /** `host:gateway` style entries, for development only. */
  extraHosts?: readonly string[] | undefined;
  memoryBytes: number;
  cpus: number;
  pidsLimit: number;
  shmBytes?: number | undefined;
  tmpfsBytes?: number | undefined;
  /** An OCI runtime registered with the engine, such as `runsc` (gVisor); the default when omitted. */
  runtime?: string | undefined;
}

export interface ContainerState {
  id: string;
  running: boolean;
  exitCode: number | null;
  /** The host port the first published container port is bound to, when running. */
  hostPort: number | null;
  /** Every published container port → its host port. */
  hostPorts: Readonly<Record<number, number>>;
  labels: Readonly<Record<string, string>>;
}

interface InspectResponse {
  Id: string;
  State: { Running: boolean; ExitCode: number; Status: string };
  Config: { Labels: Record<string, string> | null };
  NetworkSettings: { Ports: Record<string, { HostIp: string; HostPort: string }[] | null> | null };
}

export class DockerClient {
  private readonly endpoint: DockerEndpoint;
  private readonly agent: https.Agent | null;

  constructor(
    endpoint: DockerEndpoint | string,
    private readonly timeoutMs = 15_000,
  ) {
    this.endpoint = typeof endpoint === "string" ? { kind: "socket", path: endpoint } : endpoint;
    this.agent =
      this.endpoint.kind === "tcp" && this.endpoint.tls
        ? new https.Agent({
            ca: this.endpoint.tls.ca,
            cert: this.endpoint.tls.cert,
            key: this.endpoint.tls.key,
            keepAlive: true,
          })
        : null;
  }

  /** For logs and health reports: never includes key material. */
  describe(): string {
    return this.endpoint.kind === "socket"
      ? `unix://${this.endpoint.path}`
      : `${this.endpoint.tls ? "tcps" : "tcp"}://${this.endpoint.host}:${String(this.endpoint.port)}`;
  }

  /** Raw request; the body is JSON unless the response is empty. */
  private request<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: unknown,
    timeoutMs = this.timeoutMs,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const where =
        this.endpoint.kind === "socket"
          ? { socketPath: this.endpoint.path }
          : { host: this.endpoint.host, port: this.endpoint.port };
      const transport = this.endpoint.kind === "tcp" && this.endpoint.tls ? https : http;
      const request = transport.request(
        {
          ...where,
          ...(this.agent ? { agent: this.agent } : {}),
          method,
          path: `/${API_VERSION}${path}`,
          headers: {
            host: "docker",
            ...(payload
              ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) }
              : {}),
          },
          timeout: timeoutMs,
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer) => chunks.push(chunk));
          response.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            const status = response.statusCode ?? 0;
            if (status >= 400) {
              let message = text;
              try {
                message = (JSON.parse(text) as { message?: string }).message ?? text;
              } catch {
                // Plain text error.
              }
              reject(new DockerError(status, message.slice(0, 500)));
              return;
            }
            if (text.length === 0) {
              resolve(undefined as T);
              return;
            }
            try {
              resolve(JSON.parse(text) as T);
            } catch {
              resolve(text as T);
            }
          });
        },
      );
      request.on("timeout", () => request.destroy(new Error("Docker request timed out")));
      request.on("error", (error) => reject(new DockerError(0, error.message)));
      request.end(payload);
    });
  }

  async ping(): Promise<void> {
    await this.request<string>("GET", "/_ping");
  }

  async hasImage(reference: string): Promise<boolean> {
    try {
      await this.request("GET", `/images/${encodeURIComponent(reference)}/json`);
      return true;
    } catch (error) {
      if (error instanceof DockerError && error.status === 404) return false;
      throw error;
    }
  }

  /** A bridge network whose containers can't talk to each other. */
  async ensureNetwork(name: string): Promise<void> {
    try {
      await this.request("GET", `/networks/${encodeURIComponent(name)}`);
      return;
    } catch (error) {
      if (!(error instanceof DockerError) || error.status !== 404) throw error;
    }
    try {
      await this.request("POST", "/networks/create", {
        Name: name,
        Driver: "bridge",
        Options: { "com.docker.network.bridge.enable_icc": "false" },
        Labels: { "brawzer.managed": "true" },
      });
    } catch (error) {
      // Created concurrently by another instance.
      if (!(error instanceof DockerError) || error.status !== 409) throw error;
    }
  }

  async createContainer(spec: ContainerSpec): Promise<string> {
    const ports = spec.publishPorts.map((port) => `${String(port)}/tcp`);
    const shared = spec.network.startsWith("container:");
    const created = await this.request<{ Id: string }>(
      "POST",
      `/containers/create?name=${encodeURIComponent(spec.name)}`,
      {
        Image: spec.image,
        Env: spec.env,
        Labels: spec.labels,
        // Ports belong to the namespace's owner; a container sharing one publishes nothing.
        ...(shared ? {} : { ExposedPorts: Object.fromEntries(ports.map((port) => [port, {}])) }),
        HostConfig: {
          NetworkMode: spec.network,
          ...(shared
            ? {}
            : {
                PortBindings: Object.fromEntries(
                  ports.map((port) => [port, [{ HostIp: spec.publishHostIp, HostPort: "" }]]),
                ),
              }),
          ...(spec.extraHosts?.length ? { ExtraHosts: spec.extraHosts } : {}),
          ReadonlyRootfs: true,
          CapDrop: ["ALL"],
          ...(spec.capAdd?.length ? { CapAdd: spec.capAdd } : {}),
          SecurityOpt: [
            "no-new-privileges",
            ...(spec.seccompProfile ? [`seccomp=${JSON.stringify(spec.seccompProfile)}`] : []),
          ],
          ...(spec.tmpfsBytes
            ? { Tmpfs: { "/tmp": `rw,nosuid,nodev,noexec,size=${String(spec.tmpfsBytes)}` } }
            : {}),
          ...(spec.shmBytes ? { ShmSize: spec.shmBytes } : {}),
          Memory: spec.memoryBytes,
          MemorySwap: spec.memoryBytes,
          NanoCpus: Math.round(spec.cpus * 1e9),
          PidsLimit: spec.pidsLimit,
          RestartPolicy: { Name: "no" },
          LogConfig: { Type: "json-file", Config: { "max-size": "5m", "max-file": "2" } },
          ...(spec.runtime ? { Runtime: spec.runtime } : {}),
        },
      },
    );
    return created.Id;
  }

  async startContainer(id: string): Promise<void> {
    await this.request("POST", `/containers/${id}/start`);
  }

  async inspect(id: string): Promise<ContainerState | null> {
    let response: InspectResponse;
    try {
      response = await this.request<InspectResponse>("GET", `/containers/${id}/json`);
    } catch (error) {
      if (error instanceof DockerError && error.status === 404) return null;
      throw error;
    }
    const hostPorts: Record<number, number> = {};
    for (const [port, bindings] of Object.entries(response.NetworkSettings.Ports ?? {})) {
      const bound = bindings?.find((binding) => binding.HostPort)?.HostPort;
      if (bound) hostPorts[Number(port.split("/")[0])] = Number(bound);
    }
    const first = Object.values(hostPorts)[0];
    return {
      id: response.Id,
      running: response.State.Running,
      exitCode: response.State.Running ? null : response.State.ExitCode,
      hostPort: first ?? null,
      hostPorts,
      labels: response.Config.Labels ?? {},
    };
  }

  /** Stops (briefly waiting for a clean exit) and removes; missing containers are fine. */
  async remove(id: string): Promise<void> {
    try {
      await this.request("POST", `/containers/${id}/stop?t=3`, undefined, 20_000);
    } catch (error) {
      if (!(error instanceof DockerError) || (error.status !== 404 && error.status !== 304)) {
        if (!(error instanceof DockerError) || error.status !== 409) throw error;
      }
    }
    try {
      await this.request("DELETE", `/containers/${id}?force=true&v=true`);
    } catch (error) {
      if (!(error instanceof DockerError) || error.status !== 404) throw error;
    }
  }

  /** Containers (running or not) carrying the label. */
  async listByLabel(label: string): Promise<{ id: string; labels: Record<string, string> }[]> {
    const filters = encodeURIComponent(JSON.stringify({ label: [label] }));
    const containers = await this.request<{ Id: string; Labels: Record<string, string> | null }[]>(
      "GET",
      `/containers/json?all=true&filters=${filters}`,
    );
    return containers.map((container) => ({ id: container.Id, labels: container.Labels ?? {} }));
  }
}
