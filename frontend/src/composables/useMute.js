import { ref } from 'vue'
import { isMuted, toggleMute } from '../sounds.js'

export function useMute() {
  const muted = ref(isMuted())
  function onToggleMute() {
    muted.value = toggleMute()
  }
  return { muted, onToggleMute }
}
