import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

interface ArtworkEntry {
  id: string
  src: string
  label: string
  element: HTMLElement
}

interface ArtworkLightboxContextValue {
  activeId: string | null
  entries: () => ArtworkEntry[]
  register: (entry: ArtworkEntry) => () => void
  open: (id: string) => void
  close: () => void
  move: (direction: -1 | 1) => void
}

const ArtworkLightboxContext = createContext<ArtworkLightboxContextValue | null>(null)

export function toAbsoluteUrl(src: string): string {
  try {
    return new URL(src, window.location.origin).href
  } catch {
    return src
  }
}

function toArtworkViewerUrl(src: string, label: string): string {
  // /storage is deliberately public at the edge so PDF recipients never hit
  // the app's Authentik gate. Nginx serves this one exact file locally and
  // continues proxying every other /storage URL to MinIO.
  const viewerUrl = new URL('/storage/artwork-viewer.html', window.location.origin)
  viewerUrl.searchParams.set('src', toAbsoluteUrl(src))
  viewerUrl.searchParams.set('label', label)
  return viewerUrl.href
}

export function ArtworkLightboxProvider({ children }: { children: ReactNode }) {
  const registry = useRef(new Map<string, ArtworkEntry>())
  const [activeId, setActiveId] = useState<string | null>(null)

  const entries = useCallback(() => (
    Array.from(registry.current.values()).sort((a, b) => {
      if (a.element === b.element) return 0
      return a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
    })
  ), [])

  const register = useCallback((entry: ArtworkEntry) => {
    registry.current.set(entry.id, entry)
    return () => {
      registry.current.delete(entry.id)
      setActiveId(current => current === entry.id ? null : current)
    }
  }, [])

  const move = useCallback((direction: -1 | 1) => {
    setActiveId(current => {
      const ordered = entries()
      if (!current || ordered.length < 2) return current
      const index = ordered.findIndex(entry => entry.id === current)
      if (index < 0) return ordered[0]?.id ?? null
      return ordered[(index + direction + ordered.length) % ordered.length].id
    })
  }, [entries])

  const value = useMemo<ArtworkLightboxContextValue>(() => ({
    activeId,
    entries,
    register,
    open: setActiveId,
    close: () => setActiveId(null),
    move,
  }), [activeId, entries, move, register])

  return (
    <ArtworkLightboxContext.Provider value={value}>
      {children}
    </ArtworkLightboxContext.Provider>
  )
}

export interface ArtworkThumbProps {
  src?: string | null
  alt?: string
  label?: string
  className?: string
  style?: CSSProperties
  fallback?: ReactNode
}

export function ArtworkThumb({
  src,
  alt = '',
  label,
  className,
  style,
  fallback = null,
}: ArtworkThumbProps) {
  const lightbox = useContext(ArtworkLightboxContext)
  const id = useId()
  const anchorRef = useRef<HTMLAnchorElement>(null)
  const register = lightbox?.register
  const imageLabel = label || alt || 'Artwork'
  const linkable = !!src && !/^(data|blob):/i.test(src)
  const absoluteUrl = src && linkable ? toArtworkViewerUrl(src, imageLabel) : null

  useEffect(() => {
    if (!src || !register || !anchorRef.current) return
    return register({ id, src, label: imageLabel, element: anchorRef.current })
  }, [id, imageLabel, register, src])

  if (!src) return <>{fallback}</>

  const image = <img src={src} alt={alt} className={className} style={style} />
  if (!absoluteUrl) return image

  const openLightbox = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1) return
    event.preventDefault()
    lightbox?.open(id)
  }

  return (
    <a
      ref={anchorRef}
      className="art-link"
      href={absoluteUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={openLightbox}
      title={`Enlarge ${imageLabel}`}
    >
      {image}
    </a>
  )
}

export function ArtworkLightboxOverlay() {
  const lightbox = useContext(ArtworkLightboxContext)
  const activeId = lightbox?.activeId ?? null
  const ordered = lightbox?.entries() ?? []
  const index = ordered.findIndex(entry => entry.id === activeId)
  const active = index >= 0 ? ordered[index] : null

  useEffect(() => {
    if (!active) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') lightbox?.close()
      if (event.key === 'ArrowLeft') lightbox?.move(-1)
      if (event.key === 'ArrowRight') lightbox?.move(1)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [active, lightbox])

  if (!active || !lightbox) return null

  return createPortal(
    <div
      className="artwork-lightbox no-print"
      role="dialog"
      aria-modal="true"
      aria-label={active.label}
      onMouseDown={event => {
        if (event.target === event.currentTarget) lightbox.close()
      }}
    >
      <style>{`
        .artwork-lightbox {
          position: fixed; inset: 0; z-index: 10000; display: flex;
          align-items: center; justify-content: center; padding: 64px 76px 78px;
          background: rgba(3, 7, 18, .94);
        }
        .artwork-lightbox__image {
          display: block; object-fit: contain; max-width: 100%; max-height: 100%;
          width: auto; height: auto;
        }
        .artwork-lightbox__close, .artwork-lightbox__arrow {
          position: fixed; border: 0; color: #fff; background: rgba(255,255,255,.14);
          cursor: pointer; display: grid; place-items: center;
        }
        .artwork-lightbox__close {
          top: 18px; right: 20px; width: 42px; height: 42px;
          border-radius: 50%; font-size: 30px; line-height: 1;
        }
        .artwork-lightbox__arrow {
          top: 50%; width: 46px; height: 64px; margin-top: -32px;
          border-radius: 8px; font-size: 34px;
        }
        .artwork-lightbox__arrow--prev { left: 16px; }
        .artwork-lightbox__arrow--next { right: 16px; }
        .artwork-lightbox__caption {
          position: fixed; bottom: 22px; left: 72px; right: 72px;
          color: #fff; font: 500 14px/1.4 Inter, sans-serif; text-align: center;
        }
        .artwork-lightbox__counter { margin-left: 10px; color: #cbd5e1; }
        @media print { .artwork-lightbox { display: none !important; } }
      `}</style>
      <button className="artwork-lightbox__close" onClick={lightbox.close} aria-label="Close artwork">×</button>
      {ordered.length > 1 && (
        <>
          <button className="artwork-lightbox__arrow artwork-lightbox__arrow--prev" onClick={() => lightbox.move(-1)} aria-label="Previous artwork">‹</button>
          <button className="artwork-lightbox__arrow artwork-lightbox__arrow--next" onClick={() => lightbox.move(1)} aria-label="Next artwork">›</button>
        </>
      )}
      <img className="artwork-lightbox__image" src={active.src} alt={active.label} />
      <div className="artwork-lightbox__caption">
        {active.label}
        <span className="artwork-lightbox__counter">{index + 1} / {ordered.length}</span>
      </div>
    </div>,
    document.body,
  )
}
