import { claimTask } from '../api.js'
import { burst, emberBurst, playerColors } from '../confetti.js'
import { playClaim, playCombo, playBurn, playAchievement } from '../sounds.js'
import { clearNotifForTask } from '../notifications.js'
import { REDUCED } from './useReducedMotion.js'

/**
 * Claim flow: optimistic remove, confetti, combo, achievements.
 */
export function useClaim({
  tasks,
  players,
  gains,
  now,
  leaveFx,
  hideFor,
  hiddenIds,
  markPlayersFresh,
  recordClaim,
  showCombo,
  enqueueUnlocks,
  showToast,
  refresh
}) {
  async function onClaim(task, playerId) {
    const wasCritical = task.deadline - now.value < 60_000
    leaveFx.set(task.id, playerId)
    hideFor(task.id)
    tasks.value = tasks.value.filter(t => t.id !== task.id)
    try {
      const res = await claimTask(task.id, playerId)
      clearNotifForTask(task.id)
      markPlayersFresh()
      players.value = res.players
      gains.value = { ...gains.value, [playerId]: { points: res.points, ts: Date.now() } }
      const el = document.querySelector(`[data-player="${playerId}"]`)
      if (el) {
        const r = el.getBoundingClientRect()
        burst(r.left + r.width / 2, r.top + 90, playerColors(playerId))
        if (wasCritical && !REDUCED) {
          emberBurst(r.left + r.width / 2, r.top + r.height / 2)
        }
      }
      if ((res.combo_count ?? 1) >= 2) playCombo()
      else playClaim()
      const cc = res.combo_count ?? 1
      const cm = res.combo_mult ?? 1
      recordClaim(playerId, cc, cm, now.value)
      if (cc >= 2) {
        showCombo(cm)
        burst(window.innerWidth / 2, window.innerHeight / 2, playerColors(playerId))
        burst(window.innerWidth / 2, window.innerHeight / 3, playerColors(playerId))
      }
      if (res.new_achievements?.length) {
        playAchievement()
        enqueueUnlocks(res.new_achievements)
      }
    } catch (e) {
      const msg = e.message || 'Не получилось забрать дело'
      if (/уже сгорело/i.test(msg)) {
        leaveFx.set(task.id, 'burn')
        hideFor(task.id)
        playBurn()
        showToast('Поздно: дело уже сгорело')
        refresh()
        return
      }
      hiddenIds.delete(task.id)
      leaveFx.delete(task.id)
      showToast(msg)
      refresh()
    }
  }

  return { onClaim }
}
