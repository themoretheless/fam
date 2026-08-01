const KEY = 'fam-quiet'

/** @returns {{ enabled: boolean, start: string, end: string }} */
export function getQuietConfig() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { enabled: false, start: '22:00', end: '08:00' }
    const o = JSON.parse(raw)
    return {
      enabled: !!o.enabled,
      start: o.start || '22:00',
      end: o.end || '08:00'
    }
  } catch {
    return { enabled: false, start: '22:00', end: '08:00' }
  }
}

export function setQuietConfig(cfg) {
  try {
    localStorage.setItem(KEY, JSON.stringify(cfg))
  } catch {
    /* ignore */
  }
}

function parseHm(hm) {
  const [h, m] = String(hm).split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/** Локальные quiet hours (окно может пересекать полночь). */
export function isQuietNow(date = new Date()) {
  const cfg = getQuietConfig()
  if (!cfg.enabled) return false
  const cur = date.getHours() * 60 + date.getMinutes()
  const a = parseHm(cfg.start)
  const b = parseHm(cfg.end)
  if (a === b) return false
  if (a < b) return cur >= a && cur < b
  // 22:00–08:00
  return cur >= a || cur < b
}
