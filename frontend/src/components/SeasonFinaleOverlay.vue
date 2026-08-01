<script setup>
defineProps({
  finale: { type: Object, required: true },
  p1: { type: Object, required: true },
  p2: { type: Object, required: true }
})
defineEmits(['close'])
</script>

<template>
  <div
    class="season-finale-overlay"
    role="dialog"
    aria-label="Сезон закрыт"
    @click="$emit('close')"
  >
    <div class="season-finale-card">
      <div class="season-finale-emoji">🏁</div>
      <h2>Сезон закрыт</h2>
      <p v-if="finale.winnerId">
        👑
        {{ finale.winnerId === 'p1' ? p1.name : p2.name }}
        — чемпион недели!
      </p>
      <p v-else>Ничья!</p>
      <p class="season-finale-scores">
        {{ p1.name }} {{ finale.p1 }} · {{ p2.name }} {{ finale.p2 }}
      </p>
      <p class="season-finale-week">{{ finale.weekKey }}</p>
    </div>
  </div>
</template>
