import { FormEvent, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, ArrowLeft } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../services/api'

const STATUS_OPTIONS = [
  'In Production',
  'Materials Received',
  'Printing Started',
  'Quality Check',
  'Packed',
  'Ready to Ship',
  'Shipped',
  'Delayed',
  'On Hold',
]

interface StatusUpdate {
  id: string
  status: string
  notes: string | null
  submitted_at: string
}

const fmt = (d: string) =>
  new Date(d).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })

export default function ProductionStatusPage() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()

  const [status, setStatus] = useState(STATUS_OPTIONS[0])
  const [notes, setNotes] = useState('')

  const { data: updates = [], isLoading } = useQuery<StatusUpdate[]>({
    queryKey: ['status-updates', id],
    queryFn: () => api.get(`/orders/${id}/status-updates`).then((r) => r.data.updates ?? r.data),
    enabled: !!id,
  })

  const submit = useMutation({
    mutationFn: () => api.post(`/orders/${id}/status-updates`, { status, notes: notes.trim() || undefined }),
    onSuccess: () => {
      toast.success('Status update submitted')
      qc.invalidateQueries({ queryKey: ['status-updates', id] })
      setNotes('')
    },
    onError: () => toast.error('Failed to submit update'),
  })

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    submit.mutate()
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Link to={`/orders/${id}`} className="text-gray-400 hover:text-gray-600">
          <ArrowLeft size={18} />
        </Link>
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Production Status Update</h2>
          <p className="text-sm text-gray-500 mt-0.5">Submit a production progress update for this order.</p>
        </div>
      </div>

      {/* Submit form */}
      <div className="card">
        <h3 className="font-semibold text-gray-900 mb-4">Submit Update</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Production Status</label>
            <select
              className="input"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Notes <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <textarea
              className="input"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any details about the current production stage..."
            />
          </div>
          <button
            type="submit"
            disabled={submit.isPending}
            className="btn-primary flex items-center gap-2"
          >
            {submit.isPending ? <Loader2 size={14} className="animate-spin" /> : null}
            {submit.isPending ? 'Submitting...' : 'Submit Update'}
          </button>
        </form>
      </div>

      {/* History */}
      <div className="card">
        <h3 className="font-semibold text-gray-900 mb-4">Update History</h3>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={20} className="animate-spin text-gray-400" />
          </div>
        ) : updates.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">No updates submitted yet.</p>
        ) : (
          <div className="space-y-3">
            {[...updates].reverse().map((u) => (
              <div key={u.id} className="flex gap-4 p-3 rounded-lg bg-gray-50">
                <div className="w-2 h-2 mt-1.5 rounded-full bg-accent flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-gray-900">{u.status}</span>
                    <span className="text-xs text-gray-400 flex-shrink-0">{fmt(u.submitted_at)}</span>
                  </div>
                  {u.notes && (
                    <p className="text-sm text-gray-600 mt-0.5">{u.notes}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
