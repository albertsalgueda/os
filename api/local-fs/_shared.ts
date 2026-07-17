/**
 * Shared helpers for the read-only local filesystem API.
 *
 * All access is jailed to `LOCAL_FS_ROOT` (defaults to `/home/albert`).
 * Paths are fully resolved (symlinks included) before the jail check so a
 * symlink cannot be used to escape the jail. Dotfiles/dirs are hidden by
 * default. There are no write/delete/rename endpoints — browse and view only.
 */
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { ApiRequestQuery } from "../_utils/api-types.js";

// Root the API is jailed to. Everything outside is rejected.
export const LOCAL_FS_ROOT = path.resolve(
  process.env.LOCAL_FS_ROOT || "/home/albert"
);

export interface LocalFsEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  type?: string;
  createdAt: number;
  modifiedAt: number;
}

export interface JailResolution {
  ok: boolean;
  realPath?: string;
  status?: number;
  error?: string;
}

/** Read the first value for a query key (query values may be arrays). */
export function firstQueryValue(
  query: ApiRequestQuery,
  key: string
): string | undefined {
  const value = query[key];
  if (Array.isArray(value)) return value[0];
  return value;
}

/** True when `name` should be hidden by default (dotfiles/dirs). */
export function isHiddenName(name: string): boolean {
  return name.startsWith(".");
}

/** Lowercased file extension without the leading dot, or undefined. */
export function getExtensionType(name: string): string | undefined {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return undefined;
  return name.slice(dot + 1).toLowerCase();
}

function isInsideJail(realResolvedPath: string): boolean {
  return (
    realResolvedPath === LOCAL_FS_ROOT ||
    realResolvedPath.startsWith(LOCAL_FS_ROOT + path.sep)
  );
}

/**
 * Resolve an absolute request path to a real filesystem path, rejecting
 * anything that (after symlink resolution) escapes the jail or does not exist.
 */
export async function resolveJailedPath(
  inputPath: string | undefined
): Promise<JailResolution> {
  const requested =
    !inputPath || inputPath.trim() === "" ? LOCAL_FS_ROOT : inputPath;

  if (!path.isAbsolute(requested)) {
    return { ok: false, status: 400, error: "Path must be absolute" };
  }

  // Normalize away any `..`/`.` segments before touching the filesystem.
  const normalized = path.resolve(requested);

  let realResolvedPath: string;
  try {
    realResolvedPath = await realpath(normalized);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      return { ok: false, status: 404, error: "Not found" };
    }
    if (code === "EACCES") {
      return { ok: false, status: 403, error: "Permission denied" };
    }
    return { ok: false, status: 400, error: "Invalid path" };
  }

  if (!isInsideJail(realResolvedPath)) {
    // Report as 404 so callers cannot probe the layout outside the jail.
    return { ok: false, status: 404, error: "Not found" };
  }

  return { ok: true, realPath: realResolvedPath };
}

/** Build a directory entry from an absolute (already-jailed) path. */
export async function buildEntry(
  absolutePath: string,
  name: string
): Promise<LocalFsEntry | null> {
  try {
    const stats = await stat(absolutePath);
    const isDirectory = stats.isDirectory();
    return {
      name,
      path: absolutePath,
      isDirectory,
      size: stats.size,
      ...(isDirectory ? {} : { type: getExtensionType(name) }),
      createdAt: Math.round(stats.birthtimeMs || stats.ctimeMs),
      modifiedAt: Math.round(stats.mtimeMs),
    };
  } catch {
    // Broken symlink / unreadable entry — skip rather than fail the listing.
    return null;
  }
}

// Extension → MIME type. Fallback (octet-stream) triggers a download.
const MIME_TYPES: Record<string, string> = {
  // images
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/x-icon",
  avif: "image/avif",
  // documents
  pdf: "application/pdf",
  // text / code
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  markdown: "text/markdown; charset=utf-8",
  json: "application/json; charset=utf-8",
  yaml: "text/yaml; charset=utf-8",
  yml: "text/yaml; charset=utf-8",
  toml: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  cjs: "text/javascript; charset=utf-8",
  ts: "text/plain; charset=utf-8",
  tsx: "text/plain; charset=utf-8",
  jsx: "text/plain; charset=utf-8",
  py: "text/plain; charset=utf-8",
  sh: "text/plain; charset=utf-8",
  rs: "text/plain; charset=utf-8",
  go: "text/plain; charset=utf-8",
  // audio
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  flac: "audio/flac",
  // video
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
};

export function getMimeType(name: string): string {
  const ext = getExtensionType(name);
  if (ext && MIME_TYPES[ext]) return MIME_TYPES[ext];
  return "application/octet-stream";
}

/** MIME types that browsers can safely render inline in a tab/img. */
export function isInlineViewable(mime: string): boolean {
  return (
    mime.startsWith("image/") ||
    mime.startsWith("text/") ||
    mime === "application/pdf" ||
    mime === "application/json; charset=utf-8" ||
    mime === "application/xml; charset=utf-8"
  );
}
