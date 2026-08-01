<script setup>
defineProps({
  open: Boolean,
  p1: { type: Object, required: true },
  p2: { type: Object, required: true },
  nameP1: { type: String, default: '' },
  nameP2: { type: String, default: '' }
})
const emit = defineEmits(['update:nameP1', 'update:nameP2', 'later', 'submit'])
</script>

<template>
  <div v-if="open" class="app-modal-overlay" role="dialog" aria-modal="true" aria-label="Переименуйте героев">
    <div class="app-modal-card">
      <h3>Переименуйте героев</h3>
      <p class="app-modal-sub">Так понятнее, кто набрал очки</p>
      <label class="app-modal-label">{{ p1.avatar }} Игрок 1</label>
      <input
        class="app-modal-input"
        maxlength="24"
        placeholder="Как зовут?"
        :value="nameP1"
        @input="emit('update:nameP1', $event.target.value)"
      />
      <label class="app-modal-label">{{ p2.avatar }} Игрок 2</label>
      <input
        class="app-modal-input"
        maxlength="24"
        placeholder="Как зовут?"
        :value="nameP2"
        @input="emit('update:nameP2', $event.target.value)"
        @keydown.enter="emit('submit')"
      />
      <div class="app-modal-actions">
        <button type="button" class="app-modal-btn ghost" @click="emit('later')">Позже</button>
        <button type="button" class="app-modal-btn primary" @click="emit('submit')">Готово</button>
      </div>
    </div>
  </div>
</template>
