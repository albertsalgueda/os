# fileOS — AgentOS for Hermes / OpenClaw VMs

A web-based desktop environment designed as the OS interface for agent virtual machines. Browse, inspect, and manage files on your agent's VM through a familiar macOS-like UI.

> Fork of [ryOS](https://github.com/ryokun6/ryos) by Ryo Lu.

## What's different

- **Real filesystem browser** — Finder connects to the host VM filesystem via a local API, not a virtual file system
- **Read-only by design** — browse and view files, no accidental writes or deletes
- **Tailscale-only access** — locked to your private network, no public exposure
- **Stripped branding** — no ryOS references, no AI assistant, no app store, just the file browser
- **Zero config** — runs as a systemd service, no Redis or external dependencies required

## Quick start

```bash
git clone https://github.com/albertsalgueda/os.git
cd os
bun install
bun run build
PORT=8796 bun run start
```

Open `http://localhost:8796` — Finder opens directly to `/home/` on the host machine.

## Architecture

```
Browser (Finder UI)
   │
   └─ /api/local-fs/list?path=...   →  real fs.readdir + fs.stat
   └─ /api/local-fs/read?path=...   →  text file content
   └─ /api/local-fs/serve?path=...  →  binary files (images, PDFs, etc.)
```

- Filesystem API jailed to `/home/` — no traversal, no symlink escapes
- Dotfiles hidden by default (`.git`, `.env`, `.ssh`)
- Text files open in TextEdit, images preview inline, PDFs open in browser

## License

MIT — same as upstream ryOS.
