import { ref, computed, watch } from 'vue'

const THEME_CYCLE = ['dark', 'paper', 'sketch']
export const THEME_META = {
  dark: { icon: '🌙', title: 'Тёмный стиль' },
  paper: { icon: '✏️', title: 'Бумажный стиль' },
  sketch: { icon: '✍️', title: 'Карандашный стиль' }
}

/** Theme cycle + persistence (SRP). */
export function useTheme() {
  const theme = ref('dark')
  try {
    const saved = localStorage.getItem('fam-theme')
    if (THEME_CYCLE.includes(saved)) theme.value = saved
  } catch {
    /* ignore */
  }

  const nextTheme = computed(
    () => THEME_CYCLE[(THEME_CYCLE.indexOf(theme.value) + 1) % THEME_CYCLE.length]
  )

  watch(
    theme,
    t => {
      document.documentElement.dataset.theme = t
      try {
        localStorage.setItem('fam-theme', t)
      } catch {
        /* ignore */
      }
    },
    { immediate: true }
  )

  function onToggleTheme() {
    theme.value = nextTheme.value
  }

  return { theme, nextTheme, onToggleTheme, THEME_META }
}
