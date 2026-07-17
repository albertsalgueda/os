import { useCallback } from "react";
import { useLaunchApp } from "@/hooks/useLaunchApp";
import type { LaunchOriginRect } from "@/stores/useAppStore";
import { createClientLogger } from "@/utils/logger";
import { abortableFetch } from "@/utils/abortableFetch";
import type { ExtendedDisplayFileItem } from "../utils/fileSystemHelpers";

const log = createClientLogger("LocalFileSystem");

// Finder-facing paths for the real disk are prefixed with `/local`. The real
// filesystem path is the remainder (e.g. `/local/home/albert/x` → `/home/albert/x`).
export const LOCAL_PREFIX = "/local";
// Default landing directory when opening the local disk.
export const LOCAL_ROOT_PATH = "/local/home/albert";

// Raw entry shape returned by /api/local-fs/list.
interface LocalFsApiEntry {
  name: string;
  path: string; // real filesystem path
  isDirectory: boolean;
  size: number;
  type?: string;
  createdAt: number;
  modifiedAt: number;
}

interface LocalFsListResponse {
  path: string;
  entries: LocalFsApiEntry[];
}

/** True when a Finder path points at the real local disk. */
export function isLocalPath(path: string): boolean {
  return path === LOCAL_PREFIX || path.startsWith(`${LOCAL_PREFIX}/`);
}

/** Convert a Finder `/local/...` path to the real filesystem path. */
export function toRealPath(localPath: string): string {
  if (!isLocalPath(localPath)) return localPath;
  const real = localPath.slice(LOCAL_PREFIX.length);
  return real === "" ? "/" : real;
}

/** Convert a real filesystem path to a Finder `/local/...` path. */
export function toLocalPath(realPath: string): string {
  return `${LOCAL_PREFIX}${realPath === "/" ? "" : realPath}`;
}

// Extension groupings for open behavior.
const TEXT_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "json",
  "yaml",
  "yml",
  "toml",
  "csv",
  "xml",
  "html",
  "htm",
  "css",
  "js",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "jsx",
  "py",
  "sh",
  "bash",
  "zsh",
  "rb",
  "rs",
  "go",
  "c",
  "h",
  "cpp",
  "hpp",
  "java",
  "kt",
  "swift",
  "php",
  "sql",
  "log",
  "ini",
  "conf",
  "cfg",
  "env",
  "gitignore",
  "lock",
]);

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "svg",
  "ico",
  "avif",
]);

const PDF_EXTENSIONS = new Set(["pdf"]);

type LocalOpenKind = "text" | "image" | "pdf" | "download";

function classifyLocalFile(name: string): LocalOpenKind {
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (PDF_EXTENSIONS.has(ext)) return "pdf";
  if (TEXT_EXTENSIONS.has(ext)) return "text";
  return "download";
}

// Icon for a local entry, mirroring the VFS icon conventions.
function iconForLocalEntry(entry: LocalFsApiEntry): string {
  if (entry.isDirectory) return "/icons/directory.png";
  const kind = classifyLocalFile(entry.name);
  switch (kind) {
    case "image":
      return "/icons/image.png";
    case "pdf":
      return "/icons/default/file-pdf.png";
    case "text":
      return "/icons/file-text.png";
    default: {
      const ext = entry.type;
      if (ext && ["mp3", "wav", "ogg", "m4a", "flac"].includes(ext)) {
        return "/icons/sound.png";
      }
      if (ext && ["mp4", "mov", "webm", "mkv"].includes(ext)) {
        return "/icons/video-tape.png";
      }
      return "/icons/file.png";
    }
  }
}

function buildServeUrl(realPath: string): string {
  return `/api/local-fs/serve?path=${encodeURIComponent(realPath)}`;
}

function buildReadUrl(realPath: string): string {
  return `/api/local-fs/read?path=${encodeURIComponent(realPath)}`;
}

/**
 * Hook that bridges the Finder to the read-only local filesystem API.
 * Provides directory listing (mapped to Finder display items) and open
 * actions for local files.
 */
export function useLocalFileSystem() {
  const launchApp = useLaunchApp();

  // List a `/local/...` directory and map it to Finder display items.
  const listLocalDirectory = useCallback(
    async (localPath: string): Promise<ExtendedDisplayFileItem[]> => {
      const realPath = toRealPath(localPath);
      const response = await abortableFetch(
        `/api/local-fs/list?path=${encodeURIComponent(realPath)}`,
        {
          timeout: 15000,
          throwOnHttpError: false,
          retry: { maxAttempts: 2, initialDelayMs: 300 },
        }
      );

      if (!response.ok) {
        let message = `Failed to list ${realPath}`;
        try {
          const body = (await response.json()) as { error?: string };
          if (body?.error) message = body.error;
        } catch {
          // ignore JSON parse failures
        }
        throw new Error(message);
      }

      const data = (await response.json()) as LocalFsListResponse;
      return data.entries.map((entry) => ({
        name: entry.name,
        // Keep navigation inside the `/local` space.
        path: toLocalPath(entry.path),
        isDirectory: entry.isDirectory,
        icon: iconForLocalEntry(entry),
        type: entry.isDirectory ? "directory" : entry.type,
        size: entry.size,
        modifiedAt: entry.modifiedAt ? new Date(entry.modifiedAt) : undefined,
        data: { isLocal: true, realPath: entry.path },
      }));
    },
    []
  );

  // Open a local file according to its type.
  const openLocalFile = useCallback(
    async (
      file: ExtendedDisplayFileItem,
      launchOrigin?: LaunchOriginRect
    ): Promise<void> => {
      const realPath = toRealPath(file.path);
      const kind = classifyLocalFile(file.name);
      log.debug("Opening local file", { path: file.path, kind });

      try {
        switch (kind) {
          case "text": {
            const response = await abortableFetch(buildReadUrl(realPath), {
              timeout: 15000,
              throwOnHttpError: false,
              retry: { maxAttempts: 2, initialDelayMs: 300 },
            });
            if (!response.ok) {
              throw new Error(`Failed to read ${realPath}`);
            }
            const content = await response.text();
            launchApp("textedit", {
              initialData: { path: file.path, content },
              launchOrigin,
            });
            break;
          }
          case "image": {
            // Fetch bytes and hand the Blob to Preview for inline rendering.
            const response = await abortableFetch(buildServeUrl(realPath), {
              timeout: 20000,
              throwOnHttpError: false,
              retry: { maxAttempts: 2, initialDelayMs: 300 },
            });
            if (!response.ok) {
              throw new Error(`Failed to load ${realPath}`);
            }
            const blob = await response.blob();
            launchApp("preview", {
              initialData: { path: file.path, content: blob },
              launchOrigin,
            });
            break;
          }
          case "pdf": {
            // Let the browser's built-in PDF viewer handle it in a new tab.
            window.open(buildServeUrl(realPath), "_blank", "noopener");
            break;
          }
          case "download":
          default: {
            // Trigger a download via a transient anchor.
            const anchor = document.createElement("a");
            anchor.href = buildServeUrl(realPath);
            anchor.download = file.name;
            anchor.rel = "noopener";
            document.body.appendChild(anchor);
            anchor.click();
            document.body.removeChild(anchor);
            break;
          }
        }
      } catch (err) {
        log.error("Failed to open local file", {
          path: file.path,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    },
    [launchApp]
  );

  return {
    isLocalPath,
    toRealPath,
    toLocalPath,
    listLocalDirectory,
    openLocalFile,
  };
}
