import { ref, onMounted, onUnmounted } from 'vue'
import { fetchState } from '../api.js'
import { maybeNotifyDeadlines, updateTitleBadge } from '../notifications.js'
import { useServerClock } from './useServerClock.js'

const BUILD_SSE_ENABLED = import.meta.env.VITE_FAM_SSE_ENABLED !== 'false'

/**
 * Core game state + poll refresh, with SSE enabled where the runtime supports it.
 * Clock offset lives in useServerClock (SRP).
 */
export function useFamSync({
  hiddenIds,
  checkBurns,
  applyWeekChange,
  onAfterRefresh,
  fetchStateFn = fetchState,
  sseEnabled = BUILD_SSE_ENABLED
}) {
  const players = ref([])
  const tasks = ref([])
  const events = ref([])
  const weekKey = ref('')
  const seasons = ref([])
  const offline = ref(false)
  const gains = ref({ p1: null, p2: null })
  const achievements = ref([])
  const history = ref([])
  const familyShelf = ref([])
  const memorableDates = ref([])
  const syncError = ref('')

  const { now, applyServerNow, tick, getOffset } = useServerClock()

  let requestedGeneration = 0
  let playersFreshThroughGeneration = 0
  let refreshPromise = null
  let disposed = false
  let ticker
  let poller
  let es = null

  function markPlayersFresh() {
    playersFreshThroughGeneration = requestedGeneration
  }

  async function runRefreshLoop() {
    while (!disposed) {
      const generation = requestedGeneration
      let state
      let failure = null
      try {
        state = await fetchStateFn()
      } catch (error) {
        failure = error
      }

      if (disposed) return false
      // A demand that arrived while this request was in flight mandates a trailing fetch.
      if (generation !== requestedGeneration) continue
      if (failure) {
        offline.value = true
        syncError.value = failure?.message || ''
        return false
      }

      applyServerNow(state.server_now)
      const nextWeek = state.week_key ?? ''
      // A rollover is authoritative even while optimistic claim/rename players are protected.
      const weekChanged = weekKey.value && nextWeek && nextWeek !== weekKey.value
      if (weekChanged || generation > playersFreshThroughGeneration) {
        players.value = state.players
      }
      tasks.value = state.tasks.filter(task => !hiddenIds.has(task.id))
      events.value = state.events
      applyWeekChange({
        nextWeek,
        seasons: state.seasons,
        players: players.value,
        achievements: {
          current: achievements.value,
          next: state.achievements ?? []
        }
      })
      weekKey.value = nextWeek
      seasons.value = state.seasons ?? []
      achievements.value = state.achievements ?? []
      history.value = state.history ?? []
      familyShelf.value = state.family_shelf ?? []
      memorableDates.value = state.memorable_dates ?? []
      offline.value = false
      syncError.value = ''
      maybeNotifyDeadlines(tasks.value, now.value)
      updateTitleBadge(tasks.value, now.value)
      onAfterRefresh?.(state)

      // A callback may synchronously demand another refresh; do not lose it during cleanup.
      if (generation !== requestedGeneration) continue
      return true
    }
    return false
  }

  function refresh() {
    if (disposed) return Promise.resolve(false)
    requestedGeneration += 1
    if (!refreshPromise) {
      refreshPromise = runRefreshLoop().finally(() => {
        refreshPromise = null
      })
    }
    return refreshPromise
  }

  function startLoop({ onTickExtra } = {}) {
    onMounted(() => {
      disposed = false
      let firstRefreshApplied = false
      const loopRefresh = () =>
        refresh().then(applied => {
          if (applied && !firstRefreshApplied) {
            firstRefreshApplied = true
            onTickExtra?.afterFirstRefresh?.()
          }
          return applied
        })
      loopRefresh()
      ticker = setInterval(() => {
        tick()
        checkBurns()
        maybeNotifyDeadlines(tasks.value, now.value)
        updateTitleBadge(tasks.value, now.value)
      }, 1000)
      poller = setInterval(loopRefresh, 15000)
      if (BUILD_SSE_ENABLED && sseEnabled) {
        es = new EventSource('/api/stream')
        es.onmessage = loopRefresh
        es.onerror = () => {
          loopRefresh()
        }
      }
      onTickExtra?.onMount?.()
    })
    onUnmounted(() => {
      disposed = true
      requestedGeneration += 1
      clearInterval(ticker)
      clearInterval(poller)
      if (es) es.close()
      onTickExtra?.onUnmount?.()
    })
  }

  return {
    players,
    tasks,
    events,
    weekKey,
    seasons,
    now,
    offline,
    gains,
    achievements,
    history,
    familyShelf,
    memorableDates,
    syncError,
    markPlayersFresh,
    refresh,
    startLoop,
    getClockOffset: getOffset
  }
}
