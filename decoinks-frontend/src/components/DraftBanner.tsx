import { RotateCcw, X } from 'lucide-react'

// Small inline notice shown when a saved draft was restored into a form.
// "Discard" wipes the draft and reloads to a clean, empty form.
export function DraftBanner({ show, onDiscard }: { show: boolean; onDiscard: () => void }) {
  if (!show) return null
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e40af',
      borderRadius: 8, padding: '8px 12px', fontSize: 13, margin: '0 0 14px',
    }}>
      <RotateCcw size={15} style={{ flexShrink: 0 }} />
      <span style={{ flex: 1 }}>Draft restored — your unsaved work from before was recovered.</span>
      <button
        onClick={onDiscard}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          background: '#fff', border: '1px solid #bfdbfe', color: '#1e40af',
          borderRadius: 6, padding: '4px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
        }}
      >
        <X size={13} /> Discard
      </button>
    </div>
  )
}
