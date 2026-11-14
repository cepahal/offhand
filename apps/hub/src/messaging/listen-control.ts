import { createServer, type Server } from "node:http";
import { LISTEN_PORT, type DispatchResult } from "./role-dispatch.js";

/** Local control port for the Photon process that already holds the Spectrum connection. */
export function startListenControl(
  dispatch: (body: unknown) => Promise<{ http: number; result: DispatchResult }>,
  port = Number(process.env.PHOTON_LISTEN_PORT ?? LISTEN_PORT),
): Server {
  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.method !== "POST" || req.url !== "/dispatch") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "failed", reason: "not found" }));
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      let body: unknown = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as unknown;
      } catch {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "failed", reason: "invalid message" }));
        return;
      }
      void dispatch(body)
        .then(({ http, result }) => {
          res.writeHead(http, { "content-type": "application/json" });
          res.end(JSON.stringify(result));
        })
        .catch(() => {
          res.writeHead(503, { "content-type": "application/json" });
          res.end(JSON.stringify({ status: "failed", reason: "Photon send failed" }));
        });
    });
  });
  server.listen(port, "127.0.0.1");
  return server;
}
