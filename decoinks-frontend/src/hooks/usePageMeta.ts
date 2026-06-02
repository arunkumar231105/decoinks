import { useMatches } from 'react-router-dom'

export interface PageMeta {
  title: string
  subtitle: string
}

export function usePageMeta(): PageMeta {
  const matches = useMatches()
  const active = [...matches].reverse().find((match) => match.handle)
  return (
    (active?.handle as PageMeta | undefined) ?? {
      title: 'Decoinks',
      subtitle: 'Printshop management workspace',
    }
  )
}
