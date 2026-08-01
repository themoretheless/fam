import { ref } from 'vue'
import { playError } from '../sounds.js'

/** Ephemeral error/info toast. */
export function useToast(ms = 3500) {
  const toast = ref('')
  let timer

  function showToast(msg) {
    playError()
    toast.value = msg
    clearTimeout(timer)
    timer = setTimeout(() => {
      toast.value = ''
    }, ms)
  }

  function dispose() {
    clearTimeout(timer)
  }

  return { toast, showToast, dispose }
}
