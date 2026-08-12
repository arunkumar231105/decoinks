import { useState } from 'react'
import { ZoomIn, X } from 'lucide-react'
import { cn } from '../utils/cn'

interface Props {
  artworkNumber: string
  name?: string
  position?: string
  width?: number
  height?: number
  thumbnailUrl?: string | null
  fileUrl?: string | null
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const SIZE_MAP = {
  sm:  { thumb: 'w-10 h-10',  text: false },
  md:  { thumb: 'w-16 h-16',  text: true  },
  lg:  { thumb: 'w-24 h-24',  text: true  },
}

export default function ArtworkThumb({
  artworkNumber,
  name,
  position,
  width,
  height,
  thumbnailUrl,
  fileUrl,
  size = 'md',
  className,
}: Props) {
  const [lightbox, setLightbox] = useState(false)
  const { thumb, text } = SIZE_MAP[size]

  return (
    <>
      <div className={cn('flex flex-col items-center gap-1', className)}>
        {/* Thumbnail */}
        <button
          type="button"
          onClick={() => fileUrl && setLightbox(true)}
          className={cn(
            'relative bg-gray-900 rounded flex items-center justify-center overflow-hidden group',
            thumb,
            fileUrl ? 'cursor-pointer' : 'cursor-default',
          )}
        >
          {thumbnailUrl ? (
            <img src={thumbnailUrl} alt={artworkNumber} className="max-w-full max-h-full object-contain" />
          ) : (
            <span className="text-[8px] text-white/40 text-center leading-tight px-0.5">
              {artworkNumber}
            </span>
          )}
          {fileUrl && (
            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <ZoomIn size={12} className="text-white" />
            </div>
          )}
        </button>

        {/* Labels */}
        {text && (
          <div className="text-center">
            <p className="text-[9px] font-medium text-accent leading-tight">{artworkNumber}</p>
            {position && <p className="text-[9px] text-gray-400 leading-tight">{position}</p>}
            {width && height && (
              <p className="text-[9px] text-gray-400 leading-tight">{width} x {height} in</p>
            )}
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightbox && fileUrl && (
        <div
          className="fixed inset-0 bg-black/85 z-50 flex items-center justify-center p-8"
          onClick={() => setLightbox(false)}
        >
          <div className="relative" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setLightbox(false)}
              className="absolute -top-10 right-0 text-white hover:text-gray-300 transition-colors"
            >
              <X size={24} />
            </button>
            <img
              src={fileUrl}
              alt={name ?? artworkNumber}
              className="max-w-[80vw] max-h-[80vh] object-contain rounded-lg"
            />
            <div className="text-center mt-3 space-y-0.5">
              <p className="text-white text-sm font-medium">{artworkNumber}</p>
              {name && <p className="text-white/60 text-xs">{name}</p>}
              {width && height && (
                <p className="text-white/40 text-xs">{width} × {height} in</p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
