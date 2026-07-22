// ── Nextcloud connectivity layer ────────────────────────────────────────────
//
// A robust WebDAV client for the shop's self-hosted Nextcloud. Uses Node 20's
// built-in fetch (undici) — connection pooling / keep-alive are automatic, so
// no extra dependency is needed. Every request runs through `ncRequest`, which
// adds Basic auth, a hard timeout, and retry-with-backoff on transient errors.
//
// Config comes entirely from env so credentials never touch the codebase:
//   NEXTCLOUD_URL            e.g. https://cloud.decoinks.com  (or http://76.13.124.5)
//   NEXTCLOUD_USER           bot username (a dedicated app account, not a person)
//   NEXTCLOUD_APP_PASSWORD   app password from Settings → Security → App password
//   NEXTCLOUD_WATCH_FOLDERS  comma-separated folder paths to sync (relative to the
//                            bot user's root), e.g. "Leads 2.0,Decoinks_graphics"
//   NEXTCLOUD_WEBHOOK_SECRET shared secret the webhook caller must present
//   NEXTCLOUD_TIMEOUT_MS     per-request timeout (default 15000)
//   NEXTCLOUD_RETRIES        transient-error retries (default 2)

const logger = require('../utils/logger')

function getConfig() {
  const rawUrl = (process.env.NEXTCLOUD_URL || '').trim().replace(/\/+$/, '')
  const user = (process.env.NEXTCLOUD_USER || '').trim()
  const appPassword = (process.env.NEXTCLOUD_APP_PASSWORD || '').trim()
  const configured = Boolean(rawUrl && user && appPassword)

  return {
    configured,
    baseUrl: rawUrl,
    user,
    appPassword,
    // Per-user WebDAV root — every file path is resolved under this.
    davRoot: configured ? `${rawUrl}/remote.php/dav/files/${encodeURIComponent(user)}` : '',
    watchFolders: (process.env.NEXTCLOUD_WATCH_FOLDERS || '')
      .split(',').map(f => f.trim().replace(/^\/+|\/+$/g, '')).filter(Boolean),
    webhookSecret: (process.env.NEXTCLOUD_WEBHOOK_SECRET || '').trim(),
    timeoutMs: Math.max(3000, Number(process.env.NEXTCLOUD_TIMEOUT_MS) || 15000),
    retries: Math.max(0, Number(process.env.NEXTCLOUD_RETRIES ?? 2)),
    insecureTls: process.env.NEXTCLOUD_INSECURE_TLS === 'true',
  }
}

function authHeader(cfg) {
  return 'Basic ' + Buffer.from(`${cfg.user}:${cfg.appPassword}`).toString('base64')
}

// Encode each path segment but keep the slashes, so "Leads 2.0/a b.png"
// becomes "Leads%202.0/a%20b.png".
function encodePath(relPath) {
  return String(relPath || '')
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .map(encodeURIComponent)
    .join('/')
}

function davUrl(cfg, relPath) {
  const enc = encodePath(relPath)
  return enc ? `${cfg.davRoot}/${enc}` : cfg.davRoot
}

class NextcloudError extends Error {
  constructor(message, statusCode = 502, cause) {
    super(message)
    this.name = 'NextcloudError'
    this.statusCode = statusCode
    if (cause) this.cause = cause
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

// Core request wrapper: Basic auth + timeout + retry/backoff on transient
// failures (network errors, 429, 5xx). Auth/permission errors (401/403/404)
// fail fast — retrying them is pointless.
async function ncRequest(cfg, method, url, { headers = {}, body, raw = false } = {}) {
  if (!cfg.configured) {
    throw new NextcloudError('Nextcloud is not configured on the server', 503)
  }

  let lastErr
  for (let attempt = 0; attempt <= cfg.retries; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs)
    try {
      const res = await fetch(url, {
        method,
        headers: { Authorization: authHeader(cfg), ...headers },
        body,
        signal: controller.signal,
        redirect: 'follow',
      })
      clearTimeout(timer)

      if (res.status === 401) throw new NextcloudError('Nextcloud auth failed — check the app password', 401)
      if (res.status === 403) throw new NextcloudError('Nextcloud denied access — the bot user needs share access to this folder', 403)
      if (res.status === 404) throw new NextcloudError('Path not found in Nextcloud', 404)

      // Retry on rate-limit / server errors
      if (res.status === 429 || res.status >= 500) {
        lastErr = new NextcloudError(`Nextcloud returned ${res.status}`, 502)
        if (attempt < cfg.retries) { await sleep(300 * (attempt + 1)); continue }
        throw lastErr
      }

      return raw ? res : { status: res.status, text: await res.text() }
    } catch (err) {
      clearTimeout(timer)
      if (err instanceof NextcloudError && err.statusCode < 500) throw err // don't retry auth/not-found
      lastErr = err.name === 'AbortError'
        ? new NextcloudError('Nextcloud request timed out', 504, err)
        : new NextcloudError(`Nextcloud request failed: ${err.message}`, 502, err)
      if (attempt < cfg.retries) { await sleep(300 * (attempt + 1)); continue }
      throw lastErr
    }
  }
  throw lastErr || new NextcloudError('Nextcloud request failed', 502)
}

module.exports = { getConfig, authHeader, encodePath, davUrl, ncRequest, NextcloudError }
