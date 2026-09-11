// The shapes the Prompt Management API returns. Kept in one place so the list
// and the detail screen cannot drift apart from each other.

export type VersionStatus = 'draft' | 'production' | 'archived'

export interface PromptModule {
  id: string
  name: string
  key: string
  description: string | null
}

export interface PromptVariable {
  id: string
  prompt_version_id: string
  variable_name: string
  type: string
  required: boolean
  default_value: string | null
  source: string
  description: string | null
  validation_rules: Record<string, unknown>
  sort_order: number
}

export interface PromptVersion {
  id: string
  prompt_id: string
  version_number: string
  status: VersionStatus
  system_instruction: string | null
  task_instruction: string | null
  dynamic_context: string | null
  restrictions: string | null
  change_summary: string | null
  notes: string | null
  created_by_name: string | null
  created_at: string
  updated_at: string
  published_at: string | null
  variable_count?: number
  variables?: PromptVariable[]
  // The model settings travel with the version — they are frozen with it.
  provider: string | null
  model_name: string | null
  temperature: string | number | null
  max_tokens: number | null
  model_settings: Record<string, unknown> | null
}

export interface Prompt {
  id: string
  module_id: string | null
  module_name: string | null
  module_key: string | null
  name: string
  prompt_key: string
  description: string | null
  used_in: string | null
  status: 'Active' | 'Disabled' | 'Archived'
  production_version_id: string | null
  production_version: string | null
  draft_version: string | null
  draft_version_id?: string | null
  created_at: string
  updated_at: string
  versions?: PromptVersion[]
}

export interface PromptTest {
  id: string
  input_data: Record<string, unknown>
  output_data: { status?: string; note?: string; [k: string]: unknown }
  resolved_prompt: string | null
  status: 'ok' | 'failed'
  tested_by_name: string | null
  created_at: string
}

export const VARIABLE_TYPES = ['Text', 'Image', 'Boolean', 'Enum', 'Number', 'Ratio', 'Color', 'Asset', 'Array'] as const
export const VARIABLE_SOURCES = ['Job / CRM', 'Uploaded Asset', 'UI Selection', 'System', 'Previous Step', 'AI Output', 'Database'] as const

// Providers the studio can be pointed at. The server stores the provider as
// text and keeps everything else in a JSON bag, so adding an entry here is the
// only change on this screen a second provider needs.
export const PROVIDERS: Record<string, string[]> = {
  OpenAI: ['GPT-5.5'],
}

export const PROMPT_STATUSES = ['Active', 'Disabled', 'Archived'] as const

export const fmtDate = (v?: string | null) =>
  v ? new Date(v).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: '2-digit' }) : '—'

export const fmtDateTime = (v?: string | null) =>
  v ? new Date(v).toLocaleString('en-US',
    { day: 'numeric', month: 'short', year: '2-digit', hour: 'numeric', minute: '2-digit' }) : '—'

// "Aug 28, 2026 02:15 PM" — the version table shows the minute a version went
// live, because two versions can be published on the same day.
export const fmtStamp = (v?: string | null) =>
  v ? new Date(v).toLocaleString('en-US',
    { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }) : '—'

// A stable colour per module, so a prompt keeps the same tile every time the
// list is drawn. Derived from the name rather than stored: a colour is not a
// fact about the prompt, and one more column is one more thing to disagree.
const TILE_COLOURS = ['#2563eb', '#1e293b', '#7c3aed', '#0369a1', '#dc2626',
                      '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#be123c']
export const tileColour = (seed?: string | null) => {
  const key = String(seed ?? '')
  let hash = 0
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0
  return TILE_COLOURS[hash % TILE_COLOURS.length]
}

export const apiMessage = (err: any, fallback: string) =>
  err?.response?.data?.message ?? fallback
