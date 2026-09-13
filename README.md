# SuvShare

Self-hosted file and folder sharing with password-protected uploads and public
download links. TypeScript on Node 22 with Express 5, packaged as a single
container.

- Password-gated web UI for uploading files and whole folders
- Public `/d/<id>` download links that need no login
- Chunked / resumable uploads for large files
- Server-side ZIP of folders with live progress
- URL shortener (`/s/<code>`)
- Optional Telegram notification on every upload

## Interface

A file manager rather than an upload form: list and grid views, category
filters, search, sorting, multi-select with bulk actions, rename, drag-and-drop
upload with a live queue, and an in-place preview for images, video, audio, PDFs
and text.

The front end is dependency-free — no framework, no icon CDN, no web fonts. It
ships as three static files and uses the system typeface, so it renders
immediately and works offline once loaded. Layout adapts from a fixed sidebar on
desktop to a drawer and floating action button on phones, and it follows the
system light or dark preference.

| Shortcut | Action |
| --- | --- |
| `/` | Focus search |
| `Ctrl`/`Cmd` + `A` | Select everything in view |
| `Delete` | Delete the selection |
| `Esc` | Clear selection, close menus and previews |
| `←` `→` | Move between files while previewing |

## Deploy on a fresh VPS

Requires only Docker with the Compose plugin.

```bash
git clone https://github.com/suvojeet-sengupta/Download-server.git
cd Download-server
cp .env.example .env
nano .env                      # set PASSWORD - the only mandatory change
docker compose up -d --build
```

That is the whole install. `uploads/` and `data/` are created automatically on
first boot, so there is nothing to prepare on the host.

Verify it came up healthy:

```bash
docker compose ps             # STATUS should read "healthy"
curl localhost:3009/healthz   # {"status":"ok","items":0,...}
```

Then open `http://<server-ip>:3009` and log in with your `PASSWORD`.

### Behind a domain or tunnel

Set `PUBLIC_URL` in `.env` so generated share links use the public hostname
instead of the internal address, then recreate the container:

```bash
PUBLIC_URL=https://download.example.com
docker compose up -d
```

## Configuration

Every variable is documented inline in [`.env.example`](.env.example).
`PASSWORD` is the only required one; the rest have working defaults.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `PASSWORD` | **yes** | — | Single credential for UI, uploads, admin APIs |
| `PORT` | no | `3009` | Host and container listen port |
| `MAX_STORAGE_LIMIT_GB` | no | `20` | Upload capacity ceiling |
| `PUBLIC_URL` | no | request-derived | Base URL for generated share links |
| `TELEGRAM_BOT_TOKEN` | no | disabled | Upload alerts; needs the chat id too |
| `TELEGRAM_CHAT_ID` | no | disabled | Destination chat for alerts |
| `ZIP_COMPRESSION_LEVEL` | no | `1` | Folder ZIP level, `0`–`9` |

## HTTP API

Everything under `/api` requires the password, sent as an `x-password` header or
a `?password=` query parameter. Share and preview links are public.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/verify` | Check the password |
| `GET` | `/api/files` | List items with resolved links |
| `GET` | `/api/stats` | Usage totals and per-category counts |
| `POST` | `/api/upload` | Single-request upload |
| `POST` | `/api/folder/create` | Register a folder |
| `POST` | `/api/upload/init` | Open or resume a chunked session |
| `POST` | `/api/upload/chunk` | Send one chunk |
| `PATCH` | `/api/files/:id` | Rename |
| `POST` | `/api/files/delete` | Bulk delete |
| `DELETE` | `/api/files/:id` | Delete one |
| `GET`/`POST` | `/api/shorten` | List or create short links |
| `DELETE` | `/api/shorten/:code` | Remove a short link |
| `POST`/`GET` | `/api/zip/start\|status/:id` | Folder archive lifecycle |
| `GET` | `/d/:id[/name]` | Public download |
| `GET` | `/p/:id[/name]` | Public inline preview |
| `GET` | `/healthz` | Health probe |

## Persistent data

| Path | Contents |
| --- | --- |
| `./uploads/` | Every uploaded file and folder |
| `./data/db.json` | Index mapping share links to files on disk |

Back up **both together**. `uploads/` without `data/db.json` leaves the bytes on
disk while every share link returns 404.

### Moving to another server

```bash
rsync -av Download-server/ newhost:/root/Download-server/   # includes .env, uploads/, data/
ssh newhost 'cd /root/Download-server && docker compose up -d --build'
```

## Project layout

The server is organised by responsibility; nothing lives in a single top-level
file.

```
src/
  index.ts                  entrypoint: bootstrap, then listen
  app.ts                    Express app assembly (no port binding, so it is testable)
  config/
    env.ts                  typed configuration, fails fast on a missing PASSWORD
    paths.ts                persistent directory layout
  types/domain.ts           StoredFile / StoredFolder / ShortLink / UploadMeta
  db/database.ts            atomic index read+write, legacy migration, self-heal
  middleware/
    authenticate.ts         shared-password guard
    error-handler.ts        terminal error handler, Multer aware
  services/
    storage.service.ts      capacity limits and disk cleanup
    upload.service.ts       Multer config, chunk sessions, resumable merge
    zip.service.ts          background folder archiving with progress
    shortlink.service.ts    code generation and click accounting
    telegram.service.ts     optional upload alerts
  routes/                   one router per concern, aggregated in routes/index.ts
  views/folder-page.ts      public folder landing page
  utils/                    formatting, id generation, URL helpers
```

`StoredItem` is a discriminated union on `type`, so a folder can never be
handled as a file by accident.

## Development

```bash
npm install
npm run dev          # watch mode against src/, reads .env
npm run typecheck    # tsc --noEmit, strict
npm run build        # emit dist/
npm start            # run the compiled server
```

TypeScript runs in `strict` mode with `noUncheckedIndexedAccess`. The Docker
build compiles in a builder stage and ships only `dist/` plus production
dependencies.

## Operations

```bash
docker compose logs -f            # follow logs
docker compose restart            # restart in place
docker compose up -d --build      # rebuild and apply code changes
curl localhost:3009/healthz       # health probe used by the container
```

`/healthz` checks that the database is readable and that `data/` and `uploads/`
are writable, so a broken mount reports `unhealthy` instead of failing silently.

### Self-healing on start

- A legacy root-level `db.json` **file** is migrated into `data/` automatically.
- If the index is empty but `uploads/` still holds upload directories, those
  entries are rebuilt from disk so existing share links keep working. This runs
  only while the index is empty, so it can never duplicate live records.

## Notes

- Uploads and management require the password. Download links are public by
  design — treat a `/d/<id>` URL as a secret.
- The image ships no default password. The server exits immediately if
  `PASSWORD` is unset, which prevents a shared image from booting with a known
  credential.
- Compose bind mounts are directories only. Bind mounting a single file such as
  `db.json` breaks on a fresh host, because Docker creates the missing mount
  source as a directory and every read then fails with `EISDIR`.
- Folder member downloads resolve inside the share directory only; a path that
  escapes it is rejected rather than served.
- Express 5 uses path-to-regexp v8, so the download catch-all is written as
  `/d/:id/*splat` and the captured segments arrive as an array.
