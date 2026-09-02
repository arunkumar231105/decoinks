import toast from './toast'

/**
 * What to say after a bulk delete.
 *
 * The endpoint deletes what it can and reports the rest: `{ deleted, errors }`,
 * where each error names a row and why it was refused — usually because
 * something downstream was built from it and removing it would break the chain.
 *
 * The lists used to read `deleted` and nothing else, so a request that was
 * refused on every row appeared as a green "0 records permanently deleted" and
 * the reason was never shown. Nor is "permanently" true any more: a deleted
 * document is hidden from the lists, not destroyed.
 */

type BulkDeleteData = { deleted?: number; errors?: Array<{ id?: string; message?: string }> }

export function reportBulkDelete(data: BulkDeleteData | undefined, noun: string) {
  const deleted = data?.deleted ?? 0
  const refused = (data?.errors ?? []).map(e => e?.message).filter(Boolean) as string[]
  const many = (n: number) => `${n} ${noun}${n === 1 ? '' : 's'}`

  // The same reason repeated for twenty rows is one thing worth reading once.
  const reasons = [...new Set(refused)]
  const shown = reasons.slice(0, 3)
  if (reasons.length > shown.length) shown.push(`… and ${reasons.length - shown.length} more`)

  if (deleted > 0 && refused.length === 0) {
    toast.success(`${many(deleted)} removed`)
  } else if (deleted > 0) {
    toast.warning(`${many(deleted)} removed, ${refused.length} could not be`)
    toast.error('Not removed:', shown)
  } else if (refused.length > 0) {
    toast.error(`Nothing was removed — ${many(refused.length)} could not be:`, shown)
  } else {
    toast.error(`Nothing was removed.`)
  }
  return deleted
}

/** The wording on the confirm, so every list asks the same honest question. */
export function confirmBulkDelete(count: number, noun: string) {
  const what = `${count} ${noun}${count === 1 ? '' : 's'}`
  return window.confirm(
    `Delete ${what}? They will be removed from the lists. ` +
    `Anything still in use — an invoice raised from a quote, an order behind a purchase order — will be refused and named.`)
}
