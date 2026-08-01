import { ref } from 'vue'
import { getQuietConfig, setQuietConfig } from '../quiet.js'
import { requestNotifPermission, notifPermission } from '../notifications.js'

/** Quiet hours toggle + notification permission. */
export function useQuietControls() {
  const quietCfg = ref(getQuietConfig())
  const notifPerm = ref(notifPermission())

  function onToggleQuiet() {
    quietCfg.value = { ...quietCfg.value, enabled: !quietCfg.value.enabled }
    setQuietConfig(quietCfg.value)
  }

  async function onEnableNotif() {
    notifPerm.value = await requestNotifPermission()
  }

  return { quietCfg, notifPerm, onToggleQuiet, onEnableNotif }
}
