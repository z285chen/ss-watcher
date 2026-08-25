<script setup lang="ts">
import { computed, ref } from "vue";

import type { DesignIntelligenceResult } from "../core/design/design-intelligence";
import type { InteractionActionKind, NodeRole } from "../core/design/evidence-package";
import { toPanelDesignView } from "./design-view-model";
import UiIcon from "./UiIcon.vue";

const props = defineProps<{
  result: DesignIntelligenceResult;
  captureEnabled: boolean;
  captureBusy: boolean;
  captureCancelable: boolean;
  captureStatus: string;
  capturedViewports: readonly string[];
  activeViewportScope: readonly ("desktop" | "tablet" | "mobile")[];
  preparedViewport?: "desktop" | "tablet" | "mobile";
  detachedControllerEnabled: boolean;
  states: readonly Readonly<{ stateId: string; label: string }> [];
  activeStateId: string;
  activeStateContract: string;
  canRecordState: boolean;
  canDeleteState: boolean;
  packageReady: boolean;
  hasEvidenceSession: boolean;
}>();

const emit = defineEmits<{
  capture: [viewport: "desktop" | "tablet" | "mobile"];
  cancelCapture: [];
  exportPackage: [];
  clearSession: [];
  openDetachedController: [];
  recordState: [input: Readonly<{ actionKind: InteractionActionKind; targetRole: NodeRole; viewportScope: readonly ("desktop" | "tablet" | "mobile")[] }>];
  deleteState: [];
  selectState: [stateId: string];
}>();

const view = computed(() => toPanelDesignView(props.result));
const expanded = ref(false);
const probeExpanded = ref(false);
const interactionAction = ref<InteractionActionKind>("activate");
const interactionTargetRole = ref<NodeRole>("button");
const interactionViewportScope = ref<"desktop" | "tablet-mobile" | "mobile" | "all">("desktop");
const selectedViewportScope = computed<readonly ("desktop" | "tablet" | "mobile")[]>(() => {
  if (interactionViewportScope.value === "all") return ["desktop", "tablet", "mobile"];
  if (interactionViewportScope.value === "tablet-mobile") return ["tablet", "mobile"];
  return [interactionViewportScope.value];
});
</script>

<template>
  <section class="design-intelligence" aria-labelledby="design-intelligence-title">
    <header class="design-intelligence-header">
      <span class="design-intelligence-icon"><UiIcon name="sparkle" :size="18" /></span>
      <div>
        <span class="content-kicker">AGENT IMPLEMENTATION + UX EVIDENCE · GATE 4</span>
        <h2 id="design-intelligence-title">.ssw-design 采集器</h2>
        <p>单页面 · 1440 / 768 / 390 · 默认态 + 最多 5 个用户确认交互态</p>
      </div>
      <span class="design-status-chip" :class="view.status">{{ view.statusLabel }}</span>
    </header>

    <section class="design-capture-workflow" aria-labelledby="design-capture-title">
      <div class="design-section-heading">
        <h3 id="design-capture-title">实现证据包</h3>
        <span>本地临时保存 7 天</span>
      </div>
      <p>将浏览器内容区调整到目标宽度，再逐个采集。每次只会有界滚动、等待和截图，结束后恢复原位置。</p>
      <button
        v-if="detachedControllerEnabled"
        type="button"
        class="design-detached-controller"
        :disabled="captureBusy"
        @click="emit('openDetachedController')"
      >
        <UiIcon name="external" :size="14" />打开独立采集控制器
      </button>
      <div class="design-state-controls">
        <label>
          <span>证据状态</span>
          <select :value="activeStateId" :disabled="captureBusy || preparedViewport !== undefined" @change="emit('selectState', ($event.target as HTMLSelectElement).value)">
            <option v-for="state in states" :key="state.stateId" :value="state.stateId">{{ state.label }}</option>
          </select>
        </label>
        <p class="design-active-state-contract">{{ activeStateContract }}</p>
        <label>
          <span>下一交互动作</span>
          <select v-model="interactionAction" :disabled="captureBusy || preparedViewport !== undefined">
            <option value="activate">激活 / 点击</option>
            <option value="toggle">展开 / 切换</option>
            <option value="select">选择</option>
            <option value="dismiss">关闭 / 取消</option>
            <option value="navigate">导航</option>
            <option value="scroll">滚动触发</option>
            <option value="hover">悬停</option>
            <option value="focus">聚焦</option>
            <option value="other">其他</option>
          </select>
        </label>
        <label>
          <span>下一目标角色</span>
          <select v-model="interactionTargetRole" :disabled="captureBusy || preparedViewport !== undefined">
            <option value="button">按钮</option>
            <option value="link">链接</option>
            <option value="navigation">导航</option>
            <option value="dialog">弹窗</option>
            <option value="textbox">输入控件</option>
            <option value="region">内容区域</option>
            <option value="unknown">未知</option>
          </select>
        </label>
        <label>
          <span>下一视口范围</span>
          <select v-model="interactionViewportScope" :disabled="captureBusy || preparedViewport !== undefined">
            <option value="desktop">仅桌面</option>
            <option value="tablet-mobile">平板 + 手机</option>
            <option value="mobile">仅手机</option>
            <option value="all">全部三视口</option>
          </select>
        </label>
        <button type="button" :disabled="!canRecordState || captureBusy || preparedViewport !== undefined" @click="emit('recordState', { actionKind: interactionAction, targetRole: interactionTargetRole, viewportScope: selectedViewportScope })">
          <UiIcon name="check" :size="14" />从当前状态建立下一交互态
        </button>
        <button
          v-if="canDeleteState"
          type="button"
          class="design-state-delete"
          :disabled="captureBusy || preparedViewport !== undefined"
          @click="emit('deleteState')"
        >删除当前误建交互态</button>
      </div>
      <p class="design-state-guidance">上方“下一交互”字段只用于新建后继状态，不会改写当前状态合同。先完成当前来源状态所需视口，再手动触发页面交互并建立新状态；SS Watcher 不会替你点击，也不会把未观察的退出、重置或重放能力写成事实。</p>
      <div class="design-viewport-actions">
        <button
          v-for="viewport in ([['desktop', '桌面 1440'], ['tablet', '平板 768'], ['mobile', '手机 390']] as const)"
          :key="viewport[0]"
          type="button"
          :disabled="!captureEnabled || captureBusy || !activeViewportScope.includes(viewport[0]) || (preparedViewport !== undefined && preparedViewport !== viewport[0])"
          :class="{ captured: capturedViewports.includes(viewport[0]) }"
          @click="emit('capture', viewport[0])"
        >
          <UiIcon :name="capturedViewports.includes(viewport[0]) ? 'check' : 'radar'" :size="14" />
          {{ preparedViewport === viewport[0] ? `确认采集 ${viewport[1]}` : viewport[1] }}
        </button>
      </div>
      <p class="design-state-guidance">三个按钮使用同一套临时视口模拟；无需调整窗口，也无需关闭或重新打开侧栏。Chrome 会在采集期间显示调试提示，结束后自动断开。</p>
      <p class="design-capture-status" role="status">{{ captureStatus || '尚未建立 v2 采集会话' }}</p>
      <button
        v-if="captureCancelable"
        type="button"
        class="design-capture-cancel"
        @click="emit('cancelCapture')"
      >
        安全停止采集
      </button>
      <div class="design-capture-footer">
        <button type="button" :disabled="!packageReady || captureBusy || preparedViewport !== undefined" @click="emit('exportPackage')">
          <UiIcon name="download" :size="14" />导出 .ssw-design
        </button>
        <button v-if="hasEvidenceSession" type="button" :disabled="captureBusy || preparedViewport !== undefined" @click="emit('clearSession')">清除本次证据</button>
      </div>
    </section>

    <button
      type="button"
      class="design-details-toggle"
      :aria-expanded="probeExpanded"
      @click="probeExpanded = !probeExpanded"
    >
      <span><UiIcon name="sliders" :size="15" />{{ probeExpanded ? "收起辅助样式探针" : "查看辅助样式探针（不属于导出合同）" }}</span>
      <UiIcon :name="probeExpanded ? 'chevron-up' : 'chevron-down'" :size="15" />
    </button>

    <template v-if="probeExpanded">

    <template v-if="view.status === 'failed'">
      <div class="design-failure" role="status">
        <UiIcon name="alert" :size="16" />
        <p>
          <strong>本次没有可展示的视觉样本</strong>
          <span>{{ view.errors.join(" · ") }}</span>
        </p>
      </div>
    </template>

    <template v-else>
      <div class="design-coverage">
        <p>
          <strong>{{ view.coverageLabel }}</strong>
          <small>{{ view.durationLabel }} · {{ view.analyzerVersion }}</small>
        </p>
        <span v-for="metric in view.metrics" :key="metric.label">
          <small>{{ metric.label }}</small><strong>{{ metric.value }}</strong>
        </span>
      </div>

      <div v-if="view.warnings.length > 0" class="design-warnings">
        <UiIcon name="alert" :size="15" />
        <div>
          <strong>覆盖限制</strong>
          <span v-for="warning in view.warnings" :key="warning">{{ warning }}</span>
        </div>
      </div>

      <div class="design-evidence-grid">
        <section class="design-evidence-section design-colors">
          <div class="design-section-heading">
            <h3>颜色</h3><span>{{ view.colors.length }} 个高频样本</span>
          </div>
          <div v-if="view.colors.length > 0" class="design-color-grid">
            <div v-for="color in view.colors" :key="`${color.value}:${color.contextLabel}`">
              <span class="design-color-swatch" :style="{ backgroundColor: color.value }" />
              <p><code>{{ color.value }}</code><small>{{ color.count }} 次 · {{ color.contextLabel || "other" }}</small></p>
            </div>
          </div>
          <p v-else class="design-empty-copy">当前样本没有可展示颜色。</p>
        </section>

        <section class="design-evidence-section">
          <div class="design-section-heading">
            <h3>字体层级</h3><span>{{ view.typography.length }} 组</span>
          </div>
          <div v-if="view.typography.length > 0" class="design-typography-list">
            <div v-for="style in view.typography" :key="`${style.fontFamily}:${style.fontSize}:${style.fontWeight}:${style.lineHeight}`">
              <strong :style="{ fontFamily: style.fontFamily }">Aa</strong>
              <p><code>{{ style.fontFamily }}</code><small>{{ style.fontSize }} · {{ style.fontWeight }} · line {{ style.lineHeight }}</small></p>
              <span>{{ style.count }}×</span>
            </div>
          </div>
          <p v-else class="design-empty-copy">当前样本没有可展示字体。</p>
        </section>

        <section class="design-evidence-section">
          <div class="design-section-heading"><h3>节奏与形状</h3></div>
          <div class="design-token-group">
            <span>间距</span>
            <div><code v-for="token in view.spacing" :key="`space:${token.value}`">{{ token.value }} <small>{{ token.count }}</small></code></div>
          </div>
          <div class="design-token-group">
            <span>圆角</span>
            <div><code v-for="token in view.radii" :key="`radius:${token.value}`">{{ token.value }} <small>{{ token.count }}</small></code><em v-if="view.radii.length === 0">未发现</em></div>
          </div>
          <div class="design-token-group">
            <span>阴影</span>
            <div><code v-for="token in view.shadows" :key="`shadow:${token.value}`">{{ token.value }} <small>{{ token.count }}</small></code><em v-if="view.shadows.length === 0">未发现</em></div>
          </div>
        </section>

        <section class="design-evidence-section">
          <div class="design-section-heading">
            <h3>响应式断点</h3><span>{{ view.breakpoints.length }} 组</span>
          </div>
          <div class="design-breakpoint-list">
            <code v-for="breakpoint in view.breakpoints" :key="breakpoint.label">{{ breakpoint.label }} <small>{{ breakpoint.count }}</small></code>
          </div>
          <p v-if="view.breakpoints.length === 0" class="design-empty-copy">可读 CSS 中没有 px 断点证据。</p>
        </section>
      </div>

      <section class="design-evidence-section design-components">
        <div class="design-section-heading">
          <h3>组件样式变体</h3><span>{{ view.components.length }} 组</span>
        </div>
        <div v-if="view.components.length > 0" class="design-component-list">
          <div v-for="(component, index) in view.components" :key="`${component.kind}:${index}`">
            <span class="design-component-preview" :style="{ backgroundColor: component.backgroundColor, borderRadius: component.borderRadius }" />
            <p><strong>{{ component.label }}</strong><small>{{ component.dimensionLabel }} · {{ component.count }} 个</small></p>
            <code>{{ component.fontSize }} / {{ component.fontWeight }} · p {{ component.padding || "0" }}</code>
          </div>
        </div>
        <p v-else class="design-empty-copy">当前可见状态没有稳定组件变体。</p>
      </section>

      <section class="design-evidence-section design-layout-summary">
        <div class="design-section-heading"><h3>布局骨架</h3><span>不含文本与选择器</span></div>
        <div class="design-layout-groups">
          <div><span>语义区域</span><p><code v-for="entry in view.layoutKinds" :key="entry.label">{{ entry.label }} <small>{{ entry.count }}</small></code><em v-if="view.layoutKinds.length === 0">未发现</em></p></div>
          <div><span>布局模式</span><p><code v-for="entry in view.layoutModes" :key="entry.label">{{ entry.label }} <small>{{ entry.count }}</small></code><em v-if="view.layoutModes.length === 0">未发现</em></p></div>
        </div>
      </section>

      <button
        v-if="view.cssVariables.length > 0"
        type="button"
        class="design-details-toggle"
        :aria-expanded="expanded"
        @click="expanded = !expanded"
      >
        <span><UiIcon name="sliders" :size="15" />{{ expanded ? "收起安全 CSS 变量" : `查看 ${view.cssVariables.length} 个安全 CSS 变量` }}</span>
        <UiIcon :name="expanded ? 'chevron-up' : 'chevron-down'" :size="15" />
      </button>
      <div v-if="expanded" class="design-variable-list">
        <div v-for="variable in view.cssVariables" :key="variable.name">
          <code>{{ variable.name }}</code><span>{{ variable.value }}</span>
        </div>
      </div>

      <p class="design-boundary"><UiIcon name="shield" :size="13" />辅助探针只把文本保留为长度/用途，不导出输入值、class、id、selector 或完整 DOM。截图会遮罩探针识别到的文本、表单控件、动态区域与不透明嵌入面；无法保证识别的伪元素或封闭组件会使采集标记为部分完成。SS Watcher 不会点击、悬停、聚焦或填写内容；结束时会清除模拟、断开调试连接并恢复原滚动位置。</p>
    </template>
    </template>
  </section>
</template>
