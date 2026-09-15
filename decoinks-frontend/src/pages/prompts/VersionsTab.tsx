import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Activity, CheckCircle2, Copy, Eye, FlaskConical, GitBranch, Pencil, RotateCcw, Trash2, Undo2 } from 'lucide-react'
import { api } from '../../services/api'
import toast from '../../utils/toast'
import {
  apiMessage, fmtStamp, isEditable, statusLabel,
  type Prompt, type PromptGeneration, type PromptVersion,
} from './types'

/**
 * Every version this prompt has had, and every live run it has done.
 *
 * Draft → Testing → Production. Publishing archives whatever was live; rollback
 * makes an archived one live again. Nothing is ever deleted once published,
 * because a generation from months ago still names the version that produced
 * it — only an unpublished version can be thrown away.
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
  const openVersion = versions.find(v => isEditable(v.status))

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

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'draft' | 'testing' }) =>
      api.post(`/prompts/versions/${id}/status`, { status }),
    onSuccess: (_r, v) => { toast.success(v.status === 'testing' ? 'Moved to testing' : 'Moved back to draft'); onChanged() },
    onError: (err) => toast.error(apiMessage(err, 'Could not change the version status')),
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/prompts/versions/${id}`),
    onSuccess: () => { toast.success('Version deleted'); onChanged() },
    onError: (err) => toast.error(apiMessage(err, 'Could not delete this version')),
  })

  const runs = useQuery({
    queryKey: ['prompt-generations', prompt.id],
    queryFn: () => api.get(`/prompts/${prompt.id}/generations`, { params: { limit: 25 } })
      .then(r => r.data.data as PromptGeneration[]),
  })

  const archived = versions.filter(v => v.status === 'archived')

  return (
    <>
      <section className="pm-block">
        <div className="pm-block-head">
          <div>
            <h3>Version History</h3>
            <p>Draft → Testing → Production. Apps such as Artwork Automation run only the Production version.</p>
          </div>
          {canEdit && (
            <div className="pm-block-actions">
              <button className="pm-btn small" disabled={Boolean(openVersion) || newVersion.isPending}
                title={openVersion ? `v${openVersion.version_number} is still open — publish or delete it first` : undefined}
                onClick={() => newVersion.mutate()}>
                <GitBranch size={14} /> New Version
              </button>
              <button className="pm-btn primary small" disabled={!openVersion || publish.isPending}
                title={openVersion ? undefined : 'There is no draft or testing version to publish'}
                onClick={() => {
                  if (openVersion && window.confirm(`Publish v${openVersion.version_number}? Apps using ${prompt.prompt_key} will start running it.`)) {
                    publish.mutate(openVersion.id)
                  }
                }}>
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
                <th style={{ width: 140 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {versions.map(v => (
                <tr key={v.id} className={`clickable ${v.id === detailId ? 'selected' : ''}`}
                    onClick={() => setDetailId(v.id)}>
                  <td><span className="pm-vlink">v{v.version_number}</span></td>
                  <td><span className={`pm-chip ${v.status}`}>{statusLabel(v.status)}</span></td>
                  <td style={{ maxWidth: 240, color: '#475569' }}>{v.change_summary || '—'}</td>
                  <td>{v.created_by_name || '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtStamp(v.created_at)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{v.published_at ? fmtStamp(v.published_at) : <span className="pm-num">—</span>}</td>
                  <td onClick={e => e.stopPropagation()}>
                    <div style={{ display: 'flex', gap: 5 }}>
                      {isEditable(v.status) && canEdit ? (
                        <>
                          <button className="pm-btn icon small" title="Edit this version" onClick={() => onOpen(v.id)}>
                            <Pencil size={13} />
                          </button>
                          {v.status === 'draft' ? (
                            <button className="pm-btn icon small" title="Move to testing" disabled={setStatus.isPending}
                              onClick={() => setStatus.mutate({ id: v.id, status: 'testing' })}>
                              <FlaskConical size={13} />
                            </button>
                          ) : (
                            <button className="pm-btn icon small" title="Back to draft" disabled={setStatus.isPending}
                              onClick={() => setStatus.mutate({ id: v.id, status: 'draft' })}>
                              <Undo2 size={13} />
                            </button>
                          )}
                          <button className="pm-btn icon small" title="Publish" disabled={publish.isPending}
                            onClick={() => {
                              if (window.confirm(`Publish v${v.version_number}? Apps using ${prompt.prompt_key} will start running it.`)) publish.mutate(v.id)
                            }}>
                            <CheckCircle2 size={13} />
                          </button>
                          {!v.published_at && (
                            <button className="pm-btn icon small danger" title="Delete this version" disabled={remove.isPending}
                              onClick={() => { if (window.confirm(`Delete v${v.version_number}? This cannot be undone.`)) remove.mutate(v.id) }}>
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
            {canEdit && isEditable(detail.status) && (
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
                   <span className={`pm-chip ${detail.status}`}>{statusLabel(detail.status)}</span></b>
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
                <div className="pm-field"><label>Published By</label><div>{detail.published_by_name || '—'}</div></div>
                <div className="pm-field"><label>Variables</label><div>{detail.variable_count ?? 0}</div></div>
                <div className="pm-field"><label>Model</label><div>{detail.provider ?? '—'} · {detail.model_display_name ?? detail.model_name ?? '—'}</div></div>
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

      <section className="pm-block">
        <div className="pm-block-head">
          <div>
            <h3><Activity size={15} style={{ verticalAlign: -2 }} /> Live Runs</h3>
            <p>Each time an app ran this prompt — which version, whether the designer edited it, and what came out.</p>
          </div>
        </div>
        {runs.isLoading ? (
          <div className="pm-spinner">Loading runs…</div>
        ) : !runs.data?.length ? (
          <p style={{ margin: 0, color: '#64748b', fontSize: 13 }}>
            No runs yet. They appear here once Artwork Automation finishes a job that uses {prompt.prompt_key}.
          </p>
        ) : (
          <div className="pm-table-wrap">
            <table className="pm-table">
              <thead>
                <tr>
                  <th>When</th><th>Version</th><th>Status</th><th>Text</th>
                  <th>Job</th><th>Model</th><th>Time</th><th>Files</th>
                </tr>
              </thead>
              <tbody>
                {runs.data.map(g => {
                  const vars = g.input_variables as Record<string, any>
                  return (
                    <tr key={g.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtStamp(g.created_at)}</td>
                      <td>{g.version_number ? `v${g.version_number}` : '—'}</td>
                      <td>
                        <span className={`pm-chip ${g.status === 'success' ? 'production' : g.status === 'failed' ? 'draft' : 'archived'}`}
                          title={g.error_message ?? undefined}>
                          {g.status}
                        </span>
                      </td>
                      <td>
                        {g.prompt_source === 'edited' ? 'Edited by designer'
                          : g.prompt_source === 'built_in' ? 'Built-in fallback' : 'Published'}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {[vars?.client, vars?.job_number].filter(Boolean).join(' · ') || g.external_ref || '—'}
                      </td>
                      <td>{g.model_used || '—'}</td>
                      <td>{g.latency_ms != null ? `${Math.round(g.latency_ms / 1000)}s` : '—'}</td>
                      <td>{g.files?.length ?? 0}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
