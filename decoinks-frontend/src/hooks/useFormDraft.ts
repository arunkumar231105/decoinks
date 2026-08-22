import { useEffect, useRef, useState } from 'react'

// Form draft persistence ("draft autosave" / rehydration).
//
// Keeps a form's in-progress values in localStorage so a page refresh, hard
// refresh, or redeploy does not wipe what the user was typing or the artwork
// they already uploaded. On mount the saved draft is restored; while editing it
// is autosaved; on a successful submit the caller clears it.
//
// Safety:
//  - Flushed immediately on pagehide / visibilitychange / beforeunload, so a
//    refresh right after a change (e.g. an artwork upload) still keeps it —
//    the debounce can never "lose the last edit".
//  - Version-tolerant: restore() receives whatever was saved; the form only
//    reads the keys it knows, so a changed form shape after a redeploy can't
//    crash (unknown keys are ignored, missing keys keep their defaults).
//  - Scoped keys (e.g. "quotation:new") keep one form's draft out of another.
//  - `enabled` lets callers turn it off (e.g. only persist create mode).

const PREFIX = 'decoinks:draft:'

export function useFormDraft<T extends Record<string, unknown>>(
  key: string,
  values: T,
  restore: (saved: Partial<T>) => void,
  options: { enabled?: boolean } = {},
) {
  const enabled = options.enabled ?? true
  const storageKey = PREFIX + key
  const [restored, setRestored] = useState(false)
  const hydrated = useRef(false)
  // Set once the draft has been deliberately thrown away — by Discard, or by a
  // successful save. Every write is gated on it, because the teardown flush
  // below runs *after* clearDraft and would otherwise put the draft straight
  // back: Discard removed the key, beforeunload rewrote it, the reload restored
  // it, and the button looked broken. The same rewrite happened on save, so the
  // next new form came up holding the record that had just been saved.
  const discarded = useRef(false)
  const latest = useRef(values)
  latest.current = values

  const write = () => {
    if (discarded.current) return
    try { localStorage.setItem(storageKey, JSON.stringify(latest.current)) } catch { /* quota — ignore */ }
  }

  // Restore once, on first mount.
  useEffect(() => {
    if (!enabled || hydrated.current) return
    hydrated.current = true
    try {
      const raw = localStorage.getItem(storageKey)
      if (!raw) return
      const saved = JSON.parse(raw)
      if (saved && typeof saved === 'object' && Object.keys(saved).length > 0) {
        restore(saved as Partial<T>)
        setRestored(true)
      }
    } catch {
      // Corrupt/incompatible draft — drop it silently.
      try { localStorage.removeItem(storageKey) } catch { /* ignore */ }
    }
    // restore is intentionally excluded so this runs exactly once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, enabled])

  // Autosave (debounced) once hydrated.
  useEffect(() => {
    if (!enabled || !hydrated.current) return
    const id = setTimeout(write, 300)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, storageKey, enabled])

  // Flush synchronously when the page is being hidden, refreshed or closed, so
  // a change made moments earlier is never lost to the debounce window.
  useEffect(() => {
    if (!enabled) return
    const flush = () => { if (hydrated.current) write() }
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush() }
    window.addEventListener('beforeunload', flush)
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('beforeunload', flush)
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibility)
      flush()   // also persist when navigating away within the app
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, enabled])

  const clearDraft = () => {
    discarded.current = true
    try { localStorage.removeItem(storageKey) } catch { /* ignore */ }
    setRestored(false)
  }

  return { restored, clearDraft }
}
