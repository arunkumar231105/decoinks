/**
 * Phone / desktop push for Printshop's notifications (Web Push, migration 154).
 * The service worker (public/sw.js) shows them; this asks permission and hands
 * the browser's subscription to the server.
 *
 * iPhone and iPad only allow push for an app added to the Home Screen
 * (iOS 16.4+), so there the answer is "install first".
 */
import { api } from '../services/api'

export type PushState = 'unsupported' | 'install-first' | 'denied' | 'off' | 'on'

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true

function keyBytes(base64: string) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from([...raw].map(ch => ch.charCodeAt(0)))
}

function sameKey(a: ArrayBuffer | null, b: Uint8Array) {
  if (!a) return false
  const x = new Uint8Array(a)
  return x.length === b.length && x.every((v, i) => v === b[i])
}

/** The browser can hand a device a new push address; tell the server each time the app opens. */
export async function refreshPushSubscription() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  const reg = await registration()
  const sub = reg ? await reg.pushManager.getSubscription() : null
  if (sub) await api.post('/notifications/push/subscribe', { subscription: sub.toJSON() }).catch(() => {})
}

async function registration() {
  if (!('serviceWorker' in navigator)) return null
  return (await navigator.serviceWorker.getRegistration()) ?? null
}

export async function pushState(): Promise<PushState> {
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  if (!supported) return isIos() && !standalone() ? 'install-first' : 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  const reg = await registration()
  if (!reg) return 'unsupported'
  const sub = await reg.pushManager.getSubscription()
  return sub && Notification.permission === 'granted' ? 'on' : 'off'
}

export async function turnPushOn(): Promise<PushState> {
  const state = await pushState()
  if (state === 'unsupported' || state === 'install-first' || state === 'denied') return state
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off'
  const reg = await navigator.serviceWorker.ready
  const { data } = await api.get('/notifications/push/key')
  const key = keyBytes(data.key)
  let sub = await reg.pushManager.getSubscription()
  // A subscription made under another server key cannot be reused.
  if (sub && !sameKey(sub.options?.applicationServerKey ?? null, key)) { await sub.unsubscribe().catch(() => {}); sub = null }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
  await api.post('/notifications/push/subscribe', { subscription: sub.toJSON() })
  return 'on'
}

export async function turnPushOff(): Promise<PushState> {
  const reg = await registration()
  const sub = reg ? await reg.pushManager.getSubscription() : null
  if (sub) {
    await api.post('/notifications/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {})
    await sub.unsubscribe().catch(() => {})
  }
  return 'off'
}
