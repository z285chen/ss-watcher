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

function moveTab(event: KeyboardEvent, offset: -1 | 1): void {
  const current = event.currentTarget;
  if (!(current instanceof HTMLButtonElement) || current.parentElement === null) return;
  const tabs = [...current.parentElement.querySelectorAll<HTMLButtonElement>(
    'button[role="tab"]:not(:disabled)',
  )];
  const index = tabs.indexOf(current);
  if (index < 0 || tabs.length === 0) return;
  event.preventDefault();
  const target = tabs[(index + offset + tabs.length) % tabs.length];
  target?.focus();
  target?.click();
}
</script>

<template>
  <nav class="prototype-navigation" role="tablist" aria-label="分析工作区" :aria-disabled="disabled">
    <button
      type="button"
      role="tab"
      :aria-selected="modelValue === 'overview'"
      :tabindex="modelValue === 'overview' ? 0 : -1"
      :class="{ active: modelValue === 'overview' }"
      :disabled="disabled"
      @click="emit('update:modelValue', 'overview')"
      @keydown.left="moveTab($event, -1)"
      @keydown.right="moveTab($event, 1)"
    >
      <UiIcon name="overview" :size="18" />
      <span>概览</span>
    </button>
    <button
      type="button"
      role="tab"
      :aria-selected="modelValue === 'products'"
      :tabindex="modelValue === 'products' ? 0 : -1"
      :class="{ active: modelValue === 'products' }"
      :disabled="disabled"
      @click="emit('update:modelValue', 'products')"
      @keydown.left="moveTab($event, -1)"
      @keydown.right="moveTab($event, 1)"
    >
      <UiIcon name="products" :size="18" />
      <span>产品</span><b>{{ productCount }}</b>
    </button>
    <button
      type="button"
      role="tab"
      :aria-selected="modelValue === 'technology'"
      :tabindex="modelValue === 'technology' ? 0 : -1"
      :class="{ active: modelValue === 'technology' }"
      :disabled="disabled"
      @click="emit('update:modelValue', 'technology')"
      @keydown.left="moveTab($event, -1)"
      @keydown.right="moveTab($event, 1)"
    >
      <UiIcon name="code" :size="18" />
      <span>技术</span><b>{{ findingCount }}</b>
    </button>
  </nav>
</template>
