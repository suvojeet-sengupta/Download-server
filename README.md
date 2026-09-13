# SuvShare

Self-hosted file and folder sharing with password-protected uploads and public
download links. Node.js + Express, packaged as a single container.

- Password-gated web UI for uploading files and whole folders
- Public `/d/<id>` download links that need no login
- Chunked / resumable uploads for large files
- Server-side ZIP of folders with live progress
- URL shortener (`/s/<code>`)
- Optional Telegram notification on every upload

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

## Operations

```bash
docker compose logs -f            # follow logs
docker compose restart            # restart in place
docker compose up -d --build      # apply code changes
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
