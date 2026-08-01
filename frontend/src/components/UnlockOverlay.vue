<script setup>
defineProps({
  unlock: { type: Object, default: null }
})
const emit = defineEmits(['next'])
</script>

<template>
  <Transition name="unlock" mode="out-in">
    <div v-if="unlock" :key="unlock.id" class="unlock-overlay" aria-live="polite" @click="emit('next')">
      <div class="unlock-card">
        <div class="unlock-ring" aria-hidden="true"></div>
        <div class="unlock-emoji">{{ unlock.emoji }}</div>
        <div class="unlock-label">Ачивка!</div>
        <div class="unlock-title">{{ unlock.title }}</div>
      </div>
    </div>
  </Transition>
</template>
