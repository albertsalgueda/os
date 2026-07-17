/**
 * GET /api/local-fs/list?path=<abs_path>[&showHidden=true]
 *
 * Lists the entries of a directory jailed to `LOCAL_FS_ROOT`. Dotfiles/dirs are
 * hidden unless `showHidden=true`. Read-only.
 */
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { ApiRequest, ApiResponse } from "../_utils/api-types.js";
import {
  buildEntry,
  firstQueryValue,
  isHiddenName,
  resolveJailedPath,
  type LocalFsEntry,
} from "./_shared.js";

export default async function handler(
  req: ApiRequest,
  res: ApiResponse
): Promise<void> {
  if ((req.method || "GET").toUpperCase() !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const requestedPath = firstQueryValue(req.query, "path");
  const showHidden = firstQueryValue(req.query, "showHidden") === "true";

  const resolution = await resolveJailedPath(requestedPath);
  if (!resolution.ok || !resolution.realPath) {
    res
      .status(resolution.status ?? 400)
      .json({ error: resolution.error ?? "Invalid path" });
    return;
  }

  const dirPath = resolution.realPath;

  let dirStats;
  try {
    dirStats = await stat(dirPath);
  } catch {
    res.status(404).json({ error: "Not found" });
    return;
  }

  if (!dirStats.isDirectory()) {
    res.status(400).json({ error: "Not a directory" });
    return;
  }

  let dirents;
  try {
    dirents = await readdir(dirPath, { withFileTypes: true });
  } catch {
    res.status(403).json({ error: "Permission denied" });
    return;
  }

  const entries: LocalFsEntry[] = [];
  for (const dirent of dirents) {
    if (!showHidden && isHiddenName(dirent.name)) continue;
    const entry = await buildEntry(
      path.join(dirPath, dirent.name),
      dirent.name
    );
    if (entry) entries.push(entry);
  }

  // Directories first, then case-insensitive name order.
  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });

  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ path: dirPath, entries });
}
