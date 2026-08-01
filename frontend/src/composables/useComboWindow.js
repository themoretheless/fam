import { ref } from 'vue'

/** Локальные комбо-окна 60 мин после claim. */
export function useComboWindow() {
  const comboWindows = ref({ p1: null, p2: null })

  function recordClaim(playerId, count, mult, nowMs) {
    comboWindows.value = {
      ...comboWindows.value,
      [playerId]: {
        until: nowMs + 60 * 60 * 1000,
        mult: mult ?? 1,
        count: count ?? 1
      }
    }
  }

  function comboChip(id, nowMs) {
    const w = comboWindows.value[id]
    if (!w || w.count < 2) return null
    const left = w.until - nowMs
    if (left <= 0) return null
    const mm = Math.floor(left / 60000)
    const ss = Math.floor((left % 60000) / 1000)
    return {
      mult: w.mult,
      text: `🔥 ×${w.mult} · ${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`,
      expiring: left < 5 * 60_000
    }
  }

  return { comboWindows, recordClaim, comboChip }
}
