<!-- Live M0–M3 presentation component. -->
<script setup lang="ts">
import UiIcon from "./UiIcon.vue";
import type { PanelView } from "./panel-view-model";

defineProps<{
  modelValue: PanelView;
  productCount: number;
  findingCount: number;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [view: PanelView];
}>();
</script>

<template>
  <nav class="prototype-navigation" aria-label="分析工作区" :aria-disabled="disabled">
    <button
      type="button"
      :class="{ active: modelValue === 'overview' }"
      :disabled="disabled"
      @click="emit('update:modelValue', 'overview')"
    >
      <UiIcon name="overview" :size="18" />
      <span>概览</span>
    </button>
    <button
      type="button"
      :class="{ active: modelValue === 'products' }"
      :disabled="disabled"
      @click="emit('update:modelValue', 'products')"
    >
      <UiIcon name="products" :size="18" />
      <span>产品</span><b>{{ productCount }}</b>
    </button>
    <button
      type="button"
      :class="{ active: modelValue === 'technology' }"
      :disabled="disabled"
      @click="emit('update:modelValue', 'technology')"
    >
      <UiIcon name="code" :size="18" />
      <span>技术</span><b>{{ findingCount }}</b>
    </button>
  </nav>
</template>
