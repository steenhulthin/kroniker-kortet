import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const githubPagesBase = "/kroniker-kortet/";

function ruksReleaseAssetProxy(): Plugin {
  return {
    name: "ruks-release-asset-proxy",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/ruks-release-asset")) {
          next();
          return;
        }

        const requestUrl = new URL(req.url, "http://127.0.0.1");
        const remoteUrl = requestUrl?.searchParams.get("url");

        if (!remoteUrl) {
          res.statusCode = 400;
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end("Missing required url parameter.");
          return;
        }

        try {
          const upstream = await fetch(remoteUrl, {
            redirect: "follow",
            headers: {
              Accept: "application/octet-stream",
            },
          });

          if (!upstream.ok) {
            res.statusCode = upstream.status;
            res.setHeader("Content-Type", "text/plain; charset=utf-8");
            res.end(`Upstream fetch failed with ${upstream.status} ${upstream.statusText}`);
            return;
          }

          const contentType =
            upstream.headers.get("content-type") ?? "application/octet-stream";
          const contentLength = upstream.headers.get("content-length");
          const buffer = Buffer.from(await upstream.arrayBuffer());

          res.statusCode = 200;
          res.setHeader("Content-Type", contentType);
          if (contentLength) {
            res.setHeader("Content-Length", contentLength);
          }
          res.setHeader("Cache-Control", "no-store");
          res.end(buffer);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unknown asset proxy error";

          server.config.logger.error(`[ruks-release-asset-proxy] ${message}`);
          res.statusCode = 502;
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end(`Asset proxy failed: ${message}`);
        }
      });
    },
  };
}

export default defineConfig(({ command }) => ({
  base:
    command === "build"
      ? process.env.VITE_APP_BASE_PATH ?? githubPagesBase
      : "/",
  plugins: [react(), ruksReleaseAssetProxy()],
}));
