import type { AxiosError } from 'axios'

export interface ParsedApiError {
  message: string
  details: string[]
}

interface BackendErrorBody {
  error?:   string
  message?: string
  details?: Array<{ field?: string; message: string } | string>
}

/**
 * Converts any thrown value (Axios error, plain Error, unknown) into a
 * structured { message, details } object.  Never returns a raw object or
 * the string "[object Object]".
 *
 * Status-code semantics:
 *   Network / no response  → "Cannot reach server — check your connection"
 *   422 with details array → "Validation failed" + bullet list
 *   5xx                    → "Something went wrong on our side, please try again"
 *   4xx with text          → the backend's error/message string
 *   anything else          → "An unexpected error occurred"
 */
export function parseApiError(err: unknown): ParsedApiError {
  const axErr = err as AxiosError<BackendErrorBody>

  // ── Network error (no HTTP response) ──────────────────────────────────────
  if (axErr.isAxiosError && !axErr.response) {
    return { message: 'Cannot reach server — check your internet connection', details: [] }
  }

  const status = axErr?.response?.status
  const data   = axErr?.response?.data

  // ── Server error ───────────────────────────────────────────────────────────
  if (status !== undefined && status >= 500) {
    return { message: 'Something went wrong on our side, please try again', details: [] }
  }

  // ── 422 Validation — array of field errors (Zod / backend details) ─────────
  if (status === 422 && Array.isArray(data?.details) && data.details.length > 0) {
    const details = (data.details as Array<{ field?: string; message: string } | string>).map(
      (d) => {
        if (typeof d === 'string') return d
        return d.field ? `${d.field}: ${d.message}` : d.message
      }
    )
    const headline = typeof data?.error === 'string' ? data.error : 'Validation failed'
    return { message: headline, details }
  }

  // ── 4xx client error with backend message ──────────────────────────────────
  if (data) {
    const text =
      (typeof data.error   === 'string' && data.error.trim())   ||
      (typeof data.message === 'string' && data.message.trim()) ||
      null

    if (text) return { message: text, details: [] }
  }

  // ── Plain Error (non-Axios) ────────────────────────────────────────────────
  const plainMsg = (err as Error)?.message
  if (typeof plainMsg === 'string' && plainMsg && plainMsg !== '[object Object]') {
    return { message: plainMsg, details: [] }
  }

  return { message: 'An unexpected error occurred', details: [] }
}
