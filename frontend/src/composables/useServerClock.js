import { ref } from 'vue'

/** Server-aligned clock for deadlines (SOLID S: isolate time offset). */
export function useServerClock() {
  const now = ref(Date.now())
  let clockOffset = 0

  function applyServerNow(serverNowMs) {
    clockOffset = serverNowMs - Date.now()
    now.value = Date.now() + clockOffset
  }

  function tick() {
    now.value = Date.now() + clockOffset
  }

  function getOffset() {
    return clockOffset
  }

  return { now, applyServerNow, tick, getOffset }
}
