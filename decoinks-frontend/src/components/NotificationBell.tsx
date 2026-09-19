import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Popover } from '@mui/material'
import {
  AlertTriangle, Bell, BellOff, BellRing, CheckCheck, CircleDollarSign, PackageCheck, ShieldAlert,
  Smartphone, Truck, Volume2, VolumeX,
} from 'lucide-react'
import toast from '../utils/toast'
import { api } from '../services/api'
import { playChime, setSoundEnabled, soundEnabled } from '../utils/notifySound'
import { pushState, refreshPushSubscription, turnPushOff, turnPushOn, type PushState } from '../utils/pushNotifications'
import { fmtDateTime } from '../utils/dates'
import '../styles/notifications.css'

/**
 * The header bell (owner, 19 Sep 2026): payments received, DIGI shipping,
 * deliveries, parcels stuck in Pre-Transit, new claims — found every minute by
 * the server (notifications.service.js). A new one while Printshop is open
 * rings a soft chime and shows a toast; with phone notifications on it also
 * arrives when the app is closed.
 */

interface Note { id: number; type: string; title: string; body: string | null; link: string | null; created_at: string; read_at: string | null }

const ICON: Record<string, { icon: typeof Bell; tone: string }> = {
  payment_received: { icon: CircleDollarSign, tone: 'green' },
  digi_shipped: { icon: Truck, tone: 'blue' },
  delivered: { icon: PackageCheck, tone: 'teal' },
  stuck: { icon: AlertTriangle, tone: 'amber' },
  claim: { icon: ShieldAlert, tone: 'red' },
}

function ago(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`
  return fmtDateTime(iso)
}

const PUSH_TEXT: Record<PushState, string> = {
  on: 'On for this device',
  off: 'Off for this device',
  denied: 'Blocked — allow notifications for this site in the browser settings',
  'install-first': 'On iPhone: add Printshop to the Home Screen first, then turn this on there',
  unsupported: 'This browser cannot show them',
}

export function NotificationBell() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [sound, setSound] = useState(soundEnabled)
  const [push, setPush] = useState<PushState | null>(null)
  const [busyPush, setBusyPush] = useState(false)
  const seen = useRef<number | null>(null)

  const { data } = useQuery<{ rows: Note[]; unread: number }>({
    queryKey: ['notifications'],
    queryFn: () => api.get('/notifications', { params: { limit: 30 } }).then(r => r.data),
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
  })
  const rows = data?.rows ?? []
  const unread = data?.unread ?? 0

  // Something new since the last look: chime and a toast (not on the first load).
  useEffect(() => {
    if (!data) return
    const newest = rows[0]?.id ?? 0
    if (seen.current !== null && newest > seen.current) {
      const fresh = rows.filter(n => n.id > (seen.current ?? 0) && !n.read_at)
      if (fresh.length) {
        playChime()
        toast.success(fresh.length === 1 ? fresh[0].title : `${fresh.length} new notifications`)
      }
    }
    seen.current = Math.max(seen.current ?? 0, newest)
  }, [data])

  // A push that lands while Printshop is open refreshes the bell at once.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const onMessage = (e: MessageEvent) => { if (e.data?.type === 'printshop:notification') qc.invalidateQueries({ queryKey: ['notifications'] }) }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [qc])

  useEffect(() => { refreshPushSubscription().catch(() => {}) }, [])

  // The unread count on the installed app's icon, where the phone supports it.
  useEffect(() => {
    const nav = navigator as any
    if (unread > 0) nav.setAppBadge?.(unread).catch?.(() => {})
    else nav.clearAppBadge?.().catch?.(() => {})
  }, [unread])

  useEffect(() => { if (anchor && push === null) pushState().then(setPush).catch(() => setPush('unsupported')) }, [anchor, push])

  const markRead = useMutation({
    mutationFn: (id: number) => api.post(`/notifications/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })
  const markAll = useMutation({
    mutationFn: () => api.post('/notifications/read-all'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })
  const sendTest = useMutation({
    mutationFn: () => api.post('/notifications/test').then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['notifications'] }) },
    onError: () => toast.error('Could not send a test notification'),
  })

  const open = (n: Note) => {
    if (!n.read_at) markRead.mutate(n.id)
    setAnchor(null)
    if (n.link) navigate(n.link)
  }
  const togglePush = async () => {
    setBusyPush(true)
    try {
      const next = push === 'on' ? await turnPushOff() : await turnPushOn()
      setPush(next)
      if (next === 'on') toast.success('Phone notifications are on for this device')
      else if (next === 'denied') toast.error('Notifications are blocked for this site in the browser settings')
      else if (next === 'install-first') toast.error('Add Printshop to the Home Screen first, then turn them on there')
    } catch {
      toast.error('Could not turn phone notifications on')
    } finally { setBusyPush(false) }
  }
  const toggleSound = () => {
    const next = !sound
    setSound(next); setSoundEnabled(next)
    if (next) playChime(true)
  }

  return (
    <>
      <button type="button" className={`nb-bell${unread ? ' nb-has' : ''}`} aria-label={unread ? `${unread} unread notifications` : 'Notifications'}
        onClick={e => setAnchor(e.currentTarget)}>
        {unread ? <BellRing size={20} /> : <Bell size={20} />}
        {unread > 0 && <span className="nb-count">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {/* Mounted only while open: closing and navigating in the same tap left
          MUI's exit transition unfinished, and its invisible backdrop then
          swallowed every click on the next screen. */}
      {anchor && <Popover
        open anchorEl={anchor} onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { className: 'nb-panel' } }}
      >
        <header className="nb-head">
          <b>Notifications</b>
          {unread > 0 && <button type="button" className="nb-link" onClick={() => markAll.mutate()}><CheckCheck size={14} /> Mark all read</button>}
        </header>
        <div className="nb-list">
          {rows.length === 0 && (
            <div className="nb-empty"><Bell size={26} /><b>You're all caught up</b>
              <span>Payments, DIGI shipping, deliveries, stuck parcels and new claims show up here.</span></div>
          )}
          {rows.map(n => {
            const { icon: Icon, tone } = ICON[n.type] ?? { icon: Bell, tone: 'slate' }
            return (
              <button type="button" key={n.id} className={`nb-item${n.read_at ? '' : ' nb-unread'}`} onClick={() => open(n)}>
                <span className={`nb-icon nb-${tone}`}><Icon size={17} /></span>
                <span className="nb-text">
                  <b>{n.title}</b>
                  {n.body && <small>{n.body}</small>}
                  <em>{ago(n.created_at)}</em>
                </span>
                {!n.read_at && <i className="nb-dot" aria-label="unread" />}
              </button>
            )
          })}
        </div>
        <footer className="nb-foot">
          <div className="nb-setting">
            <Smartphone size={16} />
            <span><b>Phone notifications</b><small>{push ? PUSH_TEXT[push] : 'Checking…'}</small></span>
            {(push === 'on' || push === 'off') && (
              <button type="button" className={`nb-switch${push === 'on' ? ' on' : ''}`} role="switch" aria-checked={push === 'on'}
                disabled={busyPush} onClick={togglePush}><i /></button>
            )}
          </div>
          <div className="nb-setting">
            {sound ? <Volume2 size={16} /> : <VolumeX size={16} />}
            <span><b>Sound</b><small>A soft chime when something new arrives</small></span>
            <button type="button" className={`nb-switch${sound ? ' on' : ''}`} role="switch" aria-checked={sound} onClick={toggleSound}><i /></button>
          </div>
          <button type="button" className="nb-test" disabled={sendTest.isPending} onClick={() => sendTest.mutate()}>
            {push === 'on' ? <BellRing size={14} /> : <BellOff size={14} />} Send me a test notification
          </button>
        </footer>
      </Popover>}
    </>
  )
}
