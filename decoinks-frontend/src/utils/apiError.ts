import { parseApiError } from './apiErrorParser'

export type { ParsedApiError } from './apiErrorParser'

/**
 * Extracts a human-readable string from any API error.
 * If the response has a `details` array (Zod 422), joins them as bullet lines.
 * Never returns `[object Object]` or a raw JSON blob.
 */
export function getApiError(err: unknown): string {
  const { message, details } = parseApiError(err)
  if (details.length > 0) return `${message}\n${details.map(d => `• ${d}`).join('\n')}`
  return message
}

/**
 * Returns the raw details array for inline field-level errors, or [].
 */
export function getApiErrorDetails(err: unknown): Array<{ field?: string; message: string }> {
  const axErr = err as { response?: { data?: { details?: Array<{ field?: string; message: string }> } } }
  return axErr?.response?.data?.details ?? []
}
