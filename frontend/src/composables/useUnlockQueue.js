import { ref } from 'vue'
import { REDUCED } from './useReducedMotion.js'

/** Achievement unlock overlays, one at a time. */
export function useUnlockQueue() {
  const unlockQueue = ref([])
  const unlock = ref(null)
  let unlockTimer = null

  function enqueueUnlocks(list) {
    if (!list?.length) return
    unlockQueue.value.push(...list)
    if (!unlock.value) nextUnlock()
  }

  function nextUnlock() {
    clearTimeout(unlockTimer)
    unlock.value = unlockQueue.value.shift() ?? null
    if (unlock.value) {
      unlockTimer = setTimeout(nextUnlock, REDUCED ? 1400 : 2000)
    }
  }

  function dispose() {
    clearTimeout(unlockTimer)
  }

  return { unlock, unlockQueue, enqueueUnlocks, nextUnlock, dispose }
}
