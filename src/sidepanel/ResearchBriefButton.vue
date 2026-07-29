<script setup lang="ts">
import { ref } from "vue";

import UiIcon from "./UiIcon.vue";

const props = withDefaults(
  defineProps<{
    text: string;
    label?: string;
    compact?: boolean;
  }>(),
  { label: "复制研究摘要", compact: false },
);

const feedback = ref<"idle" | "copied" | "failed">("idle");
let resetTimer: number | undefined;

async function copyBrief(): Promise<void> {
  globalThis.clearTimeout(resetTimer);
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(props.text);
    } else {
      const textarea = document.createElement("textarea");
      textarea.value = props.text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.append(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      textarea.remove();
      if (!copied) throw new Error("copy unavailable");
    }
    feedback.value = "copied";
  } catch {
    feedback.value = "failed";
  }
  resetTimer = globalThis.setTimeout(() => {
    feedback.value = "idle";
  }, 2_200);
}
</script>

<template>
  <button
    type="button"
    class="research-brief-button"
    :class="{ compact }"
    :aria-label="feedback === 'copied' ? '研究摘要已复制' : label"
    @click="copyBrief"
  >
    <UiIcon :name="feedback === 'copied' ? 'check' : 'sparkle'" :size="compact ? 14 : 15" />
    <span>{{ feedback === "copied" ? "已复制" : feedback === "failed" ? "复制失败" : label }}</span>
  </button>
</template>
