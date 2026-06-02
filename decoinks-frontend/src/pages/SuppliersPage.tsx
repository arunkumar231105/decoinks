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
  KeyRound,
} from 'lucide-react'
import toast from '../utils/toast'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { cn } from '../utils/cn'
import { api } from '../services/api'
import PortalAccessModal from '../components/PortalAccessModal'

interface Supplier {
  id: string
  name: string
  email: string
  phone: string
  city: string
  state: string
  orders_count: number
  total_spent: number
  status: 'Active' | 'Inactive'
  has_portal_access?: boolean
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

export function SuppliersPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState<'All' | 'Active' | 'Inactive'>('All')
  const [menuAnchor, setMenuAnchor] = useState<{ el: HTMLElement; id: string } | null>(null)
  const [filterAnchor, setFilterAnchor] = useState<HTMLElement | null>(null)
  const [portalModal, setPortalModal] = useState<{ id: string; name: string } | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['suppliers', { page, search, statusFilter }],
    queryFn: async () => {
      const params: Record<string, any> = { page, limit: PAGE_SIZE }
      if (search) params.search = search
      if (statusFilter !== 'All') params.status = statusFilter
      return api.get('/suppliers', { params }).then(r => r.data.data)
    },
    placeholderData: keepPreviousData,
  })

  const suppliers: Supplier[] = data?.rows ?? []
  const total: number = data?.total ?? 0
  const totalPages = Math.ceil(total / PAGE_SIZE)

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => api.put(`/suppliers/${id}`, { status: 'Inactive' }),
    onSuccess: () => {
      toast.success('Supplier deactivated')
      queryClient.invalidateQueries({ queryKey: ['suppliers'] })
      setMenuAnchor(null)
    },
    onError: () => toast.error('Failed to deactivate supplier'),
  })

  const handleSearch = (v: string) => { setSearch(v); setPage(1) }
  const handleStatusFilter = (sf: 'All' | 'Active' | 'Inactive') => { setStatusFilter(sf); setPage(1); setFilterAnchor(null) }
  const handleDeactivate = (id: string) => deactivateMutation.mutate(id)

  return (
    <div className="cust-page">
      <div className="cust-page-header">
        <div>
          <h2 className="cust-page-title">Suppliers</h2>
          <p className="cust-page-sub">Manage vendor accounts, contacts, and order history.</p>
        </div>
        <div className="cust-controls">
          <div className="cust-search">
            <Search size={14} />
            <input
              placeholder="Search by name, email or city..."
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
            onClick={() => navigate('/suppliers/new')}
          >
            <Plus size={14} /> New Supplier
          </button>
        </div>
      </div>

      <div className="al-panel cust-table-wrap">
        <table className="cust-table">
          <thead>
            <tr>
              <th>Supplier</th>
              <th>Email</th>
              <th>Phone</th>
              <th>City / State</th>
              <th>Orders</th>
              <th>Total Spent</th>
              <th>Status</th>
              <th>Portal</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={9} className="cust-empty-row">Loading...</td></tr>
            )}
            {!isLoading && suppliers.length === 0 && (
              <tr><td colSpan={9} className="cust-empty-row">No suppliers match your search.</td></tr>
            )}
            {!isLoading && suppliers.map((s) => (
              <tr key={s.id} className="cust-row" onClick={() => navigate(`/suppliers/${s.id}`)}>
                <td>
                  <div className="cust-name-cell">
                    <Avatar sx={{ width: 32, height: 32, fontSize: 12, bgcolor: avatarColor(s.id) }}>
                      {initials(s.name)}
                    </Avatar>
                    <span>{s.name}</span>
                  </div>
                </td>
                <td className="cust-muted">{s.email ?? '-'}</td>
                <td className="cust-muted">{s.phone ?? '-'}</td>
                <td>{[s.city, s.state].filter(Boolean).join(', ') || '-'}</td>
                <td className="cust-num">{s.orders_count ?? 0}</td>
                <td className="cust-spent">${Number(s.total_spent ?? 0).toLocaleString()}</td>
                <td>
                  <span className={cn('cust-status-badge', s.status === 'Active' ? 'cust-status-active' : 'cust-status-inactive')}>
                    {s.status}
                  </span>
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  <button
                    className={cn('cust-portal-btn', s.has_portal_access ? 'cust-portal-btn-active' : 'cust-portal-btn-inactive')}
                    onClick={() => setPortalModal({ id: s.id, name: s.name })}
                    title={s.has_portal_access ? 'Portal access active' : 'No portal access'}
                  >
                    <KeyRound size={12} />
                    {s.has_portal_access ? 'Active' : 'None'}
                  </button>
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  <button className="lb-icon-btn" onClick={(e) => setMenuAnchor({ el: e.currentTarget, id: s.id })}>
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
            Showing {Math.min((page - 1) * PAGE_SIZE + 1, total)}-{Math.min(page * PAGE_SIZE, total)} of {total} suppliers
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
        <MenuItem onClick={() => { navigate(`/suppliers/${menuAnchor?.id}`); setMenuAnchor(null) }}>View Profile</MenuItem>
        <MenuItem onClick={() => { navigate(`/suppliers/${menuAnchor?.id}`); setMenuAnchor(null) }}>Edit Supplier</MenuItem>
        <MenuItem onClick={() => { navigate('/orders/new'); setMenuAnchor(null) }}>New Order</MenuItem>
        <MenuItem
          onClick={() => {
            const s = suppliers.find(x => x.id === menuAnchor?.id)
            if (s) setPortalModal({ id: s.id, name: s.name })
            setMenuAnchor(null)
          }}
        >
          <KeyRound size={14} style={{ marginRight: 8, color: '#2563EB' }} />
          Manage Portal Access
        </MenuItem>
        <MuiDivider />
        <MenuItem onClick={() => handleDeactivate(menuAnchor?.id ?? '')} sx={{ color: '#DC2626' }}>Deactivate</MenuItem>
      </Menu>

      {portalModal && (
        <PortalAccessModal
          supplierId={portalModal.id}
          supplierName={portalModal.name}
          onClose={() => setPortalModal(null)}
        />
      )}

      <Menu anchorEl={filterAnchor} open={Boolean(filterAnchor)} onClose={() => setFilterAnchor(null)}>
        {(['All', 'Active', 'Inactive'] as const).map((s) => (
          <MenuItem key={s} selected={statusFilter === s} onClick={() => handleStatusFilter(s)}>
            {s}
          </MenuItem>
        ))}
      </Menu>
    </div>
  )
}
