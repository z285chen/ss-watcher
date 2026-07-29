<!-- Live M0–M3 presentation component. -->
<script setup lang="ts">
import { computed } from "vue";

import UiIcon from "./UiIcon.vue";

const props = defineProps<{
  status: string;
  detail: string;
  productCount: number;
}>();

const emit = defineEmits<{
  cancel: [];
}>();

const activeStage = computed(() => {
  const value = props.status.toLowerCase();
  if (/提交|完成/u.test(value)) return 4;
  if (/资源|前端|统计|价格|best|newness|上新|排序/u.test(value)) return 3;
  if (/目录|产品|catalog|sitemap|collection/u.test(value)) return 2;
  return 1;
});

function stageClass(stage: number): "done" | "active" | "" {
  if (stage < activeStage.value) return "done";
  return stage === activeStage.value ? "active" : "";
}
</script>

<template>
  <section class="prototype-scanning" aria-live="polite">
    <div class="scan-progress-heading">
      <span class="scan-orb"><UiIcon name="radar" :size="18" /></span>
      <div>
        <span class="content-kicker">正在建立公开快照</span>
        <h1>收集店铺与前端信号</h1>
      </div>
    </div>
    <p>{{ status }}</p>
    <small v-if="detail" class="scan-live-detail">{{ detail }}</small>
    <div class="scan-progress-track" aria-label="扫描正在进行"><span /></div>
    <ol class="scan-stage-list">
      <li :class="stageClass(1)">
        <span><UiIcon v-if="activeStage > 1" name="check" :size="14" /><UiIcon v-else name="radar" :size="14" /></span>
        <div><strong>确认授权与 Shopify 信号</strong><small>仅当前已绑定标签页</small></div>
      </li>
      <li :class="stageClass(2)">
        <span><UiIcon v-if="activeStage > 2" name="check" :size="14" /><UiIcon v-else-if="activeStage === 2" name="radar" :size="14" /><template v-else>2</template></span>
        <div><strong>扫描公开产品目录</strong><small>当前已发现 {{ productCount }} 个产品</small></div>
      </li>
      <li :class="stageClass(3)">
        <span><UiIcon v-if="activeStage > 3" name="check" :size="14" /><UiIcon v-else-if="activeStage === 3" name="radar" :size="14" /><template v-else>3</template></span>
        <div><strong>分析公开前端资源</strong><small>同源正文受 ResourcePolicy 约束</small></div>
      </li>
      <li :class="stageClass(4)">
        <span><UiIcon v-if="activeStage === 4" name="radar" :size="14" /><template v-else>4</template></span>
        <div><strong>提交可用快照</strong><small>部分失败不会伪装为成功</small></div>
      </li>
    </ol>
    <button type="button" class="scan-cancel-action" @click="emit('cancel')">
      <UiIcon name="cancel" :size="15" />取消扫描
    </button>
    <div class="skeleton-cluster" aria-hidden="true"><i /><i /><i /></div>
  </section>
</template>
