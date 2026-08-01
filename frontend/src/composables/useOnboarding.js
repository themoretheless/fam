import { ref, computed } from 'vue'
import { createTask, renamePlayer } from '../api.js'
import { playAdd } from '../sounds.js'

const ONBOARD_KEY = 'fam-onboard-names'
const PHONE_KEY = 'fam-phone-hint-dismissed'
const STARTER_KEY = 'fam-starter-used'

export const STARTER_TASKS = [
  { title: 'Помыть посуду', emoji: '🍽️', base_points: 10, hours: 6, repeat: false },
  { title: 'Вынести мусор', emoji: '🗑️', base_points: 15, hours: 12, repeat: false },
  { title: 'Протереть стол', emoji: '🧹', base_points: 10, hours: 24, repeat: false }
]

/** First-run rename, phone hint, starter pack. */
export function useOnboarding({ p1, p2, sortedTasks, history, events, showToast, refresh }) {
  const onboardNamesOpen = ref(false)
  const onboardNameP1 = ref('')
  const onboardNameP2 = ref('')
  const phoneHintDismissed = ref(false)
  const starterBusy = ref(false)

  try {
    phoneHintDismissed.value = localStorage.getItem(PHONE_KEY) === '1'
  } catch {
    /* ignore */
  }

  const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
  const showPhoneHint = computed(() => isLoopback && !phoneHintDismissed.value)

  const isFreshHome = computed(
    () =>
      !sortedTasks.value.length &&
      !(history.value?.length) &&
      !(events.value?.length) &&
      (p1.value.score ?? 0) === 0 &&
      (p2.value.score ?? 0) === 0 &&
      (p1.value.xp ?? 0) === 0 &&
      (p2.value.xp ?? 0) === 0
  )

  function dismissPhoneHint() {
    phoneHintDismissed.value = true
    try {
      localStorage.setItem(PHONE_KEY, '1')
    } catch {
      /* ignore */
    }
  }

  function maybeOpenOnboardNames() {
    try {
      if (localStorage.getItem(ONBOARD_KEY) === '1') return
    } catch {
      /* ignore */
    }
    if (p1.value.name === 'Игрок 1' && p2.value.name === 'Игрок 2') {
      onboardNameP1.value = ''
      onboardNameP2.value = ''
      onboardNamesOpen.value = true
    }
  }

  function finishOnboardNames() {
    onboardNamesOpen.value = false
    try {
      localStorage.setItem(ONBOARD_KEY, '1')
    } catch {
      /* ignore */
    }
  }

  async function submitOnboardNames() {
    const n1 = onboardNameP1.value.trim()
    const n2 = onboardNameP2.value.trim()
    if (!n1 && !n2) {
      showToast('Введите хотя бы одно имя')
      return
    }
    try {
      if (n1) await renamePlayer('p1', n1)
      if (n2) await renamePlayer('p2', n2)
      await refresh()
      finishOnboardNames()
    } catch (e) {
      showToast(e.message || 'Не получилось сохранить имена')
    }
  }

  async function seedStarter() {
    if (starterBusy.value) return
    starterBusy.value = true
    let ok = 0
    try {
      for (const item of STARTER_TASKS) {
        await createTask(item)
        ok++
      }
      playAdd()
      try {
        localStorage.setItem(STARTER_KEY, '1')
      } catch {
        /* ignore */
      }
      await refresh()
    } catch (e) {
      showToast(ok ? `Добавлено ${ok} из 3: ${e.message}` : e.message || 'Не получилось')
      refresh()
    } finally {
      starterBusy.value = false
    }
  }

  return {
    onboardNamesOpen,
    onboardNameP1,
    onboardNameP2,
    showPhoneHint,
    isFreshHome,
    starterBusy,
    dismissPhoneHint,
    maybeOpenOnboardNames,
    finishOnboardNames,
    submitOnboardNames,
    seedStarter
  }
}
