import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";

interface AssetSpec {
  fileName: string;
  contentType: string;
  cacheControl: string;
}

function resolvePublicDir(): string {
  const candidates = [
    path.resolve(process.cwd(), "public"),
    path.resolve(process.cwd(), "server", "public"),
    path.resolve(__dirname, "..", "..", "public"),
  ];

  for (const candidate of candidates) {
    if (fsSync.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

const PUBLIC_DIR = resolvePublicDir();

const ASSETS: Record<string, AssetSpec> = {
  "/app": {
    fileName: "index.html",
    contentType: "text/html; charset=utf-8",
    cacheControl: "no-store",
  },
  "/app.css": {
    fileName: "app.css",
    contentType: "text/css; charset=utf-8",
    cacheControl: "public, max-age=300",
  },
  "/app.js": {
    fileName: "app.js",
    contentType: "application/javascript; charset=utf-8",
    cacheControl: "public, max-age=300",
  },
  "/manifest.webmanifest": {
    fileName: "manifest.webmanifest",
    contentType: "application/manifest+json; charset=utf-8",
    cacheControl: "public, max-age=3600",
  },
  "/sw.js": {
    fileName: "sw.js",
    contentType: "application/javascript; charset=utf-8",
    cacheControl: "no-store",
  },
  "/app-icon.svg": {
    fileName: "app-icon.svg",
    contentType: "image/svg+xml",
    cacheControl: "public, max-age=3600",
  },
};

async function sendAsset(reply: FastifyReply, routePath: string): Promise<void> {
  const asset = ASSETS[routePath];
  if (!asset) {
    reply.code(404).send({ ok: false, message: "Not found" });
    return;
  }

  const fullPath = path.join(PUBLIC_DIR, asset.fileName);
  try {
    const payload = await fs.readFile(fullPath);
    reply
      .header("Content-Type", asset.contentType)
      .header("Cache-Control", asset.cacheControl)
      .send(payload);
  } catch {
    reply.code(404).send({ ok: false, message: `Missing asset: ${asset.fileName}` });
  }
}

export async function registerPwaRoutes(server: FastifyInstance): Promise<void> {
  server.get("/", async (_request, reply) => {
    reply.redirect("/app");
  });

  for (const routePath of Object.keys(ASSETS)) {
    server.get(routePath, async (_request, reply) => {
      await sendAsset(reply, routePath);
    });
  }

  server.get("/favicon.ico", async (_request, reply) => {
    await sendAsset(reply, "/app-icon.svg");
  });
}
