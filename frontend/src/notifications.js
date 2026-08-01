import { isQuietNow } from './quiet.js'

const SENT_KEY = 'fam-notif-sent'

function loadSent() {
  try {
    return JSON.parse(localStorage.getItem(SENT_KEY) || '{}')
  } catch {
    return {}
  }
}

function saveSent(map) {
  try {
    localStorage.setItem(SENT_KEY, JSON.stringify(map))
  } catch {
    /* ignore */
  }
}

export function isNotifGranted() {
  return typeof Notification !== 'undefined' && Notification.permission === 'granted'
}

export function notifPermission() {
  if (typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission
}

export async function requestNotifPermission() {
  if (typeof Notification === 'undefined') return 'unsupported'
  if (Notification.permission === 'granted') return 'granted'
  if (Notification.permission === 'denied') return 'denied'
  return Notification.requestPermission()
}

function markSent(taskId, kind) {
  const map = loadSent()
  map[`${taskId}:${kind}`] = Date.now()
  saveSent(map)
}

function wasSent(taskId, kind) {
  return !!loadSent()[`${taskId}:${kind}`]
}

export function clearNotifForTask(taskId) {
  const map = loadSent()
  let dirty = false
  for (const k of Object.keys(map)) {
    if (k.startsWith(`${taskId}:`)) {
      delete map[k]
      dirty = true
    }
  }
  if (dirty) saveSent(map)
}

/**
 * @param {Array} tasks open tasks
 * @param {number} now server-aligned ms
 */
export function maybeNotifyDeadlines(tasks, now) {
  if (!isNotifGranted() || isQuietNow()) return
  if (typeof document !== 'undefined' && document.visibilityState === 'visible' && document.hasFocus?.()) {
    // critical всё равно можно; urgent только в фоне
  }
  const focused = typeof document !== 'undefined' && document.visibilityState === 'visible'
  for (const t of tasks) {
    const rem = t.deadline - now
    if (rem <= 0) continue
    const total = Math.max(t.deadline - t.created_at, 1)
    const critical = rem <= Math.max(60_000, total * 0.05) || rem <= 60_000
    const urgent = !critical && rem <= Math.max(15 * 60_000, total * 0.15)
    if (critical && !wasSent(t.id, 'critical')) {
      if (focused && rem > 60_000) continue
      try {
        new Notification('Наш быт', {
          body: `🚨 Критично: «${t.title}» · скоро сгорит`,
          tag: t.id,
          renotify: false
        })
      } catch {
        /* ignore */
      }
      markSent(t.id, 'critical')
    } else if (urgent && !wasSent(t.id, 'urgent') && !focused) {
      try {
        new Notification('Наш быт', {
          body: `🔥 Скоро сгорит: «${t.title}»`,
          tag: t.id,
          renotify: false
        })
      } catch {
        /* ignore */
      }
      markSent(t.id, 'urgent')
    }
  }
}

export function updateTitleBadge(tasks, now, baseTitle = 'Наш быт') {
  if (typeof document === 'undefined') return
  let count = 0
  for (const t of tasks) {
    const rem = t.deadline - now
    if (rem <= 0) continue
    const total = Math.max(t.deadline - t.created_at, 1)
    if (rem <= Math.max(15 * 60_000, total * 0.15)) count++
  }
  document.title = count ? `(${count}) ${baseTitle}` : baseTitle
}
