<!-- Live M0–M3 presentation component. -->
<script setup lang="ts">
import UiIcon from "./UiIcon.vue";

defineProps<{
  authorized: boolean;
  status: string;
  detail: string;
}>();

const emit = defineEmits<{
  primary: [];
}>();
</script>

<template>
  <section class="prototype-empty-state" aria-labelledby="empty-title">
    <div class="empty-radar"><UiIcon name="radar" :size="31" /></div>
    <span class="content-kicker">{{ authorized ? "当前标签已授权" : "当前标签未授权" }}</span>
    <h1 id="empty-title">{{ authorized ? "建立第一个公开快照" : "先从公开店铺开始" }}</h1>
    <p v-if="authorized">当前会话已经绑定到所选标签页，可以读取公开目录与受 ResourcePolicy 约束的前端资源。</p>
    <p v-else>回到要分析的公开 Shopify 店铺标签页，点击扩展图标后再检查授权。面板本身不会取得新的 activeTab 权限。</p>
    <button type="button" class="primary-empty-action" @click="emit('primary')">
      <UiIcon :name="authorized ? 'refresh' : 'shield'" :size="17" />
      {{ authorized ? "开始扫描" : "重新检查授权" }}
    </button>
    <p class="empty-runtime-status">{{ status }}</p>
    <p v-if="detail" class="empty-runtime-detail">{{ detail }}</p>
    <div class="empty-boundary-list">
      <span><UiIcon name="lock" :size="14" />不携带登录凭证</span>
      <span><UiIcon name="globe" :size="14" />仅处理公开页面</span>
      <span><UiIcon name="sparkle" :size="14" />不向 AI 上传数据</span>
    </div>
  </section>
</template>
