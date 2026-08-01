import { ref } from 'vue'
import { dur } from './useReducedMotion.js'

/** Fullscreen combo flash overlay. */
export function useComboOverlay() {
  const combo = ref(null)
  let comboTimer = null
  let comboKey = 0

  function showCombo(mult) {
    comboKey += 1
    combo.value = { mult, key: comboKey }
    clearTimeout(comboTimer)
    comboTimer = setTimeout(() => {
      combo.value = null
    }, dur(1200))
  }

  function dispose() {
    clearTimeout(comboTimer)
  }

  return { combo, showCombo, dispose }
}
