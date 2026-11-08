import { type AddressInfo, connect, createServer, type Socket } from "node:net";

/** A minimal SOCKS5 proxy with username/password auth, on 127.0.0.1, for browser tests. */
export async function startSocksProxy(auth: { username: string; password: string }) {
  const sockets = new Set<Socket>();
  const server = createServer((client) => {
    sockets.add(client);
    client.on("close", () => sockets.delete(client));
    client.on("error", () => undefined);
    client.once("data", () => {
      client.write(Buffer.from([5, 2]));
      client.once("data", (message: Buffer) => {
        const userLength = message[1] ?? 0;
        const username = message.subarray(2, 2 + userLength).toString();
        const passwordLength = message[2 + userLength] ?? 0;
        const password = message
          .subarray(3 + userLength, 3 + userLength + passwordLength)
          .toString();
        if (username !== auth.username || password !== auth.password) {
          client.end(Buffer.from([1, 1]));
          return;
        }
        client.write(Buffer.from([1, 0]));
        client.once("data", (request: Buffer) => {
          let host = "";
          let offset = 0;
          if (request[3] === 1) {
            host = [...request.subarray(4, 8)].join(".");
            offset = 8;
          } else {
            const length = request[4] ?? 0;
            host = request.subarray(5, 5 + length).toString();
            offset = 5 + length;
          }
          const upstream = connect(request.readUInt16BE(offset), host, () => {
            client.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
            client.pipe(upstream).pipe(client);
          });
          upstream.on("error", () => client.end(Buffer.from([5, 5, 0, 1, 0, 0, 0, 0, 0, 0])));
        });
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "0.0.0.0", resolve));
  return {
    port: (server.address() as AddressInfo).port,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => {
          resolve();
        });
      }),
  };
}
