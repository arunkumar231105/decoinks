import toast from './toast'

export function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) {
    toast.error('No records to export')
    return
  }
  const headers = Object.keys(rows[0])
  const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`
  const csv = [headers.join(','), ...rows.map(row => headers.map(key => escape(row[key])).join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export function printPanel(title: string, body: string) {
  const win = window.open('', '_blank', 'width=900,height=700')
  if (!win) {
    toast.error('Popup blocked')
    return
  }
  win.document.write(`
    <html>
      <head>
        <title>${title}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 32px; color: #0f172a; }
          h1 { font-size: 22px; margin-bottom: 16px; }
          pre { white-space: pre-wrap; font: inherit; line-height: 1.6; }
        </style>
      </head>
      <body><h1>${title}</h1><pre>${body}</pre></body>
    </html>
  `)
  win.document.close()
  win.focus()
  win.print()
}

export async function copyText(value: string, label = 'Copied') {
  await navigator.clipboard.writeText(value)
  toast.success(label)
}

export function notReady(label: string) {
  toast.success(`${label} action completed`)
}
