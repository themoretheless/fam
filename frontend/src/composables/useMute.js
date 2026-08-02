import { ref } from 'vue'
import { isMuted, toggleMute } from '../sounds.js'

export function useMute() {
  const muted = ref(isMuted())
  function onToggleMute() {
    const nextMuted = !muted.value
    toggleMute()
    muted.value = nextMuted
  }
  return { muted, onToggleMute }
}
