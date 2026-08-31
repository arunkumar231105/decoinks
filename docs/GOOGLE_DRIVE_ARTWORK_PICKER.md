# Google Drive artwork picker (order screen)

The New Order screen can show the customer's own artwork folder from Google
Drive and let a picture be dragged straight onto an order line, instead of
downloading it from Drive and uploading it again by hand.

Drive tree the picker reads:

```
DECOINKS_ORDERS/
  <Customer Name>/
    _Artworks/          every artwork ever sent for that customer
    order1_280426/      per-order folders (orderN_ddmmyy)
```

## What happens on a drop

Dropping a tile does **not** link to the Drive file. The server copies the
bytes into the CRM's own MinIO storage and answers with the same
`{ url, dimensions }` body a desktop upload does — so the order keeps a stable
URL of its own, the artwork size is detected exactly as before, and the order
survives the Drive file being moved, renamed, or unshared later.

Only formats sharp can decode are offered (JPG, PNG, WEBP, GIF, TIFF, SVG,
AVIF). PSD/AI/PDF files sitting in the same folders are skipped, because they
cannot become an order-line thumbnail.

## API

All routes are staff-only (`verifyToken`) and read-only against Drive.

| Route | Purpose |
|---|---|
| `GET  /api/drive/status` | connection health; reports which mode is in use |
| `GET  /api/drive/customers?search=` | folders under `DECOINKS_ORDERS` |
| `GET  /api/drive/files?customer=&folder_id=&folder=&search=&limit=` | one customer's pictures + folder tabs |
| `GET  /api/drive/thumb?id=&w=` | proxied preview (no Drive token reaches the browser) |
| `GET  /api/drive/download?id=` | proxied file bytes |
| `POST /api/drive/attach {file_id}` | copy the picture into CRM storage → `{ url, dimensions }` |
| `POST /api/drive/refresh` | drop the listing cache (listings are memoised for 3 minutes) |

## Two ways to reach Drive

`src/config/gdrive.js` picks whichever is configured; rclone wins if both are.

### 1. rclone bridge (what the server runs today)

The machine already holds an authorised rclone `gdrive` remote — the one the
artwork copy scripts use. `rclone rcd` exposes it on a local port and the
backend talks to that. No Google Cloud project of our own is needed.

`/etc/systemd/system/rclone-drive-bridge.service`:

```ini
[Unit]
Description=rclone remote-control bridge for the CRM Drive artwork picker
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
# Bound to the decoinks_net gateway so only containers on that network (and the
# host) can reach it — never 0.0.0.0. --rc-serve adds the object-bytes route
# the thumbnail and attach endpoints read.
ExecStart=/usr/local/bin/rclone rcd \
  --rc-addr 172.23.0.1:5572 \
  --rc-user decoinks --rc-pass CHANGE_ME \
  --rc-serve \
  --config /root/.config/rclone/rclone.conf
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

`backend/.env`:

```
GOOGLE_DRIVE_RCLONE_URL=http://172.23.0.1:5572
GOOGLE_DRIVE_RCLONE_USER=decoinks
GOOGLE_DRIVE_RCLONE_PASS=CHANGE_ME
GOOGLE_DRIVE_ROOT_FOLDER=DECOINKS_ORDERS
```

`172.23.0.1` is the `decoinks_decoinks_net` gateway. If that network is ever
recreated with a different subnet, re-check it with
`docker network inspect decoinks_decoinks_net` and update both files.

**Known limit:** the rclone remote authenticates with rclone's *shared* Google
client id, which rclone warns is being retired during 2026. When it stops
working, switch to mode 2 below — no application code changes.

### 2. Google Drive API (preferred once the shop has its own OAuth client)

Create an OAuth client (Desktop app) in Google Cloud Console, authorise the
account that owns `DECOINKS_ORDERS`, and set:

```
GOOGLE_DRIVE_CLIENT_ID=…
GOOGLE_DRIVE_CLIENT_SECRET=…
GOOGLE_DRIVE_REFRESH_TOKEN=…
GOOGLE_DRIVE_ROOT_FOLDER=DECOINKS_ORDERS
```

Leave `GOOGLE_DRIVE_RCLONE_URL` unset. This mode also serves Google's own
thumbnails, which is faster than resizing a 30 MB original on request.

## Cost and caching

- A customer's file list is one recursive listing, memoised for 3 minutes;
  searching and folder tabs are filtered in memory and cost nothing.
- Tiles fetch their preview only when scrolled into view.
- In rclone mode a preview means pulling the original and resizing it — about
  4 s for a 31 MB PNG, then cached in memory (300 previews).
- Files over 80 MB are not previewed at all; the tile shows a file badge and
  the picture can still be dropped.
