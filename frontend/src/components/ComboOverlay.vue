<script setup>
defineProps({
  combo: { type: Object, default: null }
})
</script>

<template>
  <Transition name="combo">
    <div v-if="combo" :key="combo.key" class="combo-overlay" aria-hidden="true">
      <div class="combo-text">🔥 КОМБО ×{{ combo.mult }}</div>
    </div>
  </Transition>
</template>
