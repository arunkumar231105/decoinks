import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, CheckCircle2, FileText, Receipt, Wallet } from 'lucide-react'
import { Layout } from '../components/Layout'
import { Badge, Pagination, StatCard, TableStates } from '../components/ui'
import { useResource } from '../hooks/useResource'
import { money, fmtDate } from '../services/api'
import { INVOICE_TONE, type InvoiceSummary } from '../services/payments'
import { cn } from '../utils/cn'

const COLUMNS = ['Invoice #', 'Order #', 'Issued', 'Due', 'Total', 'Paid', 'Balance', 'Status', '']

/**
 * Every invoice the customer is allowed to see, outstanding ones first.
 *
 * Drafts never appear — the server excludes them. A draft has not been
 * confirmed by staff, so its figures are not final, and showing one would tell
 * the customer a number that may still change.
 */
export default function InvoicesPage() {
  const navigate = useNavigate()
  const invoices = useResource<InvoiceSummary[]>('/invoices')

  const [filter, setFilter] = useState('All')
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState(10)

  const list = invoices.data ?? []

  const totals = useMemo(() => ({
    outstanding: list.filter(i => i.payable).reduce((sum, i) => sum + i.balanceDue, 0),
    dueCount: list.filter(i => i.payable).length,
    paidCount: list.filter(i => i.status === 'Paid').length,
    billed: list.reduce((sum, i) => sum + i.total, 0),
  }), [list])

  const filtered = useMemo(() => {
    if (filter === 'Outstanding') return list.filter(i => i.payable)
    if (filter === 'Paid') return list.filter(i => i.status === 'Paid')
    return list
  }, [list, filter])

  const pageCount = Math.max(1, Math.ceil(filtered.length / rows))
  const current = Math.min(page, pageCount)
  const visible = filtered.slice((current - 1) * rows, current * rows)

  return (
    <Layout title="Invoices" subtitle="View your invoices, download them, and pay online.">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          icon={Wallet}
          loading={invoices.loading}
          value={money(totals.outstanding)}
          label="Outstanding"
          hint={totals.dueCount === 1 ? '1 invoice due' : `${totals.dueCount} invoices due`}
          tone={totals.outstanding > 0 ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600'}
        />
        <StatCard icon={Receipt} loading={invoices.loading} value={money(totals.billed)} label="Total Billed" />
        <StatCard icon={CheckCircle2} loading={invoices.loading} value={totals.paidCount} label="Paid" tone="bg-emerald-50 text-emerald-600" />
        <StatCard icon={FileText} loading={invoices.loading} value={list.length} label="All Invoices" tone="bg-violet-50 text-violet-600" />
      </div>

      {totals.outstanding > 0 && (
        <div className="mt-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <AlertCircle size={19} className="mt-0.5 shrink-0 text-amber-600" />
          <div className="text-[13px] text-amber-900">
            <span className="font-semibold">You have {money(totals.outstanding)} outstanding.</span>{' '}
            Open an invoice below and choose <span className="font-semibold">Pay Now</span> to settle it by card.
          </div>
        </div>
      )}

      <div className="cp-card mt-4 p-4">
        <label className="block max-w-xs">
          <span className="cp-label">Show</span>
          <select className="cp-input" value={filter} onChange={e => { setFilter(e.target.value); setPage(1) }}>
            {['All', 'Outstanding', 'Paid'].map(v => <option key={v}>{v}</option>)}
          </select>
        </label>
      </div>

      <div className="cp-card mt-4 overflow-hidden">
        <div className="cp-table-wrap">
          <table className="w-full min-w-[860px] text-left">
            <thead>
              <tr>{COLUMNS.map(c => <th key={c} className="cp-th">{c}</th>)}</tr>
            </thead>
            <tbody>
              <TableStates
                colSpan={COLUMNS.length}
                loading={invoices.loading}
                error={invoices.error}
                empty={visible.length === 0}
                emptyMessage="Invoices appear here once our team has issued them."
                onRetry={invoices.reload}
              />
              {!invoices.loading && !invoices.error && visible.map(inv => (
                <tr
                  key={inv.id}
                  className="cp-row cursor-pointer"
                  onClick={() => navigate(`/invoices/${inv.id}`)}
                >
                  <td className="cp-td font-semibold text-ink">{inv.invoiceNumber}</td>
                  <td className="cp-td">{inv.orderNumber ?? '—'}</td>
                  <td className="cp-td">{fmtDate(inv.issueDate)}</td>
                  <td className="cp-td">{fmtDate(inv.dueDate)}</td>
                  <td className="cp-td tabular-nums">{money(inv.total)}</td>
                  <td className="cp-td tabular-nums">{money(inv.amountPaid)}</td>
                  <td className={cn('cp-td tabular-nums font-semibold',
                    inv.balanceDue > 0 ? 'text-amber-700' : 'text-ink')}>
                    {money(inv.balanceDue)}
                  </td>
                  <td className="cp-td"><Badge tone={INVOICE_TONE[inv.status]}>{inv.status}</Badge></td>
                  <td className="cp-td text-right">
                    <button
                      className={cn('cp-btn cp-btn-sm', inv.payable && 'cp-btn-primary')}
                      onClick={e => { e.stopPropagation(); navigate(`/invoices/${inv.id}`) }}
                    >
                      {inv.payable ? 'Pay Now' : 'View'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!invoices.loading && filtered.length > 0 && (
          <Pagination
            page={current}
            pageCount={pageCount}
            total={filtered.length}
            rows={rows}
            onPage={setPage}
            onRows={setRows}
          />
        )}
      </div>
    </Layout>
  )
}
