<script setup>
defineProps({
  modal: { type: Object, default: null },
  renameDraft: { type: String, default: '' }
})
const emit = defineEmits(['close', 'update:renameDraft', 'confirm-rename', 'confirm-delete'])
</script>

<template>
  <div
    v-if="modal"
    class="app-modal-overlay"
    role="dialog"
    aria-modal="true"
    :aria-label="modal.kind === 'rename' ? 'Переименовать игрока' : 'Удалить дело'"
    @click.self="emit('close')"
  >
    <div class="app-modal-card" :class="modal.kind === 'delete' ? 'app-modal-danger' : ''">
      <template v-if="modal.kind === 'rename'">
        <h3>Как зовут?</h3>
        <p class="app-modal-sub">{{ modal.player.avatar }} сейчас: {{ modal.player.name }}</p>
        <input
          class="app-modal-input"
          maxlength="24"
          autofocus
          :value="renameDraft"
          @input="emit('update:renameDraft', $event.target.value)"
          @keydown.enter="emit('confirm-rename')"
          @keydown.escape="emit('close')"
        />
        <div class="app-modal-actions">
          <button type="button" class="app-modal-btn ghost" @click="emit('close')">Отмена</button>
          <button
            type="button"
            class="app-modal-btn primary"
            :disabled="!renameDraft.trim()"
            @click="emit('confirm-rename')"
          >
            Сохранить
          </button>
        </div>
      </template>
      <template v-else-if="modal.kind === 'delete'">
        <h3>Удалить дело?</h3>
        <p class="app-modal-sub">{{ modal.task.emoji }} «{{ modal.task.title }}»</p>
        <div class="app-modal-actions">
          <button type="button" class="app-modal-btn ghost" @click="emit('close')">Отмена</button>
          <button type="button" class="app-modal-btn danger" @click="emit('confirm-delete')">Удалить</button>
        </div>
      </template>
    </div>
  </div>
</template>
