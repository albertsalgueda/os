/**
 * GET /api/local-fs/serve?path=<abs_path>
 *
 * Serves a file's raw bytes with the correct MIME type. Viewable types
 * (images, PDFs, text) are sent inline; everything else is sent as an
 * attachment (triggers a download). Jailed to `LOCAL_FS_ROOT`. Read-only.
 */
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { ApiRequest, ApiResponse } from "../_utils/api-types.js";
import {
  firstQueryValue,
  getMimeType,
  isInlineViewable,
  resolveJailedPath,
} from "./_shared.js";

// Cap in-memory serving so a huge file can't exhaust memory.
const MAX_SERVE_BYTES = 100 * 1024 * 1024; // 100 MB

export default async function handler(
  req: ApiRequest,
  res: ApiResponse
): Promise<void> {
  if ((req.method || "GET").toUpperCase() !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const requestedPath = firstQueryValue(req.query, "path");
  const resolution = await resolveJailedPath(requestedPath);
  if (!resolution.ok || !resolution.realPath) {
    res
      .status(resolution.status ?? 400)
      .json({ error: resolution.error ?? "Invalid path" });
    return;
  }

  const filePath = resolution.realPath;

  let fileStats;
  try {
    fileStats = await stat(filePath);
  } catch {
    res.status(404).json({ error: "Not found" });
    return;
  }

  if (fileStats.isDirectory()) {
    res.status(400).json({ error: "Path is a directory" });
    return;
  }

  if (fileStats.size > MAX_SERVE_BYTES) {
    res.status(413).json({ error: "File too large to serve" });
    return;
  }

  let bytes: Buffer;
  try {
    bytes = await readFile(filePath);
  } catch {
    res.status(403).json({ error: "Permission denied" });
    return;
  }

  const name = path.basename(filePath);
  const mime = getMimeType(name);
  const disposition = isInlineViewable(mime) ? "inline" : "attachment";

  res.setHeader("Content-Type", mime);
  res.setHeader("Content-Length", String(bytes.byteLength));
  res.setHeader(
    "Content-Disposition",
    `${disposition}; filename="${encodeURIComponent(name)}"`
  );
  res.setHeader("Cache-Control", "no-store");
  res.status(200).send(bytes);
}
