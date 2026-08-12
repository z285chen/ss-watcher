<!-- Live M0–M3 presentation component. -->
<script setup lang="ts">
import { computed } from "vue";

import UiIcon from "./UiIcon.vue";
import type { PanelState } from "./panel-view-model";

const props = defineProps<{
  state: PanelState;
  toolsOpen: boolean;
  status: string;
  productCount: number;
  canScan: boolean;
  canExport: boolean;
  canExportSources: boolean;
  operationBusy: boolean;
  sourceExportBusy: boolean;
  sourceExportProgress: string;
}>();

const emit = defineEmits<{
  primary: [];
  cancelScan: [];
  toggleTools: [];
  exportCsv: [];
  exportJson: [];
  exportSources: [];
  diagnostics: [];
  revoke: [];
}>();

const stateMeta = computed(() => {
  if (props.state === "unauthorized") {
    return { label: "等待授权", tone: "warning", action: "检查授权" };
  }
  if (props.state === "scanning") {
    return { label: "正在扫描", tone: "working", action: "取消扫描" };
  }
  if (props.state === "partial") {
    return { label: "部分完成", tone: "warning", action: "重新扫描" };
  }
  if (props.state === "empty") {
    return { label: "已授权", tone: "working", action: "开始扫描" };
  }
  if (props.state === "readonly") {
    return { label: "只读快照", tone: "warning", action: "检查授权" };
  }
  return { label: "已提交快照", tone: "success", action: "重新扫描" };
});

function triggerPrimary(): void {
  if (props.state === "scanning") {
    emit("cancelScan");
    return;
  }
  emit("primary");
}
</script>

<template>
  <header class="prototype-header">
    <div class="prototype-brand">
      <span class="prototype-brand-mark"><img src="/icons/ss-watcher-48.png" alt="" /></span>
      <strong>SS Watcher</strong>
    </div>

    <div class="prototype-header-actions">
      <div class="prototype-tools">
        <button
          type="button"
          class="header-icon-button"
          :aria-expanded="toolsOpen"
          aria-label="打开工具菜单"
          @click="emit('toggleTools')"
        >
          <UiIcon name="more" :size="19" />
        </button>
        <div v-if="toolsOpen" class="tools-popover" role="menu" aria-label="SS Watcher 工具">
          <div class="tools-popover-heading">
            <span>工具</span>
            <small>当前 committed 快照</small>
          </div>
          <button type="button" role="menuitem" :disabled="!canExport" @click="emit('exportCsv')">
            <UiIcon name="download" :size="15" />
            <span>导出产品 CSV</span>
            <small>含 meta sidecar</small>
          </button>
          <button type="button" role="menuitem" :disabled="!canExport" @click="emit('exportJson')">
            <UiIcon name="file" :size="15" />
            <span>导出完整 JSON</span>
            <small>committed snapshot</small>
          </button>
          <button
            type="button"
            role="menuitem"
            :disabled="!canExportSources || sourceExportBusy"
            @click="emit('exportSources')"
          >
            <UiIcon name="database" :size="15" />
            <span>{{ sourceExportBusy ? "正在导出公开源码" : "导出公开源码" }}</span>
            <small>{{ sourceExportBusy ? sourceExportProgress : "重新验证 capability" }}</small>
          </button>
          <button type="button" role="menuitem" @click="emit('diagnostics')">
            <UiIcon name="diagnostics" :size="15" />
            <span>诊断工具</span>
            <small>授权与运行输出</small>
          </button>
          <button
            type="button"
            role="menuitem"
            class="danger-tool"
            :disabled="state === 'unauthorized' || state === 'readonly'"
            @click="emit('revoke')"
          >
            <UiIcon name="cancel" :size="15" />
            <span>吊销当前会话</span>
            <small>保留快照，只读展示</small>
          </button>
        </div>
      </div>
      <button
        type="button"
        class="prototype-scan-button"
        :class="{ danger: state === 'scanning' }"
        :disabled="state !== 'scanning' && ((state === 'unauthorized' || state === 'readonly') ? operationBusy : !canScan)"
        @click="triggerPrimary"
      >
        <UiIcon :name="state === 'scanning' ? 'cancel' : 'refresh'" :size="16" />
        <span class="prototype-scan-label">{{ stateMeta.action }}</span>
      </button>
    </div>
  </header>

  <div class="prototype-status-line" :class="stateMeta.tone" aria-live="polite">
    <span class="status-orb" aria-hidden="true" />
    <strong>{{ stateMeta.label }}</strong>
    <span class="prototype-live-status">{{ status }}</span>
    <span v-if="productCount > 0" class="prototype-live-count">{{ productCount }} products</span>
  </div>
</template>
