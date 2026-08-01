import { ref } from 'vue'

const KEY = 'fam-swipe-hint-seen'

/** One-shot swipe coach on first task card. */
export function useSwipeCoach() {
  const swipeCoachSeen = ref(false)
  try {
    swipeCoachSeen.value = localStorage.getItem(KEY) === '1'
  } catch {
    /* ignore */
  }

  function onSwipeCoachDone() {
    swipeCoachSeen.value = true
    try {
      localStorage.setItem(KEY, '1')
    } catch {
      /* ignore */
    }
  }

  return { swipeCoachSeen, onSwipeCoachDone }
}
