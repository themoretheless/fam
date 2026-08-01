import { ref } from 'vue'
import { reactEvent } from '../api.js'

const KEY = 'fam-me'

/** Local "I am player" choice + feed reactions. */
export function useFamMe({ events, showToast }) {
  const famMe = ref(null)
  try {
    const m = localStorage.getItem(KEY)
    if (m === 'p1' || m === 'p2') famMe.value = m
  } catch {
    /* ignore */
  }

  function setFamMe(id) {
    famMe.value = id
    try {
      localStorage.setItem(KEY, id)
    } catch {
      /* ignore */
    }
  }

  async function onReact(ev, emoji, asPlayer) {
    const pid = asPlayer || famMe.value
    if (!pid) return
    try {
      const updated = await reactEvent(ev.id, pid, emoji)
      const i = events.value.findIndex(e => e.id === ev.id)
      if (i >= 0) {
        const next = [...events.value]
        next[i] = { ...next[i], reactions: updated.reactions }
        events.value = next
      }
    } catch (e) {
      showToast(e.message || 'Не получилось')
    }
  }

  return { famMe, setFamMe, onReact }
}
