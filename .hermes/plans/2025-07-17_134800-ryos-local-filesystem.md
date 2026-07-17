# ryOS Local Filesystem + Deploy to os.albertsalgueda.com

> **Goal:** make ryOS's Finder app browse the real filesystem at `/home/albert/` and deploy it at `os.albertsalgueda.com` (Tailscale-only, like money.albertsalgueda.com).

---

## Current state

- ryOS cloned at `/home/albert/ryos` — Vite + React + Bun, 86 deps
- VFS is 100% client-side: zustand store (`useFilesStore.ts`, 2k lines) + IndexedDB for content
- `FileSystemItem` interface already has `path`, `name`, `isDirectory`, `size`, `createdAt`, `modifiedAt` — maps 1:1 to real `fs.stat()`
- Finder reads from zustand store via `useFileSystem.ts` (1.8k lines)
- Backend already exists: Bun standalone server on port 3000, `api/` dir with route handlers
- Caddy runs inside Docker (`agent-memory-caddy-1`), Caddyfile at `/home/albert/agent-memory-prod/Caddyfile`
- Certs via certbot + DNS-01 (gcloud, project `albert-489117`, zone `albertsalgueda-com`)
- Bun 1.3.13 available at `/home/albert/.bun/bin/bun`

## Architecture

Three layers, minimal invasion into ryOS core:

```
Browser (Finder UI)
   │
   ├─ VFS paths (/, /Documents, /Music...)  →  existing zustand + IndexedDB (untouched)
   │
   └─ Local paths (/local/home/albert/...)  →  NEW api/local-fs endpoint  →  real fs
```

The Finder sidebar gets a new "Local Disk" entry. When navigating under `/local/`, Finder calls the API instead of the VFS. Everything else stays stock ryOS.

---

## Phase 1: Filesystem API (~150 lines)

### Task 1.1: Create `api/local-fs.ts` route handler

**File:** `api/local-fs.ts`

Endpoints:
- `GET /api/local-fs/list?path=<abs_path>` — returns JSON array of entries
- `GET /api/local-fs/read?path=<abs_path>` — returns text file content
- `GET /api/local-fs/serve?path=<abs_path>` — serves binary (image, pdf, etc.) with correct MIME

Security:
- Jail all paths to `/home/albert/` — reject anything outside
- Resolve symlinks before checking jail (prevent escape via `../`)
- Skip dotfiles/dirs by default (`.git`, `.env`, `.ssh`, etc.) unless `?showHidden=true`
- Read-only — no write/delete/rename endpoints

Response shape for `/list`:
```json
{
  "path": "/home/albert/projects",
  "entries": [
    {
      "name": "money-dashboard",
      "path": "/home/albert/projects/money-dashboard",
      "isDirectory": true,
      "size": 4096,
      "createdAt": 1718920000000,
      "modifiedAt": 1719360000000
    },
    {
      "name": "README.md",
      "path": "/home/albert/projects/README.md",
      "isDirectory": false,
      "size": 1234,
      "type": "md",
      "createdAt": 1718920000000,
      "modifiedAt": 1719360000000
    }
  ]
}
```

### Task 1.2: MIME type mapping

Simple extension → MIME map for `/serve` endpoint. Cover: images (png/jpg/gif/svg/webp), pdf, json, yaml, md, txt, html, css, js/ts, audio, video. Fallback: `application/octet-stream` (triggers download).

---

## Phase 2: Finder UI integration (~400 lines)

### Task 2.1: Add local filesystem hook

**File:** `src/apps/finder/hooks/useLocalFileSystem.ts` (new)

A React hook that:
- Calls `/api/local-fs/list?path=X` when navigating local paths
- Maps API response to `ExtendedDisplayFileItem[]` (Finder's display type)
- Assigns icons based on file extension (reuse existing icon logic)
- Handles loading/error states

### Task 2.2: Wire "Macintosh HD" sidebar to local disk

**File:** `src/apps/finder/hooks/useFileSystem.ts` (modify)

The sidebar already has "Macintosh HD". When clicked:
- Set current path to `/local/home/albert`
- Detect the `/local/` prefix → use `useLocalFileSystem` instead of VFS
- Directory navigation works recursively (click folder → append to path → re-fetch)

Key integration point: the `getFilesForPath()` function (or equivalent) in `useFileSystem.ts` — add an early return that delegates to the local FS hook when path starts with `/local/`.

### Task 2.3: File open actions for local files

- **Text files** (.txt, .md, .json, .yaml, .toml, .ts, .js, .py, .sh, etc.): open in TextEdit via `/api/local-fs/read`
- **Images** (.png, .jpg, .gif, .svg, .webp): preview inline via `/api/local-fs/serve` as `<img src>`
- **PDFs**: open in browser via `/api/local-fs/serve` (browser's built-in PDF viewer)
- **Everything else**: download via `/api/local-fs/serve`

### Task 2.4: Breadcrumb / path bar

The Finder toolbar shows the current path. For local paths, show the real path (e.g., `/home/albert/projects/money-dashboard`) instead of the VFS virtual path.

---

## Phase 3: Build & Deploy (~30 min)

### Task 3.1: Install dependencies and build

```bash
cd /home/albert/ryos
/home/albert/.bun/bin/bun install
/home/albert/.bun/bin/bun run build
```

The ryOS app needs minimal env vars for our use case (no Redis, no Pusher, no AI keys needed — just the Finder + local FS). Create a `.env.local` with just:
```
NODE_ENV=production
PORT=8796
```

### Task 3.2: Create systemd user service

**File:** `~/.config/systemd/user/ryos.service`

```ini
[Unit]
Description=ryOS (local filesystem UI) on :8796
After=network.target

[Service]
Type=simple
WorkingDirectory=/home/albert/ryos
Environment=NODE_ENV=production
Environment=PORT=8796
ExecStart=/home/albert/.bun/bin/bun run start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

Port 8796 — next available after 8795 (stocks-dashboard).

### Task 3.3: DNS record

```bash
gcloud dns record-sets create os.albertsalgueda.com. \
  --project=albert-489117 \
  --zone=albertsalgueda-com \
  --type=A \
  --ttl=300 \
  --rrdatas="100.71.180.93"
```

Points to the Tailscale IP — only reachable from Albert's Tailnet devices (phone, laptop).

### Task 3.4: TLS certificate

```bash
sudo certbot certonly \
  --manual \
  --preferred-challenges dns \
  --manual-auth-hook /home/albert/agent-memory-prod/certs/hooks/authenticator.sh \
  --manual-cleanup-hook /home/albert/agent-memory-prod/certs/hooks/cleanup.sh \
  -d os.albertsalgueda.com \
  --cert-name os.albertsalgueda.com
```

Same flow as the other subdomains — certbot + gcloud DNS-01.

### Task 3.5: Caddy config

Add to `/home/albert/agent-memory-prod/Caddyfile`:

```caddyfile
os.albertsalgueda.com {
    tls /certs/live/os.albertsalgueda.com/fullchain.pem /certs/live/os.albertsalgueda.com/privkey.pem
    encode zstd gzip

    @tailnet {
        remote_ip 127.0.0.0/8 ::1 100.64.0.0/10 10.0.0.0/8 192.168.0.0/16 172.16.0.0/12
    }
    handle @tailnet {
        reverse_proxy http://100.71.180.93:8796 {
            flush_interval -1
        }
    }
    handle {
        respond "not on tailnet" 403
    }
}
```

Then reload:
```bash
docker exec agent-memory-caddy-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
```

---

## Security considerations

- **Tailscale-only**: DNS points to 100.71.180.93, Caddy enforces `@tailnet` — public internet gets 403
- **Filesystem jail**: API locked to `/home/albert/`, symlink-aware, no traversal
- **Dotfiles hidden by default**: `.git`, `.env`, `.ssh`, `.secrets` not exposed unless explicit
- **Read-only**: no write/delete/rename — browse and view only
- **No auth needed**: Tailscale IS the auth layer (only Albert's devices)

---

## Risks & tradeoffs

| risk | mitigation |
|---|---|
| ryOS `bun run build` may fail (missing env vars, TS errors) | the project builds for production without optional env vars per AGENTS.md; fix any TS issues inline |
| Finder integration may be complex if deeply coupled to VFS | fallback: create a separate "Files" app instead of modifying Finder |
| Large directories (node_modules) may be slow to list | add pagination to API, skip node_modules by default, add lazy loading |
| ryOS upstream updates will conflict with our fork | we're adding new files + minimal patches to existing ones — rebase-friendly |

---

## Estimated effort

| phase | time |
|---|---|
| Phase 1: filesystem API | ~1h |
| Phase 2: Finder UI integration | ~3-4h |
| Phase 3: build + deploy | ~30min |
| **Total** | **~5h** |
