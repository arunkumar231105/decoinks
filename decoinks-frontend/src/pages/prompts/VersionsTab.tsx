import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { CheckCircle2, Copy, Eye, GitBranch, Pencil, RotateCcw, Trash2 } from 'lucide-react'
import { api } from '../../services/api'
import toast from '../../utils/toast'
import { apiMessage, fmtStamp, type Prompt, type PromptVersion } from './types'

/**
 * Every version this prompt has had.
 *
 * Publishing archives whatever was live; rollback makes an archived one live
 * again. Nothing is ever deleted once published, because a generation from
 * months ago still names the version that produced it — only an unpublished
 * draft can be thrown away.
 */
export function VersionsTab({
  prompt, versions, canEdit, selectedId, onOpen, onChanged,
}: {
  prompt: Prompt
  versions: PromptVersion[]
  canEdit: boolean
  selectedId: string
  onOpen: (id: string) => void
  onChanged: (newVersionId?: string) => void
}) {
  const [detailId, setDetailId] = useState<string>(selectedId)
  const detail = versions.find(v => v.id === detailId) ?? versions.find(v => v.id === selectedId) ?? versions[0]
  const draftExists = versions.some(v => v.status === 'draft')

  const newVersion = useMutation({
    mutationFn: () => api.post(`/prompts/${prompt.id}/versions`, {
      from_version_id: prompt.production_version_id ?? null,
    }).then(r => r.data.data as PromptVersion),
    onSuccess: (v) => { toast.success(`Draft v${v.version_number} created`); onChanged(v.id) },
    onError: (err) => toast.error(apiMessage(err, 'Could not create a new version')),
  })

  const publish = useMutation({
    mutationFn: (id: string) => api.post(`/prompts/versions/${id}/publish`),
    onSuccess: () => { toast.success('Version published — it is now live'); onChanged() },
    onError: (err) => toast.error(apiMessage(err, 'Could not publish this version')),
  })

  const rollback = useMutation({
    mutationFn: (id: string) => api.post(`/prompts/versions/${id}/rollback`),
    onSuccess: () => { toast.success('Rolled back — this version is live again'); onChanged() },
    onError: (err) => toast.error(apiMessage(err, 'Could not roll back to this version')),
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/prompts/versions/${id}`),
    onSuccess: () => { toast.success('Draft deleted'); onChanged() },
    onError: (err) => toast.error(apiMessage(err, 'Could not delete this draft')),
  })

  const label = (v: PromptVersion) =>
    v.status === 'production' ? 'Production' : v.status === 'draft' ? 'Draft' : 'Archived'

  const liveDraft = versions.find(v => v.status === 'draft')
  const archived = versions.filter(v => v.status === 'archived')

  return (
    <>
      <section className="pm-block">
        <div className="pm-block-head">
          <div>
            <h3>Version History</h3>
            <p>View and manage all versions of this prompt.</p>
          </div>
          {canEdit && (
            <div className="pm-block-actions">
              <button className="pm-btn small" disabled={draftExists || newVersion.isPending}
                title={draftExists ? 'A draft is already open — publish or delete it first' : undefined}
                onClick={() => newVersion.mutate()}>
                <GitBranch size={14} /> New Version
              </button>
              <button className="pm-btn primary small" disabled={!liveDraft || publish.isPending}
                title={liveDraft ? undefined : 'There is no draft to publish'}
                onClick={() => liveDraft && publish.mutate(liveDraft.id)}>
                <CheckCircle2 size={14} /> Publish
              </button>
              <button className="pm-btn small"
                disabled={detail?.status !== 'archived' || rollback.isPending}
                title={detail?.status === 'archived' ? undefined : 'Select an archived version to roll back to'}
                onClick={() => {
                  if (detail && window.confirm(`Make v${detail.version_number} live again?`)) rollback.mutate(detail.id)
                }}>
                <RotateCcw size={14} /> Rollback
              </button>
            </div>
          )}
        </div>

        <div className="pm-table-wrap">
          <table className="pm-table">
            <thead>
              <tr>
                <th>Version</th><th>Status</th><th>Change Summary</th>
                <th>Created By</th><th>Created On</th><th>Published On</th>
                <th style={{ width: 110 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {versions.map(v => (
                <tr key={v.id} className={`clickable ${v.id === detailId ? 'selected' : ''}`}
                    onClick={() => setDetailId(v.id)}>
                  <td><span className="pm-vlink">v{v.version_number}</span></td>
                  <td><span className={`pm-chip ${v.status}`}>{label(v)}</span></td>
                  <td style={{ maxWidth: 240, color: '#475569' }}>{v.change_summary || '—'}</td>
                  <td>{v.created_by_name || '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtStamp(v.created_at)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{v.published_at ? fmtStamp(v.published_at) : <span className="pm-num">—</span>}</td>
                  <td onClick={e => e.stopPropagation()}>
                    <div style={{ display: 'flex', gap: 5 }}>
                      {v.status === 'draft' && canEdit ? (
                        <>
                          <button className="pm-btn icon small" title="Edit this draft" onClick={() => onOpen(v.id)}>
                            <Pencil size={13} />
                          </button>
                          <button className="pm-btn icon small" title="Publish" disabled={publish.isPending}
                            onClick={() => publish.mutate(v.id)}>
                            <CheckCircle2 size={13} />
                          </button>
                          {!v.published_at && (
                            <button className="pm-btn icon small danger" title="Delete draft" disabled={remove.isPending}
                              onClick={() => { if (window.confirm(`Delete draft v${v.version_number}? This cannot be undone.`)) remove.mutate(v.id) }}>
                              <Trash2 size={13} />
                            </button>
                          )}
                        </>
                      ) : (
                        <>
                          <button className="pm-btn icon small" title="View this version" onClick={() => onOpen(v.id)}>
                            <Eye size={13} />
                          </button>
                          {canEdit && v.status === 'archived' && (
                            <button className="pm-btn icon small" title="Roll back to this version" disabled={rollback.isPending}
                              onClick={() => { if (window.confirm(`Make v${v.version_number} live again?`)) rollback.mutate(v.id) }}>
                              <RotateCcw size={13} />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {archived.length > 0 && (
          <p style={{ margin: '12px 0 0', color: '#64748b', fontSize: 12.5 }}>
            {archived.length} archived version{archived.length === 1 ? '' : 's'} kept. A published version is never
            deleted — a generation from months ago still names the version that made it.
          </p>
        )}
      </section>

      {detail && (
        <section className="pm-block">
          <div className="pm-block-head">
            <div><h3>Version Details</h3></div>
            {canEdit && detail.status === 'draft' && (
              <div className="pm-block-actions">
                <button className="pm-btn small" onClick={() => onOpen(detail.id)}><Pencil size={14} /> Edit</button>
              </div>
            )}
          </div>

          <div className="pm-grid2">
            <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
              <div className="pm-info-row">
                <span>Version</span>
                <b><span className="pm-chip version">v{detail.version_number}</span>{' '}
                   <span className={`pm-chip ${detail.status}`}>{label(detail)}</span></b>
              </div>
              <div className="pm-field">
                <label>Change Summary</label>
                <input className="pm-input" readOnly value={detail.change_summary ?? '—'} />
              </div>
              <div className="pm-field">
                <label>Detailed Notes</label>
                <textarea className="pm-input" readOnly value={detail.notes ?? '—'} />
              </div>
            </div>

            <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
              <div className="pm-grid2">
                <div className="pm-field"><label>Created By</label><div>{detail.created_by_name || '—'}</div></div>
                <div className="pm-field"><label>Created On</label><div>{fmtStamp(detail.created_at)}</div></div>
                <div className="pm-field"><label>Published On</label><div>{detail.published_at ? fmtStamp(detail.published_at) : '—'}</div></div>
                <div className="pm-field"><label>Variables</label><div>{detail.variable_count ?? 0}</div></div>
              </div>
              <div className="pm-field">
                <label>Model</label>
                <div>{detail.provider ?? '—'} · {detail.model_name ?? '—'}</div>
              </div>
              <div>
                <button className="pm-btn small" onClick={() => {
                  navigator.clipboard?.writeText(`${prompt.prompt_key}@${detail.version_number}`)
                  toast.success('Prompt key and version copied')
                }}>
                  <Copy size={14} /> Copy key @ version
                </button>
              </div>
            </div>
          </div>
        </section>
      )}
    </>
  )
}
