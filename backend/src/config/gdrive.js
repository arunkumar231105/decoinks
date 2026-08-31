// ── Google Drive connectivity layer ─────────────────────────────────────────
//
// Read-only access to the Drive that holds the shop's per-customer artwork
// folders (`DECOINKS_ORDERS/<customer>/…`). Used by the order screen's artwork
// picker: list folders, show thumbnails, and copy the picture a user drops
// onto an order line. Nothing here ever writes to Drive.
//
// There are two ways in, and the server picks whichever is configured:
//
//   rclone  — the machine already holds an authorised rclone "gdrive" remote
//             (the one the artwork copy scripts use). `rclone rcd` exposes it
//             over a local HTTP API, and the backend talks to that. No Google
//             Cloud project of our own is needed.
//   api     — a Google OAuth client of our own plus a refresh token, used
//             directly through googleapis. Preferred once the shop creates its
//             own client id, because rclone's shared client is being retired.
//
// Config comes entirely from env so credentials never touch the codebase:
//   GOOGLE_DRIVE_RCLONE_URL      e.g. http://172.18.0.1:5572   (rclone mode)
//   GOOGLE_DRIVE_RCLONE_USER     --rc-user, if the daemon requires auth
//   GOOGLE_DRIVE_RCLONE_PASS     --rc-pass
//   GOOGLE_DRIVE_RCLONE_REMOTE   remote name, default "gdrive:"
//   GOOGLE_DRIVE_CLIENT_ID       OAuth client id                 (api mode)
//   GOOGLE_DRIVE_CLIENT_SECRET   OAuth client secret
//   GOOGLE_DRIVE_REFRESH_TOKEN   refresh token for the owning account
//   GOOGLE_DRIVE_ROOT_FOLDER     top folder name, default "DECOINKS_ORDERS"
//   GOOGLE_DRIVE_ROOT_FOLDER_ID  optional, api mode only — skips a name lookup
//   GOOGLE_DRIVE_TIMEOUT_MS      per-request timeout (default 30000)

function getConfig() {
  const rcloneUrl = (process.env.GOOGLE_DRIVE_RCLONE_URL || '').trim().replace(/\/+$/, '')
  const clientId = (process.env.GOOGLE_DRIVE_CLIENT_ID || '').trim()
  const clientSecret = (process.env.GOOGLE_DRIVE_CLIENT_SECRET || '').trim()
  const refreshToken = (process.env.GOOGLE_DRIVE_REFRESH_TOKEN || '').trim()
  const apiReady = Boolean(clientId && clientSecret && refreshToken)

  return {
    // rclone wins when both are present: it is the credential the shop's Drive
    // tooling already runs on, so it is the one known to be live.
    mode: rcloneUrl ? 'rclone' : (apiReady ? 'api' : 'none'),
    configured: Boolean(rcloneUrl || apiReady),
    rcloneUrl,
    rcloneUser: (process.env.GOOGLE_DRIVE_RCLONE_USER || '').trim(),
    rclonePass: (process.env.GOOGLE_DRIVE_RCLONE_PASS || '').trim(),
    rcloneRemote: (process.env.GOOGLE_DRIVE_RCLONE_REMOTE || 'gdrive:').trim(),
    clientId,
    clientSecret,
    refreshToken,
    rootFolderName: (process.env.GOOGLE_DRIVE_ROOT_FOLDER || 'DECOINKS_ORDERS').trim().replace(/^\/+|\/+$/g, ''),
    rootFolderId: (process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || '').trim(),
    timeoutMs: Math.max(5000, Number(process.env.GOOGLE_DRIVE_TIMEOUT_MS) || 30000),
  }
}

class DriveError extends Error {
  constructor(message, statusCode = 502, cause) {
    super(message)
    this.name = 'DriveError'
    this.statusCode = statusCode
    if (cause) this.cause = cause
  }
}

// Google's SDK reports failures as GaxiosError; rclone answers with a JSON
// body carrying an error string. Both reduce to this, keeping the status where
// it is meaningful so a missing folder stays a 404 and a dead token stays a
// 401 instead of a blanket 500 that hides which of the two happened.
function toDriveError(err, what = 'Google Drive request failed') {
  if (err instanceof DriveError) return err
  const status = err?.response?.status || err?.code
  if (status === 401 || /invalid_grant|token expired/i.test(err?.message || '')) {
    return new DriveError('Google Drive auth failed — the stored token is invalid or revoked', 401, err)
  }
  if (status === 403) return new DriveError('Google Drive denied access to this file or folder', 403, err)
  if (status === 404) return new DriveError('Not found in Google Drive', 404, err)
  return new DriveError(`${what}: ${err?.message || 'unknown error'}`, 502, err)
}

module.exports = { getConfig, DriveError, toDriveError }
