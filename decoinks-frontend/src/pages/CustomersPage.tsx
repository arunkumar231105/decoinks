import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Avatar } from '@mui/material'
import { Divider as MuiDivider, Menu, MenuItem } from '@mui/material'
import {
  ChevronLeft,
  ChevronRight,
  Filter,
  MoreHorizontal,
  Plus,
  Search,
} from 'lucide-react'
import toast from '../utils/toast'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { cn } from '../utils/cn'
import { api } from '../services/api'

interface Customer {
  id: string
  name: string
  company: string | null
  email: string | null
  phone: string | null
  city: string | null
  state: string | null
  status: 'Active' | 'Inactive' | 'Blocked'
  quotes_count: number
}

function initials(name: string) {
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
}

const AVATAR_COLORS = ['#0D9488','#2563EB','#7C3AED','#F59E0B','#EF4444','#10B981','#6366F1','#EC4899','#F97316','#0891B2','#16A34A','#9333EA']

function avatarColor(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

const PAGE_SIZE = 10

type StatusFilter = 'All' | 'Active' | 'Inactive' | 'Blocked'

function statusBadgeClass(status: string) {
  if (status === 'Active') return 'cust-status-active'
  if (status === 'Blocked') return 'cust-status-blocked'
  return 'cust-status-inactive'
}

export function CustomersPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All')
  const [menuAnchor, setMenuAnchor] = useState<{ el: HTMLElement; id: string } | null>(null)
  const [filterAnchor, setFilterAnchor] = useState<HTMLElement | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['customers', { page, search, statusFilter }],
    queryFn: async () => {
      const params: Record<string, unknown> = { page, limit: PAGE_SIZE }
      if (search) params.search = search
      if (statusFilter !== 'All') params.status = statusFilter
      return api.get('/customers', { params }).then(r => r.data.data)
    },
    placeholderData: keepPreviousData,
  })

  const customers: Customer[] = data?.rows ?? []
  const total: number = data?.total ?? 0
  const totalPages = Math.ceil(total / PAGE_SIZE)

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => api.put(`/customers/${id}`, { status: 'Inactive' }),
    onSuccess: () => {
      toast.success('Customer deactivated')
      queryClient.invalidateQueries({ queryKey: ['customers'] })
      setMenuAnchor(null)
    },
    onError: () => toast.error('Failed to deactivate customer'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/customers/${id}`),
    onSuccess: () => {
      toast.success('Customer deleted')
      queryClient.invalidateQueries({ queryKey: ['customers'] })
      setMenuAnchor(null)
    },
    onError: () => toast.error('Failed to delete customer'),
  })

  const handleSearch = (v: string) => { setSearch(v); setPage(1) }
  const handleStatusFilter = (sf: StatusFilter) => { setStatusFilter(sf); setPage(1); setFilterAnchor(null) }
  const handleDeactivate = (id: string) => deactivateMutation.mutate(id)

  return (
    <div className="cust-page">
      <div className="cust-page-header">
        <div>
          <h2 className="cust-page-title">Customers</h2>
          <p className="cust-page-sub">Manage customer accounts, contacts, and quotation history.</p>
        </div>
        <div className="cust-controls">
          <div className="cust-search">
            <Search size={14} />
            <input
              placeholder="Search by name, email or company..."
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
            />
          </div>
          <button
            className={cn('lb-action-btn', statusFilter !== 'All' && 'lb-action-btn-filtered')}
            onClick={(e) => setFilterAnchor(e.currentTarget)}
          >
            <Filter size={14} />
            {statusFilter === 'All' ? 'Filter' : statusFilter}
            <ChevronRight size={12} className="cust-filter-chevron" />
          </button>
          <button
            className="lb-action-btn lb-action-primary"
            onClick={() => navigate('/customers/new')}
          >
            <Plus size={14} /> New Customer
          </button>
        </div>
      </div>

      <div className="al-panel cust-table-wrap">
        <table className="cust-table">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Company</th>
              <th>Email</th>
              <th>Phone</th>
              <th>City</th>
              <th>Status</th>
              <th>Quotes</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={8} className="cust-empty-row">Loading...</td></tr>
            )}
            {!isLoading && customers.length === 0 && (
              <tr><td colSpan={8} className="cust-empty-row">No customers match your search.</td></tr>
            )}
            {!isLoading && customers.map((c) => (
              <tr key={c.id} className="cust-row" onClick={() => navigate(`/customers/${c.id}`)}>
                <td>
                  <div className="cust-name-cell">
                    <Avatar sx={{ width: 32, height: 32, fontSize: 12, bgcolor: avatarColor(c.id) }}>
                      {initials(c.name)}
                    </Avatar>
                    <span>{c.name}</span>
                  </div>
                </td>
                <td className="cust-muted">{c.company ?? '-'}</td>
                <td className="cust-muted">{c.email ?? '-'}</td>
                <td className="cust-muted">{c.phone ?? '-'}</td>
                <td>{c.city ?? '-'}</td>
                <td>
                  <span className={cn('cust-status-badge', statusBadgeClass(c.status))}>
                    {c.status}
                  </span>
                </td>
                <td className="cust-num">{c.quotes_count ?? 0}</td>
                <td onClick={(e) => e.stopPropagation()}>
                  <button className="lb-icon-btn" onClick={(e) => setMenuAnchor({ el: e.currentTarget, id: c.id })}>
                    <MoreHorizontal size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="cust-pagination">
          <span className="cust-pag-info">
            Showing {Math.min((page - 1) * PAGE_SIZE + 1, total)}-{Math.min(page * PAGE_SIZE, total)} of {total} customers
          </span>
          <div className="cust-pag-controls">
            <button className="lb-action-btn cust-pag-btn" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft size={14} />
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                className={cn('lb-action-btn cust-pag-btn', n === page && 'lb-action-primary')}
                onClick={() => setPage(n)}
              >
                {n}
              </button>
            ))}
            <button className="lb-action-btn cust-pag-btn" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      <Menu anchorEl={menuAnchor?.el} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
        <MenuItem onClick={() => { navigate(`/customers/${menuAnchor?.id}`); setMenuAnchor(null) }}>View Profile</MenuItem>
        <MenuItem onClick={() => { navigate(`/customers/${menuAnchor?.id}`); setMenuAnchor(null) }}>Edit Customer</MenuItem>
        <MenuItem onClick={() => { navigate('/quotes/new'); setMenuAnchor(null) }}>New Quotation</MenuItem>
        <MuiDivider />
        <MenuItem onClick={() => handleDeactivate(menuAnchor?.id ?? '')} sx={{ color: '#D97706' }}>Deactivate</MenuItem>
        <MenuItem onClick={() => { deleteMutation.mutate(menuAnchor?.id ?? ''); }} sx={{ color: '#DC2626' }}>Delete</MenuItem>
      </Menu>

      <Menu anchorEl={filterAnchor} open={Boolean(filterAnchor)} onClose={() => setFilterAnchor(null)}>
        {(['All', 'Active', 'Inactive', 'Blocked'] as const).map((s) => (
          <MenuItem key={s} selected={statusFilter === s} onClick={() => handleStatusFilter(s)}>
            {s}
          </MenuItem>
        ))}
      </Menu>
    </div>
  )
}
