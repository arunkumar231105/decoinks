import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Search, ChevronLeft, ChevronRight } from 'lucide-react'
import api from '../services/api'
import { cn } from '../utils/cn'

const STATUS_BADGE: Record<string, string> = {
  Draft:               'bg-gray-100 text-gray-600',
  'Pending Approval':  'bg-yellow-50 text-yellow-700',
  Approved:            'bg-green-50 text-green-700',
  Sent:                'bg-blue-50 text-blue-700',
  Accepted:            'bg-teal-50 text-teal-700',
  'In Production':     'bg-blue-100 text-blue-800',
  'Partially Received':'bg-orange-50 text-orange-700',
  Shipped:             'bg-purple-50 text-purple-700',
  Received:            'bg-green-50 text-green-800',
  Closed:              'bg-gray-200 text-gray-700',
  Cancelled:           'bg-red-50 text-red-700',
}

export default function PurchaseOrdersPage() {
  const navigate            = useNavigate()
  const { t, i18n }         = useTranslation()
  const [page, setPage]     = useState(1)
  const [search, setSearch] = useState('')

  const locale = i18n.language === 'zh' ? 'zh-CN' : 'en-US'

  const { data, isLoading } = useQuery({
    queryKey: ['purchase-orders', page, search],
    queryFn: () =>
      api.get('/purchase-orders', { params: { page, limit: 10, ...(search ? { search } : {}) } })
        .then((r) => r.data),
    placeholderData: (prev) => prev,
  })

  const pos   = data?.purchaseOrders ?? []
  const total = data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / 10))

  const fmt = (d: string | null) =>
    d ? new Date(d).toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">{t('po.title')}</h2>
        <p className="text-sm text-gray-500 mt-1">{t('po.subtitle')}</p>
      </div>

      {/* Search */}
      <div className="card">
        <div className="relative max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            placeholder={t('po.searchPlaceholder')}
            className="input pl-8"
          />
        </div>
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                {['#', t('po.number'), t('po.orderId'), t('po.issueDate'), t('po.dueDate'), t('common.status'), t('common.total')].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={7} className="text-center py-12 text-gray-400">{t('common.loading')}</td></tr>
              ) : pos.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-12 text-gray-400">{t('common.noData')}</td></tr>
              ) : (
                pos.map((po: {
                  id: string; po_number: string; order_id: string | null
                  issue_date: string; due_date: string | null; status: string; total: number
                }, idx: number) => (
                  <tr
                    key={po.id}
                    onClick={() => navigate(`/purchase-orders/${po.id}`)}
                    className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer"
                  >
                    <td className="px-4 py-3 text-sm text-gray-500">{(page - 1) * 10 + idx + 1}</td>
                    <td className="px-4 py-3 text-sm font-medium text-accent">{po.po_number}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{po.order_id ?? '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{fmt(po.issue_date)}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{fmt(po.due_date)}</td>
                    <td className="px-4 py-3">
                      <span className={cn('badge', STATUS_BADGE[po.status] ?? 'bg-gray-100 text-gray-600')}>
                        {t(`status.${po.status}`, po.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">
                      {po.total != null
                        ? po.total.toLocaleString(locale, { style: 'currency', currency: 'USD' })
                        : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 flex items-center justify-between border-t border-gray-100">
          <p className="text-sm text-gray-500">
            {t('common.showing', {
              from: Math.min((page - 1) * 10 + 1, total),
              to:   Math.min(page * 10, total),
              count: total,
            })}
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="p-1.5 rounded text-gray-400 hover:text-gray-700 disabled:opacity-30"
            >
              <ChevronLeft size={16} />
            </button>
            {Array.from({ length: Math.min(5, pages) }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                onClick={() => setPage(p)}
                className={cn('w-8 h-8 rounded text-sm font-medium', page === p ? 'bg-accent text-white' : 'text-gray-600 hover:bg-gray-100')}
              >
                {p}
              </button>
            ))}
            <button
              onClick={() => setPage((p) => Math.min(pages, p + 1))}
              disabled={page === pages}
              className="p-1.5 rounded text-gray-400 hover:text-gray-700 disabled:opacity-30"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
