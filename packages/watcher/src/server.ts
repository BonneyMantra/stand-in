import fs from "node:fs";
import http from "node:http";
import { ledgerPath, logger, readEvents, standinHome, type NetworkConfig } from "@standin/core";
import { buildState, sseOf } from "./state.ts";

const log = logger("server");

export function startServer(cfg: NetworkConfig, opts: { port?: number; home?: string } = {}): http.Server {
  const home = opts.home ?? standinHome();
  const port = opts.port ?? Number(process.env.STANDIN_WATCHER_PORT ?? 4317);
  const clients = new Set<http.ServerResponse>();
  let seen = readEvents({}, home).length;

  // Tail the ledger: other processes (hooks, bench, CLI) append; fan new lines out over SSE.
  const poll = setInterval(() => {
    const all = readEvents({}, home);
    if (all.length < seen) seen = 0;
    for (const e of all.slice(seen)) {
      const m = sseOf(e, home);
      if (!m) continue;
      for (const c of clients) c.write(`event: ${m.event}\ndata: ${JSON.stringify(m.data)}\n\n`);
    }
    seen = all.length;
  }, 200);
  poll.unref();

  const server = http.createServer(async (req, res) => {
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
    if (req.method === "OPTIONS") { res.writeHead(204, cors).end(); return; }
    const url = new URL(req.url ?? "/", "http://x");
    try {
      if (url.pathname === "/api/state") {
        res.writeHead(200, { "content-type": "application/json", ...cors }).end(JSON.stringify(await buildState(cfg, home)));
      } else if (url.pathname === "/api/events") {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", ...cors });
        res.write(": connected\n\n");
        clients.add(res);
        const ka = setInterval(() => res.write(": ka\n\n"), 15000);
        req.on("close", () => { clients.delete(res); clearInterval(ka); });
      } else if (url.pathname === "/api/health") {
        res.writeHead(200, { "content-type": "application/json", ...cors }).end(JSON.stringify({ ok: true, ledger: ledgerPath(home), exists: fs.existsSync(ledgerPath(home)) }));
      } else {
        res.writeHead(404, { "content-type": "application/json", ...cors }).end(JSON.stringify({ error: "not found" }));
      }
    } catch (e) {
      log.error(`${url.pathname}: ${(e as Error).message}`);
      res.writeHead(500, { "content-type": "application/json", ...cors }).end(JSON.stringify({ error: "internal error" }));
    }
  });
  server.listen(port, "127.0.0.1", () => log.info(`api on http://127.0.0.1:${port}/api/state`));
  server.on("close", () => clearInterval(poll));
  return server;
}
