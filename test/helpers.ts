import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/** Minimal request handler for a `withServer` test server. */
export type ServerHandler = (req: IncomingMessage, res: ServerResponse) => void;

/**
 * Starts a `node:http` server on a random free port, runs `fn` with its
 * base URL (`http://127.0.0.1:<port>`), and always tears the server down
 * afterwards — mirrors the Go SDK's `httptest.NewServer` test helper.
 */
export async function withServer<T>(
  handler: ServerHandler,
  fn: (baseURL: string) => Promise<T>,
): Promise<T> {
  const server = createServer(handler);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  try {
    const address = server.address() as AddressInfo;
    const baseURL = `http://127.0.0.1:${address.port}`;
    return await fn(baseURL);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}
