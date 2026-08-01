import { ref, nextTick } from 'vue'
import { deleteTask, renamePlayer } from '../api.js'

/**
 * In-app rename / delete confirmations (no window.prompt).
 * Needs tasks ref + hideFor for optimistic delete, refresh/showToast/playersFreshAt.
 */
export function useAppModal({
  players,
  tasks,
  hideFor,
  hiddenIds,
  showToast,
  refresh,
  markPlayersFresh
}) {
  const modal = ref(null)
  const renameDraft = ref('')

  function openRename(player) {
    renameDraft.value = player.name
    modal.value = { kind: 'rename', player }
    nextTick(() => {
      const el = document.querySelector('.app-modal-input')
      if (el) {
        el.focus()
        el.select?.()
      }
    })
  }

  function openDelete(task) {
    modal.value = { kind: 'delete', task }
  }

  function closeModal() {
    modal.value = null
  }

  async function confirmDelete() {
    const task = modal.value?.kind === 'delete' ? modal.value.task : null
    closeModal()
    if (!task) return
    hideFor(task.id)
    tasks.value = tasks.value.filter(t => t.id !== task.id)
    try {
      await deleteTask(task.id)
    } catch (e) {
      hiddenIds.delete(task.id)
      showToast(e.message || 'Не получилось удалить дело')
      refresh()
    }
  }

  async function confirmRename() {
    const player = modal.value?.kind === 'rename' ? modal.value.player : null
    const name = renameDraft.value.trim()
    if (!player || !name) return
    closeModal()
    try {
      const res = await renamePlayer(player.id, name)
      markPlayersFresh()
      players.value = res.players
    } catch (e) {
      showToast(e.message || 'Не получилось переименовать')
      refresh()
    }
  }

  return {
    modal,
    renameDraft,
    openRename,
    openDelete,
    closeModal,
    confirmDelete,
    confirmRename
  }
}
