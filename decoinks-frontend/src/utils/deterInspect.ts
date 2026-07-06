/**
 * Casual-tampering deterrent: blocks right-click and the common
 * "open DevTools / view source" keyboard shortcuts.
 *
 * NOTE: this is a DETERRENT, not security. Browser DevTools cannot be truly
 * disabled — anyone determined can still open them (menu, disabled JS, remote
 * debugging). Never rely on this to protect anything; real protection lives on
 * the server (auth, authorization, validation). It only discourages casual
 * snooping. Active in production builds only so development isn't hampered.
 */
export function installInspectDeterrent(): void {
  // Skip on local development so it never gets in the developer's way.
  const host = window.location.hostname
  if (host === 'localhost' || host === '127.0.0.1' || host === '') return

  // Disable the right-click context menu
  window.addEventListener('contextmenu', (e) => e.preventDefault())

  // Block common DevTools / view-source shortcuts
  window.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase()
    const block =
      key === 'f12' ||                                   // F12
      (e.ctrlKey && e.shiftKey && ['i', 'j', 'c'].includes(key)) || // Ctrl+Shift+I/J/C
      (e.ctrlKey && key === 'u') ||                      // Ctrl+U (view source)
      (e.metaKey && e.altKey && ['i', 'j', 'c'].includes(key))      // Cmd+Opt+I/J/C (mac)
    if (block) {
      e.preventDefault()
      e.stopPropagation()
    }
  })
}
