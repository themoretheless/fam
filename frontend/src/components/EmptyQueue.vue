<script setup>
defineProps({
  isFreshHome: Boolean,
  starterBusy: Boolean
})
const emit = defineEmits(['seed'])
</script>

<template>
  <div class="empty" :class="{ start: isFreshHome }">
    <template v-if="isFreshHome">
      <p>🌱 Пока пусто. Добавьте первое дело - и гонка начнётся.</p>
      <button type="button" class="starter-btn" :disabled="starterBusy" @click="emit('seed')">
        ✨ Стартовый набор
      </button>
    </template>
    <p v-else>🎉 Всё сделано! Добавь новое дело.</p>
  </div>
</template>
