import { Button } from '../components/ui/button'
import { useNavigate } from 'react-router-dom'

export function PlaceholderPage({
  title,
  action,
}: {
  title: string
  action?: string
}) {
  const navigate = useNavigate()
  return (
    <section className="panel placeholder-panel">
      <div>
        <h2>{title}</h2>
        <p>Core workflow screen is ready for the next MVP prompt.</p>
      </div>
      {action && <Button onClick={() => navigate(-1)}>{action}</Button>}
    </section>
  )
}
