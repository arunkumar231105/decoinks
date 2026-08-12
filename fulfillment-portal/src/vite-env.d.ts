/// <reference types="vite/client" />

// The hand-written `declare module 'lucide-react'` shim that used to live here
// listed only ~40 icons and shadowed the package's own types, so any other icon
// failed to type-check even though it existed at runtime. lucide-react ships
// its own declarations — use those.
