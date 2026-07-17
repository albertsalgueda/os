/**
 * GET /api/local-fs/read?path=<abs_path>
 *
 * Returns the UTF-8 text content of a file jailed to `LOCAL_FS_ROOT`.
 * Intended for opening text files in TextEdit. Read-only.
 */
import { readFile, stat } from "node:fs/promises";
import type { ApiRequest, ApiResponse } from "../_utils/api-types.js";
import { firstQueryValue, resolveJailedPath } from "./_shared.js";

// Cap the text read so a huge file can't exhaust memory / the editor.
const MAX_TEXT_BYTES = 10 * 1024 * 1024; // 10 MB

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

  if (fileStats.size > MAX_TEXT_BYTES) {
    res.status(413).json({ error: "File too large to read as text" });
    return;
  }

  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch {
    res.status(403).json({ error: "Permission denied" });
    return;
  }

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.status(200).send(content);
}
