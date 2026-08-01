import { ref } from 'vue'
import { burst, playerColors } from '../confetti.js'
import { playAchievement } from '../sounds.js'
import { REDUCED } from './useReducedMotion.js'

/** Detect week_key change and show season finale overlay. */
export function useSeasonFinale({ enqueueUnlocks }) {
  const seasonFinale = ref(null)
  let prevWeekKeySeen = ''
  let seasonFinaleTimer = null

  function applyWeekChange({ nextWeek, seasons, players, achievements }) {
    if (prevWeekKeySeen && nextWeek && nextWeek !== prevWeekKeySeen && players.length) {
      const last = (seasons ?? [])[0]
      if (last) {
        seasonFinale.value = {
          weekKey: last.week_key,
          winnerId: last.winner,
          p1: last.p1_score,
          p2: last.p2_score
        }
        playAchievement()
        if (!REDUCED && last.winner) {
          burst(window.innerWidth / 2, window.innerHeight / 3, playerColors(last.winner))
        }
        clearTimeout(seasonFinaleTimer)
        seasonFinaleTimer = setTimeout(
          () => {
            seasonFinale.value = null
          },
          REDUCED ? 1400 : 2800
        )
        // All newly appeared achievements (week_winner, zero_fires, …)
        const before = new Set(achievements.current.map(a => a.id))
        const fresh = (achievements.next ?? []).filter(a => !before.has(a.id))
        if (fresh.length) enqueueUnlocks(fresh)
      }
    }
    if (nextWeek) prevWeekKeySeen = nextWeek
  }

  function closeFinale() {
    seasonFinale.value = null
  }

  function dispose() {
    clearTimeout(seasonFinaleTimer)
  }

  return { seasonFinale, applyWeekChange, closeFinale, dispose }
}
