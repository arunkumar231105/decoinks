/**
 * Standardized toast utilities.
 *
 * Drop-in replacement for `react-hot-toast`:
 *   - toast.success / toast.error / toast.warning / toast.info / toast.promise
 *     all work exactly as before.
 *   - toast.error(message, details) renders bullet points below the message.
 *   - toast.apiError(err)  - parse any API / Axios error and show appropriate toast.
 *
 * Import this file instead of 'react-hot-toast'.
 */

import {
  toast as _toast,
  type ToastOptions,
  type DefaultToastOptions,
} from 'react-hot-toast'
import { createElement as h } from 'react'
import { parseApiError } from './apiErrorParser'

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const BASE: ToastOptions = { duration: 4000 }

function errorContent(message: string, details: string[]) {
  if (details.length === 0) return message
  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
    h('span', null, message),
    h(
      'ul',
      { style: { margin: '4px 0 0 12px', padding: 0, fontSize: 12, lineHeight: 1.5, listStyleType: 'disc' } },
      ...details.map((d, i) => h('li', { key: i }, d))
    )
  )
}

// â”€â”€ Public API (mirrors react-hot-toast) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function success(message: string, opts?: ToastOptions) {
  return _toast.success(message, { ...BASE, ...opts })
}

function error(message: string, details: string[] = [], opts?: ToastOptions) {
  return _toast.error(errorContent(message, details) as any, {
    ...BASE,
    duration: details.length > 0 ? 6000 : 4000,
    ...opts,
  })
}

function warning(message: string, opts?: ToastOptions) {
  return _toast(message, {
    ...BASE,
    icon: 'âš ï¸',
    style: { background: '#fffbeb', color: '#92400e', borderLeft: '4px solid #f59e0b' },
    ...opts,
  })
}

function info(message: string, opts?: ToastOptions) {
  return _toast(message, {
    ...BASE,
    icon: 'â„¹ï¸',
    style: { background: '#eff6ff', color: '#1e40af', borderLeft: '4px solid #3b82f6' },
    ...opts,
  })
}

function promise<T>(
  p: Promise<T>,
  msgs: { loading: string; success: string; error: string | ((err: unknown) => string) },
  opts?: DefaultToastOptions
) {
  return _toast.promise(p, msgs, { ...opts })
}

/** Parse any Axios / API error and show an appropriate error toast. */
function apiError(err: unknown, opts?: ToastOptions) {
  const { message, details } = parseApiError(err)
  console.error('[API Error]', err)
  return error(message, details, opts)
}

// â”€â”€ Named exports + default export object â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const toast = {
  success,
  error,
  warning,
  info,
  promise,
  apiError,
  // Pass-throughs for less common react-hot-toast methods used in the codebase
  dismiss: _toast.dismiss,
  loading: _toast.loading,
  remove:  _toast.remove,
  custom:  _toast.custom,
}

export default toast
