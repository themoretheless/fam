import { computed } from 'vue'

/** Дуэль сезона: доли счёта + countdown до понедельника UTC. */
export function useDuel(p1, p2, now) {
  const duelPct = computed(() => {
    const a = p1.value.score ?? 0
    const b = p2.value.score ?? 0
    const t = a + b
    if (t <= 0) return { p1: 50, p2: 50 }
    return { p1: Math.round((100 * a) / t), p2: Math.round((100 * b) / t) }
  })

  function nextIsoMondayUtc(ms) {
    const d = new Date(ms)
    const day = d.getUTCDay()
    let add = (8 - day) % 7
    if (add === 0) add = 7
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + add, 0, 0, 0)
  }

  const seasonCountdown = computed(() => {
    const end = nextIsoMondayUtc(now.value)
    let left = Math.max(0, end - now.value)
    const days = Math.floor(left / 86400000)
    left -= days * 86400000
    const hours = Math.floor(left / 3600000)
    if (days > 0) return `${days}д ${hours}ч`
    const mins = Math.floor((left % 3600000) / 60000)
    return hours > 0 ? `${hours}ч ${mins}м` : `${mins}м`
  })

  return { duelPct, seasonCountdown }
}
