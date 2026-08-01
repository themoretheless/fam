import { ref, computed, watch, nextTick } from 'vue'

/** SVG chart geometry (14 day slots). */
export const CHART = { w: 560, h: 180, labelH: 18, pad: 8, slot: 40, barW: 12, gap: 2 }

/** Start of the current ISO week (Monday 00:00 UTC). */
export function startOfIsoWeekUtc(ms) {
  const date = new Date(ms)
  const daysSinceMonday = (date.getUTCDay() + 6) % 7
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() - daysSinceMonday,
    0,
    0,
    0
  )
}

/**
 * Stats modal data: 14-day chart, week tiles, arm animation.
 * Depends only on history/now/players + load-balance weekStart.
 */
export function useStats({ history, now, p1, p2 }) {
  const statsOpen = ref(false)
  const statsArmed = ref(false)

  const weekStart = computed(() => startOfIsoWeekUtc(now.value))

  const chartDays = computed(() => {
    const base = new Date(now.value)
    const days = []
    for (let k = 13; k >= 0; k--) {
      const start = new Date(base.getFullYear(), base.getMonth(), base.getDate() - k)
      const end = new Date(base.getFullYear(), base.getMonth(), base.getDate() - k + 1)
      days.push({
        start: +start,
        end: +end,
        label: `${String(start.getDate()).padStart(2, '0')}.${String(start.getMonth() + 1).padStart(2, '0')}`,
        p1: 0,
        p2: 0
      })
    }
    for (const t of history.value) {
      if (t.status !== 'done' || t.finished_at == null) continue
      const d = days.find(d => t.finished_at >= d.start && t.finished_at < d.end)
      if (d && (t.claimed_by === 'p1' || t.claimed_by === 'p2')) d[t.claimed_by] += t.awarded_points ?? 0
    }
    return days
  })

  const chartBars = computed(() => {
    const plotH = CHART.h - CHART.labelH - CHART.pad
    const max = Math.max(1, ...chartDays.value.map(d => Math.max(d.p1, d.p2)))
    const hFor = v => (v > 0 ? Math.max(2, (v / max) * plotH) : 2)
    const inset = (CHART.slot - CHART.barW * 2 - CHART.gap) / 2
    return chartDays.value.map((d, i) => ({
      label: d.label,
      labelX: i * CHART.slot + CHART.slot / 2,
      p1: { x: i * CHART.slot + inset, h: hFor(d.p1) },
      p2: { x: i * CHART.slot + inset + CHART.barW + CHART.gap, h: hFor(d.p2) }
    }))
  })

  const chartActivity = computed(() => {
    const days = chartDays.value.map(d => ({ ...d, doneCount: 0, burnedCount: 0 }))
    for (const t of history.value) {
      if (t.finished_at == null) continue
      const d = days.find(x => t.finished_at >= x.start && t.finished_at < x.end)
      if (!d) continue
      if (t.status === 'done') d.doneCount++
      if (t.status === 'burned') d.burnedCount++
    }
    return days
  })

  const bestDay = computed(() => {
    let best = null
    for (const d of chartDays.value) {
      const total = d.p1 + d.p2
      if (total > 0 && (!best || total > best.total)) best = { label: d.label, total }
    }
    return best
  })

  const totalXp = computed(() => (p1.value.xp ?? 0) + (p2.value.xp ?? 0))

  const avgMult = computed(() => {
    let sum = 0
    let n = 0
    for (const t of history.value) {
      if (t.status !== 'done' || t.finished_at == null || t.finished_at < weekStart.value) continue
      if (!t.base_points || t.awarded_points == null) continue
      sum += t.awarded_points / t.base_points
      n++
    }
    return n ? sum / n : null
  })

  const firefightersWeek = computed(() => {
    let n = 0
    for (const t of history.value) {
      if (t.status !== 'done' || t.finished_at == null || t.finished_at < weekStart.value) continue
      if (t.deadline != null && t.deadline - t.finished_at < 60_000 && t.deadline >= t.finished_at) n++
    }
    return n
  })

  watch(statsOpen, open => {
    statsArmed.value = false
    if (!open) return
    nextTick(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (statsOpen.value) statsArmed.value = true
        })
      })
    })
  })

  function openStats() {
    statsOpen.value = true
  }

  function closeStats() {
    statsOpen.value = false
  }

  return {
    statsOpen,
    statsArmed,
    weekStart,
    chartDays,
    chartBars,
    chartActivity,
    bestDay,
    totalXp,
    avgMult,
    firefightersWeek,
    openStats,
    closeStats,
    CHART
  }
}
