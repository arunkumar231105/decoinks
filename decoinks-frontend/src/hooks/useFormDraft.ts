import { useEffect, useRef, useState } from 'react'

// Form draft persistence ("draft autosave" / rehydration).
//
// Keeps a form's in-progress values in localStorage so a page refresh, hard
// refresh, or redeploy does not wipe what the user was typing. On mount the
// saved draft is restored; while typing it is autosaved (debounced); on a
// successful submit the caller clears it.
//
// Safety:
//  - Version-tolerant: restore() receives whatever was saved; the form only
//    reads the keys it knows, so a changed form shape after a redeploy can't
//    crash (unknown keys are ignored, missing keys keep their defaults).
//  - Scoped keys (e.g. "new-customer", "edit-order:<id>") keep one entity's
//    draft from bleeding into another.
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
    const id = setTimeout(() => {
      try { localStorage.setItem(storageKey, JSON.stringify(values)) } catch { /* quota — ignore */ }
    }, 500)
    return () => clearTimeout(id)
  }, [values, storageKey, enabled])

  const clearDraft = () => {
    try { localStorage.removeItem(storageKey) } catch { /* ignore */ }
    setRestored(false)
  }

  return { restored, clearDraft }
}
