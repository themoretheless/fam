import { computed } from 'vue'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/** Group one UTC week's activity by UTC calendar day. */
export function buildWeekDailyBalance(history, weekStart) {
  if (!Array.isArray(history) || !Number.isFinite(weekStart)) return []

  const weekEnd = weekStart + WEEK_MS
  if (!Number.isFinite(weekEnd) || Number.isNaN(new Date(weekStart).getTime())) return []

  const byDate = new Map()

  for (const task of history) {
    const finishedAt = task?.finished_at
    if (
      !Number.isFinite(finishedAt) ||
      finishedAt < weekStart ||
      finishedAt >= weekEnd ||
      Number.isNaN(new Date(finishedAt).getTime())
    ) {
      continue
    }

    const isDone = task.status === 'done' && (task.claimed_by === 'p1' || task.claimed_by === 'p2')
    const isBurned = task.status === 'burned'
    if (!isDone && !isBurned) continue

    const date = new Date(finishedAt).toISOString().slice(0, 10)
    let day = byDate.get(date)
    if (!day) {
      day = {
        date,
        label: `${date.slice(8, 10)}.${date.slice(5, 7)}`,
        p1: { doneCount: 0, awardedPoints: 0 },
        p2: { doneCount: 0, awardedPoints: 0 },
        burnedCount: 0
      }
      byDate.set(date, day)
    }

    if (isBurned) {
      day.burnedCount += 1
      continue
    }

    day[task.claimed_by].doneCount += 1
    if (Number.isFinite(task.awarded_points)) {
      day[task.claimed_by].awardedPoints += task.awarded_points
    }
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

/** Fairness: доли дел и перекос за неделю. */
export function useLoadBalance(history, weekStart) {
  const weekDailyBalance = computed(() => buildWeekDailyBalance(history.value, weekStart.value))

  const weekDone = computed(() => {
    const result = { p1: 0, p2: 0 }
    for (const day of weekDailyBalance.value) {
      result.p1 += day.p1.doneCount
      result.p2 += day.p2.doneCount
    }
    return result
  })

  const weekBurned = computed(() =>
    weekDailyBalance.value.reduce((total, day) => total + day.burnedCount, 0)
  )

  const weekTotalDone = computed(() => weekDone.value.p1 + weekDone.value.p2)

  const weekShare = id => {
    const t = weekTotalDone.value
    if (t < 1) return null
    return Math.round((100 * weekDone.value[id]) / t)
  }

  const loadSkew = computed(() => {
    const t = weekTotalDone.value
    if (t < 5) return false
    const min = Math.min(weekDone.value.p1, weekDone.value.p2)
    return min / t < 0.35
  })

  return { weekDone, weekBurned, weekDailyBalance, weekShare, loadSkew }
}
