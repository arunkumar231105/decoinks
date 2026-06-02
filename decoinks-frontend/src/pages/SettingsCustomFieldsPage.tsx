import { useState } from 'react'
import {
  ChevronDown,
  ChevronUp,
  GripVertical,
  Pencil,
  Plus,
  Sliders,
  Trash2,
  X,
} from 'lucide-react'
import toast from '../utils/toast'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { cn } from '../utils/cn'
import { api } from '../services/api'

// â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const ENTITY_TYPES = ['lead', 'quotation', 'invoice', 'order', 'supplier', 'product'] as const
const FIELD_TYPES  = ['text', 'number', 'date', 'select', 'multiselect', 'checkbox', 'textarea'] as const
const SELECT_TYPES = new Set(['select', 'multiselect'])

type EntityType = typeof ENTITY_TYPES[number]
type FieldType  = typeof FIELD_TYPES[number]

interface CustomField {
  id:            string
  entity_type:   EntityType
  field_key:     string
  field_label:   string
  field_type:    FieldType
  is_required:   boolean
  default_value: string | null
  options:       string[] | null
  display_order: number
  is_active:     boolean
  created_at:    string
}

// â”€â”€ Client-side Zod schema (mirrors backend) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const FIELD_KEY_RE = /^[a-z][a-z0-9_]*$/

const cfSchema = z
  .object({
    entity_type:   z.enum(ENTITY_TYPES),
    field_key:     z
      .string()
      .min(1, 'Required')
      .regex(FIELD_KEY_RE, 'Lowercase letters, digits, and underscores only; must start with a letter'),
    field_label:   z.string().min(1, 'Required'),
    field_type:    z.enum(FIELD_TYPES),
    is_required:   z.boolean(),
    default_value: z.string().optional(),
    options_raw:   z.string().optional(),   // comma-separated textarea
    display_order: z.number().int().min(0),
  })
  .superRefine((d, ctx) => {
    if (SELECT_TYPES.has(d.field_type)) {
      const items = (d.options_raw ?? '').split(',').map((s) => s.trim()).filter(Boolean)
      if (items.length === 0) {
        ctx.addIssue({
          code:    z.ZodIssueCode.custom,
          path:    ['options_raw'],
          message: 'At least one option is required for select / multiselect fields',
        })
      }
    }
  })

type FormValues = z.infer<typeof cfSchema>
type FormErrors = Partial<Record<keyof FormValues, string>>

// â”€â”€ Empty form factory â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function emptyForm(entity: EntityType = 'lead'): FormValues {
  return {
    entity_type:   entity,
    field_key:     '',
    field_label:   '',
    field_type:    'text',
    is_required:   false,
    default_value: '',
    options_raw:   '',
    display_order: 0,
  }
}

function fieldToForm(f: CustomField): FormValues {
  return {
    entity_type:   f.entity_type,
    field_key:     f.field_key,
    field_label:   f.field_label,
    field_type:    f.field_type,
    is_required:   f.is_required,
    default_value: f.default_value ?? '',
    options_raw:   (f.options ?? []).join(', '),
    display_order: f.display_order,
  }
}

function formToPayload(v: FormValues) {
  const options = SELECT_TYPES.has(v.field_type)
    ? (v.options_raw ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    : null
  return {
    entity_type:   v.entity_type,
    field_key:     v.field_key.trim(),
    field_label:   v.field_label.trim(),
    field_type:    v.field_type,
    is_required:   v.is_required,
    default_value: v.default_value?.trim() || null,
    options,
    display_order: v.display_order,
  }
}

// â”€â”€ Labels â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const ENTITY_LABELS: Record<EntityType, string> = {
  lead:      'Leads',
  quotation: 'Quotations',
  invoice:   'Invoices',
  order:     'Orders',
  supplier:  'Suppliers',
  product:   'Products',
}

const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text:        'Text',
  number:      'Number',
  date:        'Date',
  select:      'Select (single)',
  multiselect: 'Multi-select',
  checkbox:    'Checkbox',
  textarea:    'Text area',
}

// â”€â”€ Inline field error â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null
  return <p style={{ color: '#dc2626', fontSize: 12, marginTop: 2 }}>{msg}</p>
}

// â”€â”€ Form panel â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface FormPanelProps {
  initial:    FormValues
  editId:     string | null
  onClose:    () => void
  onSaved:    () => void
}

function FormPanel({ initial, editId, onClose, onSaved }: FormPanelProps) {
  const [vals, setVals]   = useState<FormValues>(initial)
  const [errs, setErrs]   = useState<FormErrors>({})
  const qc                = useQueryClient()

  const set = <K extends keyof FormValues>(k: K, v: FormValues[K]) =>
    setVals((p) => ({ ...p, [k]: v }))

  const saveMutation = useMutation({
    mutationFn: (payload: ReturnType<typeof formToPayload>) =>
      editId
        ? api.put(`/custom-fields/${editId}`, payload)
        : api.post('/custom-fields', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['custom-fields'] })
      toast.success(editId ? 'Field updated' : 'Field created')
      onSaved()
    },
    onError: (err) => {
      toast.apiError(err)
    },
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const result = cfSchema.safeParse(vals)
    if (!result.success) {
      const map: FormErrors = {}
      for (const issue of result.error.issues) {
        const key = issue.path[0] as keyof FormValues
        if (!map[key]) map[key] = issue.message
      }
      setErrs(map)
      return
    }
    setErrs({})
    saveMutation.mutate(formToPayload(result.data))
  }

  const isSelect = SELECT_TYPES.has(vals.field_type)

  return (
    <div className="al-panel sg-card" style={{ marginTop: 16 }}>
      <div className="sg-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="sg-card-icon" style={{ background: '#ede9fe', color: '#7c3aed' }}>
            <Sliders size={14} />
          </span>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{editId ? 'Edit Custom Field' : 'New Custom Field'}</span>
        </div>
        <button className="lb-action-btn" onClick={onClose}><X size={14} /></button>
      </div>

      <form onSubmit={handleSubmit} className="sg-fields" style={{ padding: '12px 16px 16px' }}>
        {/* Entity type - locked when editing */}
        <div className="al-field-row">
          <div className="al-field">
            <label className="al-label">Entity type</label>
            <select
              className="al-input"
              value={vals.entity_type}
              disabled={!!editId}
              onChange={(e) => set('entity_type', e.target.value as EntityType)}
            >
              {ENTITY_TYPES.map((t) => <option key={t} value={t}>{ENTITY_LABELS[t]}</option>)}
            </select>
            <FieldError msg={errs.entity_type} />
          </div>

          <div className="al-field">
            <label className="al-label">Field type</label>
            <select
              className="al-input"
              value={vals.field_type}
              onChange={(e) => set('field_type', e.target.value as FieldType)}
            >
              {FIELD_TYPES.map((t) => <option key={t} value={t}>{FIELD_TYPE_LABELS[t]}</option>)}
            </select>
            <FieldError msg={errs.field_type} />
          </div>
        </div>

        <div className="al-field-row">
          <div className="al-field">
            <label className="al-label">Field label</label>
            <input
              className="al-input"
              placeholder="e.g. PO Reference"
              value={vals.field_label}
              onChange={(e) => set('field_label', e.target.value)}
            />
            <FieldError msg={errs.field_label} />
          </div>

          <div className="al-field">
            <label className="al-label">
              Field key
              {!editId && <span style={{ color: '#94a3b8', fontSize: 11, marginLeft: 6 }}>auto-slug, no spaces</span>}
            </label>
            <input
              className="al-input"
              placeholder="e.g. po_reference"
              value={vals.field_key}
              disabled={!!editId}
              onChange={(e) => set('field_key', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
            />
            <FieldError msg={errs.field_key} />
          </div>
        </div>

        {isSelect && (
          <div className="al-field">
            <label className="al-label">
              Options
              <span style={{ color: '#94a3b8', fontSize: 11, marginLeft: 6 }}>comma-separated</span>
            </label>
            <input
              className="al-input"
              placeholder="e.g. Small, Medium, Large, XL"
              value={vals.options_raw}
              onChange={(e) => set('options_raw', e.target.value)}
            />
            <FieldError msg={errs.options_raw} />
          </div>
        )}

        <div className="al-field-row">
          <div className="al-field">
            <label className="al-label">Default value <span style={{ color: '#94a3b8', fontSize: 11 }}>(optional)</span></label>
            <input
              className="al-input"
              placeholder="-"
              value={vals.default_value}
              onChange={(e) => set('default_value', e.target.value)}
            />
          </div>

          <div className="al-field">
            <label className="al-label">Display order</label>
            <input
              type="number"
              min={0}
              className="al-input"
              value={vals.display_order}
              onChange={(e) => set('display_order', parseInt(e.target.value) || 0)}
            />
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
          <input
            type="checkbox"
            id="cf_required"
            checked={vals.is_required}
            onChange={(e) => set('is_required', e.target.checked)}
            style={{ width: 14, height: 14 }}
          />
          <label htmlFor="cf_required" style={{ fontSize: 13, cursor: 'pointer' }}>Required field</label>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <button type="button" className="lb-action-btn" onClick={onClose}>Cancel</button>
          <button
            type="submit"
            className="lb-action-btn lb-action-primary"
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? 'Saving...' : editId ? 'Save changes' : 'Create field'}
          </button>
        </div>
      </form>
    </div>
  )
}

// â”€â”€ Field row â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function FieldRow({ field, onEdit, onDelete }: { field: CustomField; onEdit: () => void; onDelete: () => void }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '24px 1fr 120px 80px 80px 64px',
        alignItems: 'center',
        gap: 8,
        padding: '8px 12px',
        borderBottom: '1px solid #f1f5f9',
        fontSize: 13,
      }}
    >
      <GripVertical size={14} color="#cbd5e1" />
      <div>
        <span style={{ fontWeight: 500 }}>{field.field_label}</span>
        <span style={{ color: '#94a3b8', marginLeft: 8, fontFamily: 'monospace', fontSize: 11 }}>{field.field_key}</span>
        {field.is_required && (
          <span style={{ background: '#fef9c3', color: '#854d0e', fontSize: 10, padding: '1px 5px', borderRadius: 4, marginLeft: 6 }}>required</span>
        )}
      </div>
      <span style={{ color: '#64748b' }}>{FIELD_TYPE_LABELS[field.field_type]}</span>
      <span style={{ color: '#64748b' }}>{field.display_order}</span>
      <span>
        <span style={{
          display: 'inline-block',
          padding: '2px 8px',
          borderRadius: 999,
          fontSize: 11,
          background: field.is_active ? '#dcfce7' : '#f1f5f9',
          color:      field.is_active ? '#166534' : '#64748b',
        }}>
          {field.is_active ? 'Active' : 'Inactive'}
        </span>
      </span>
      <div style={{ display: 'flex', gap: 4 }}>
        <button className="lb-action-btn" title="Edit" onClick={onEdit}><Pencil size={12} /></button>
        <button className="lb-action-btn" title="Deactivate" style={{ color: '#dc2626' }} onClick={onDelete}><Trash2 size={12} /></button>
      </div>
    </div>
  )
}

// â”€â”€ Entity group â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function EntityGroup({
  entity,
  fields,
  onAdd,
  onEdit,
  onDelete,
}: {
  entity:   EntityType
  fields:   CustomField[]
  onAdd:    () => void
  onEdit:   (f: CustomField) => void
  onDelete: (f: CustomField) => void
}) {
  const [open, setOpen] = useState(true)

  return (
    <div className="al-panel sg-card" style={{ marginBottom: 12 }}>
      <div
        className="sg-card-header"
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
        onClick={() => setOpen((o) => !o)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="sg-card-icon" style={{ background: '#ede9fe', color: '#7c3aed' }}>
            <Sliders size={14} />
          </span>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{ENTITY_LABELS[entity]}</span>
          <span style={{ color: '#94a3b8', fontSize: 12 }}>({fields.length} field{fields.length !== 1 ? 's' : ''})</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }} onClick={(e) => e.stopPropagation()}>
          <button className="lb-action-btn lb-action-primary" onClick={onAdd}>
            <Plus size={12} /> Add field
          </button>
          <button className="lb-action-btn" onClick={() => setOpen((o) => !o)}>
            {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {open && (
        <>
          {fields.length === 0 ? (
            <p style={{ padding: '12px 16px', color: '#94a3b8', fontSize: 13 }}>
              No custom fields yet. Click "Add field" to create one.
            </p>
          ) : (
            <>
              {/* header row */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '24px 1fr 120px 80px 80px 64px',
                gap: 8,
                padding: '6px 12px',
                background: '#f8fafc',
                fontSize: 11,
                color: '#94a3b8',
                fontWeight: 600,
                borderBottom: '1px solid #f1f5f9',
              }}>
                <span />
                <span>Label / Key</span>
                <span>Type</span>
                <span>Order</span>
                <span>Status</span>
                <span />
              </div>
              {fields.map((f) => (
                <FieldRow
                  key={f.id}
                  field={f}
                  onEdit={() => onEdit(f)}
                  onDelete={() => onDelete(f)}
                />
              ))}
            </>
          )}
        </>
      )}
    </div>
  )
}

// â”€â”€ Page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function SettingsCustomFieldsPage() {
  const qc = useQueryClient()

  // Which panel is open: { mode: 'create', entity } | { mode: 'edit', field }
  const [panel, setPanel] = useState<
    | { mode: 'create'; entity: EntityType }
    | { mode: 'edit';   field:  CustomField }
    | null
  >(null)

  const { data: fields = [], isLoading } = useQuery<CustomField[]>({
    queryKey: ['custom-fields'],
    queryFn:  () => api.get('/custom-fields').then((r) => r.data.data),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/custom-fields/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['custom-fields'] })
      toast.success('Field deactivated')
    },
    onError: (err) => toast.apiError(err),
  })

  function handleDelete(f: CustomField) {
    if (!window.confirm(`Deactivate "${f.field_label}"? It will no longer appear in forms but existing data is preserved.`)) return
    deleteMutation.mutate(f.id)
  }

  const byEntity = ENTITY_TYPES.reduce<Record<EntityType, CustomField[]>>(
    (acc, e) => ({ ...acc, [e]: fields.filter((f) => f.entity_type === e) }),
    {} as Record<EntityType, CustomField[]>
  )

  const initialForm =
    panel == null           ? emptyForm()
    : panel.mode === 'create' ? emptyForm(panel.entity)
    : fieldToForm(panel.field)

  const editId = panel?.mode === 'edit' ? panel.field.id : null

  return (
    <div className="sg-page">
      <div className="sg-grid" style={{ maxWidth: 900 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <p style={{ fontSize: 13, color: '#64748b' }}>
            Define additional fields that appear on entity forms. Changes apply immediately without schema migrations.
          </p>
        </div>

        {isLoading && <p style={{ color: '#94a3b8', fontSize: 13 }}>Loading...</p>}

        {ENTITY_TYPES.map((entity) => (
          <EntityGroup
            key={entity}
            entity={entity}
            fields={byEntity[entity]}
            onAdd={() => setPanel({ mode: 'create', entity })}
            onEdit={(f) => setPanel({ mode: 'edit', field: f })}
            onDelete={handleDelete}
          />
        ))}

        {panel && (
          <FormPanel
            key={editId ?? 'new'}
            initial={initialForm}
            editId={editId}
            onClose={() => setPanel(null)}
            onSaved={() => setPanel(null)}
          />
        )}
      </div>
    </div>
  )
}
