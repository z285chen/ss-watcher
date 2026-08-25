<!-- Live M0–M3 presentation component. -->
<script setup lang="ts">
import { computed, ref } from "vue";

import type { DesignIntelligenceResult } from "../core/design/design-intelligence";
import type { InteractionActionKind, NodeRole } from "../core/design/evidence-package";
import PanelDesignIntelligence from "./PanelDesignIntelligence.vue";
import ResearchBriefButton from "./ResearchBriefButton.vue";
import TechnologyMark from "./TechnologyMark.vue";
import UiIcon from "./UiIcon.vue";
import {
  technologyBrief,
  type PanelFinding,
  type PanelFindingKind,
  type PanelResource,
  type PanelTechnologySummary,
} from "./panel-view-model";

const props = defineProps<{
  host: string;
  findings: readonly PanelFinding[];
  resources: readonly PanelResource[];
  summary?: PanelTechnologySummary;
  design?: DesignIntelligenceResult;
  partialMessage?: string;
  canExportSources: boolean;
  exportBusy: boolean;
  exportProgress: string;
  designCaptureEnabled: boolean;
  designCaptureBusy: boolean;
  designCaptureCancelable: boolean;
  designCaptureStatus: string;
  designCapturedViewports: readonly string[];
  designActiveViewportScope: readonly ("desktop" | "tablet" | "mobile")[];
  designPreparedViewport?: "desktop" | "tablet" | "mobile";
  designDetachedControllerEnabled: boolean;
  designStates: readonly Readonly<{ stateId: string; label: string }> [];
  designActiveStateId: string;
  designActiveStateContract: string;
  designCanRecordState: boolean;
  designCanDeleteState: boolean;
  designPackageReady: boolean;
  designHasEvidenceSession: boolean;
}>();

const emit = defineEmits<{
  exportSources: [];
  captureDesign: [viewport: "desktop" | "tablet" | "mobile"];
  cancelDesignCapture: [];
  exportDesign: [];
  clearDesign: [];
  openDetachedDesignController: [];
  recordDesignState: [input: Readonly<{ actionKind: InteractionActionKind; targetRole: NodeRole; viewportScope: readonly ("desktop" | "tablet" | "mobile")[] }>];
  deleteDesignState: [];
  selectDesignState: [stateId: string];
}>();

const activeKind = ref<"all" | PanelFindingKind>("all");
const expanded = ref<string>();
const showAllResources = ref(false);
const showSourceMaps = ref(false);
const resourceStatus = ref<"all" | PanelResource["status"]>("all");
const resourceKind = ref("all");

const kindLabels: Record<PanelFindingKind, string> = {
  framework: "框架",
  theme: "主题",
  api: "代码引用",
  performance: "性能",
  app: "App",
  pixel: "Pixel",
  "source-map": "Source Map",
};

const kinds = computed(() => {
  const present = new Set(props.findings.map((finding) => finding.kind));
  return [
    { value: "all" as const, label: "全部" },
    ...([...present] as PanelFindingKind[]).map((value) => ({
      value,
      label: kindLabels[value],
    })),
  ];
});

const visibleFindings = computed(() =>
  activeKind.value === "all"
    ? props.findings
    : props.findings.filter((finding) => finding.kind === activeKind.value),
);

const findingOrder: readonly PanelFindingKind[] = [
  "theme",
  "framework",
  "app",
  "pixel",
  "api",
  "performance",
  "source-map",
];

const findingGroups = computed(() =>
  findingOrder
    .map((kind) => ({
      kind,
      label: kindLabels[kind],
      findings: visibleFindings.value.filter((finding) => finding.kind === kind),
    }))
    .filter((group) => group.findings.length > 0),
);

const coreResources = computed(() =>
  props.resources.filter((resource) => resource.kind !== "source-map"),
);

const sourceMapResources = computed(() =>
  props.resources.filter((resource) => resource.kind === "source-map"),
);

const sourceMapUnavailable = computed(() =>
  sourceMapResources.value.filter(
    (resource) => resource.status === "failed" || resource.status === "skipped",
  ),
);

const resourceKindOptions = computed(() => [
  "all",
  ...new Set(coreResources.value.map((resource) => resource.kind)),
]);

const filteredResources = computed(() =>
  coreResources.value.filter(
    (resource) =>
      (resourceStatus.value === "all" ||
        resource.status === resourceStatus.value) &&
      (resourceKind.value === "all" || resource.kind === resourceKind.value),
  ),
);

const visibleResources = computed(() =>
  showAllResources.value
    ? filteredResources.value
    : filteredResources.value.slice(0, 12),
);

const brief = computed(() =>
  technologyBrief(props.host, props.findings, props.summary),
);

function toggleFinding(id: string): void {
  expanded.value = expanded.value === id ? undefined : id;
}

function sourceMapStatusLabel(resource: PanelResource): string {
  if (resource.status === "analyzed") return "已分析";
  if (resource.status === "metadata-only") return "仅元数据";
  if (resource.status === "pending") return "待处理";
  return "未读取";
}

function sourceMapReason(resource: PanelResource): string | undefined {
  if (resource.status !== "failed" && resource.status !== "skipped") return undefined;
  const reason = resource.failureReason ?? "未记录原因";
  return `未读取原因 · ${reason}${resource.httpStatus === undefined ? "" : ` · HTTP ${resource.httpStatus}`}`;
}
</script>

<template>
  <section class="prototype-view prototype-technology">
    <header class="workspace-heading">
      <div>
        <span class="content-kicker">公开前端信号</span>
        <h1>技术证据</h1>
        <p>先看可确认的技术，再按证据回溯来源。</p>
      </div>
      <ResearchBriefButton compact :text="brief" label="复制摘要" />
    </header>

    <div v-if="partialMessage" class="prototype-callout warning-callout compact-callout">
      <UiIcon name="alert" :size="16" />
      <p>{{ partialMessage }}</p>
    </div>

    <section class="technology-signal-banner">
      <div class="technology-signal-title">
        <span><UiIcon name="code" :size="18" /></span>
        <p>
          <strong>{{ host }}</strong>
          <small>{{ summary ? `${summary.analyzedResources} 个同源正文已分析 · ${summary.metadataOnlyResources} 个 metadata-only` : "当前快照没有前端资源统计" }}</small>
        </p>
      </div>
      <div class="technology-fact-rail">
        <span><small>同源资源</small><strong>{{ summary?.sameOriginResources ?? 0 }}</strong></span>
        <span><small>技术发现</small><strong>{{ findings.length }}</strong></span>
        <span><small>已分析</small><strong>{{ summary?.analyzedResources ?? 0 }}</strong></span>
      </div>
    </section>

    <p class="technology-boundary"><UiIcon name="shield" :size="14" />同源正文仅在受限会话中短暂分析；跨源资源保持 metadata-only。代码引用不表示接口可访问。</p>

    <PanelDesignIntelligence
      v-if="design"
      :result="design"
      :capture-enabled="designCaptureEnabled"
      :capture-busy="designCaptureBusy"
      :capture-cancelable="designCaptureCancelable"
      :capture-status="designCaptureStatus"
      :captured-viewports="designCapturedViewports"
      :active-viewport-scope="designActiveViewportScope"
      :prepared-viewport="designPreparedViewport"
      :detached-controller-enabled="designDetachedControllerEnabled"
      :states="designStates"
      :active-state-id="designActiveStateId"
      :active-state-contract="designActiveStateContract"
      :can-record-state="designCanRecordState"
      :can-delete-state="designCanDeleteState"
      :package-ready="designPackageReady"
      :has-evidence-session="designHasEvidenceSession"
      @capture="emit('captureDesign', $event)"
      @cancel-capture="emit('cancelDesignCapture')"
      @export-package="emit('exportDesign')"
      @clear-session="emit('clearDesign')"
      @open-detached-controller="emit('openDetachedDesignController')"
      @record-state="emit('recordDesignState', $event)"
      @delete-state="emit('deleteDesignState')"
      @select-state="emit('selectDesignState', $event)"
    />

    <section
      v-if="summary && summary.sourceMapUnavailableResources > 0"
      class="source-map-availability"
      aria-label="Source Map 可用性"
    >
      <div>
        <span>Source Map 可用性</span>
        <strong>{{ summary.sourceMapUnavailableResources }} 条未能读取</strong>
      </div>
      <p>这些映射文件未能按当前公开资源策略读取；不影响产品目录、已分析的 JS/CSS 或技术发现，仅限制源码还原。</p>
      <ul v-if="summary.sourceMapFailureReasons.length > 0">
        <li v-for="entry in summary.sourceMapFailureReasons" :key="entry.reason">
          <code>{{ entry.reason }}</code><span>{{ entry.count }}</span>
        </li>
      </ul>
      <button
        v-if="sourceMapResources.length > 0"
        type="button"
        class="source-map-ledger-toggle"
        :aria-expanded="showSourceMaps"
        @click="showSourceMaps = !showSourceMaps"
      >
        <span>
          <UiIcon name="database" :size="14" />
          {{ showSourceMaps ? "收起映射明细" : `查看 ${sourceMapResources.length} 条映射明细` }}
        </span>
        <UiIcon :name="showSourceMaps ? 'chevron-up' : 'chevron-down'" :size="15" />
      </button>
    </section>

    <section
      v-if="summary && summary.coreBudgetLimitedResources > 0"
      class="analysis-coverage-limit"
      aria-label="前端分析覆盖限制"
    >
      <div>
        <span>分析覆盖上限</span>
        <strong>{{ summary.coreBudgetLimitedResources }} 条仅保留描述符</strong>
      </div>
      <p>
        已优先分析核心公开正文；其余候选达到每次
        {{ summary.resourceBodyLimit }} 个正文 / {{ summary.resourceByteLimit }}
        的安全预算后停止，不代表网络或页面故障。
      </p>
    </section>

    <section
      v-if="summary && (summary.coreFailedResources > 0 || summary.coreSkippedResources > 0)"
      class="resource-degradation"
    >
      <div>
        <span>核心资源不可用</span>
        <strong>失败 {{ summary.coreFailedResources }} · 其他跳过 {{ summary.coreSkippedResources }}</strong>
      </div>
      <ul v-if="summary.coreFailureReasons.length > 0">
        <li v-for="entry in summary.coreFailureReasons" :key="entry.reason">
          <code>{{ entry.reason }}</code><span>{{ entry.count }}</span>
        </li>
      </ul>
    </section>

    <div class="filter-row technology-filter" aria-label="技术发现筛选">
      <button
        v-for="kind in kinds"
        :key="kind.value"
        type="button"
        :class="{ active: activeKind === kind.value }"
        @click="activeKind = kind.value"
      >{{ kind.label }}</button>
    </div>

    <section class="finding-groups" aria-label="技术发现">
      <section v-for="group in findingGroups" :key="group.kind" class="finding-group">
        <h2>{{ group.label }}</h2>
        <article
          v-for="finding in group.findings"
          :key="finding.id"
          class="finding-row"
          :class="{ expanded: expanded === finding.id }"
        >
          <button type="button" class="finding-trigger" :aria-expanded="expanded === finding.id" @click="toggleFinding(finding.id)">
            <TechnologyMark :label="finding.label" :kind="finding.kind" />
            <span class="finding-copy">
              <strong>{{ finding.label }}</strong>
              <small>置信度 {{ finding.confidence }} · {{ finding.maturity }}</small>
            </span>
            <UiIcon :name="expanded === finding.id ? 'chevron-up' : 'chevron-down'" :size="17" />
          </button>
          <div v-if="expanded === finding.id" class="finding-detail">
            <p>{{ finding.summary }}</p>
            <div class="finding-evidence">
              <span v-for="evidence in finding.evidence" :key="evidence"><UiIcon name="check" :size="13" />{{ evidence }}</span>
            </div>
            <small>证据来自当前页面观察到的公开资源；源码正文不会写入快照。</small>
          </div>
        </article>
      </section>
      <div v-if="visibleFindings.length === 0" class="catalog-empty">
        <UiIcon name="code" :size="24" />
        <strong>当前快照没有匹配的技术发现</strong>
        <span>资源清单仍会保留可核查的 fetch 状态与边界。</span>
      </div>
    </section>

    <section class="resource-glance" aria-labelledby="resource-glance-title">
      <div class="section-heading">
        <div>
          <span class="content-kicker">资源清单</span>
          <h2 id="resource-glance-title">核心可分析范围</h2>
        </div>
        <span>{{ filteredResources.length }} / {{ coreResources.length }} 条 · {{ summary?.analyzedBytes ?? "—" }}</span>
      </div>
      <div class="resource-filter-grid" aria-label="资源筛选">
        <label>
          <span>状态</span>
          <select v-model="resourceStatus">
            <option value="all">全部状态</option>
            <option value="analyzed">analyzed</option>
            <option value="metadata-only">metadata-only</option>
            <option value="failed">failed</option>
            <option value="skipped">skipped</option>
            <option value="pending">pending</option>
          </select>
        </label>
        <label>
          <span>类型</span>
          <select v-model="resourceKind">
            <option v-for="kind in resourceKindOptions" :key="kind" :value="kind">
              {{ kind === "all" ? "全部类型" : kind }}
            </option>
          </select>
        </label>
      </div>
      <div class="resource-glance-list">
        <div v-for="resource in visibleResources" :key="resource.id" class="live-resource-row">
          <span class="resource-type">{{ resource.replayPolicy === "observed-only" ? "runtime" : resource.kind }}</span>
          <p>
            <strong>{{ resource.host }}</strong>
            <small :title="resource.path">{{ resource.path }}</small>
            <small
              v-if="resource.replayPolicy === 'observed-only'"
              class="resource-observed-only"
            >
              运行时请求 · 方法与请求体未知，未重放
            </small>
            <small v-if="resource.failureReason" class="resource-failure-reason">
              failureReason · {{ resource.failureReason }}<template v-if="resource.httpStatus !== undefined"> · HTTP {{ resource.httpStatus }}</template>
            </small>
          </p>
          <span class="resource-result">
            <em :class="{ metadata: resource.status === 'metadata-only', failed: resource.status === 'failed', skipped: resource.status === 'skipped' }">{{ resource.status }}</em>
            <small>{{ resource.bytes }}</small>
          </span>
        </div>
        <div v-if="filteredResources.length === 0" class="resource-empty-copy">
          {{
            coreResources.length === 0
              ? "当前 committed 快照没有核心前端资源描述符。"
              : resourceStatus === "failed" && sourceMapUnavailable.length > 0
                ? "当前快照没有核心资源失败；可选 Source Map 未读取已在上方单独展示。"
                : "没有符合当前筛选的核心资源。"
          }}
        </div>
      </div>
      <button
        v-if="filteredResources.length > 12"
        type="button"
        class="resource-action"
        @click="showAllResources = !showAllResources"
      >
        <UiIcon name="database" :size="15" />
        {{ showAllResources ? "收起资源" : `查看全部 ${filteredResources.length} 条资源` }}
      </button>
      <button
        type="button"
        class="resource-action secondary-resource-action"
        :disabled="!canExportSources || exportBusy"
        @click="emit('exportSources')"
      >
        <UiIcon name="download" :size="15" />
        {{ exportBusy ? `正在导出 ${exportProgress}` : "导出通过 ResourcePolicy 的公开同源源码" }}
      </button>
    </section>

    <section
      v-if="showSourceMaps && sourceMapResources.length > 0"
      class="source-map-ledger"
      aria-label="Source Map 明细"
    >
      <div class="section-heading">
        <div>
          <span class="content-kicker">可选辅助文件</span>
          <h2>Source Map 明细</h2>
        </div>
        <span>{{ sourceMapUnavailable.length }} 条未读取</span>
      </div>
      <p>仅用于辅助源码还原；不会影响产品目录、技术发现或公开源码导出中的已分析 JS/CSS。</p>
      <div class="resource-glance-list source-map-ledger-list">
        <div v-for="resource in sourceMapResources" :key="resource.id" class="live-resource-row source-map-resource-row">
          <span class="resource-type">source-map</span>
          <p>
            <strong>{{ resource.host }}</strong>
            <small :title="resource.path">{{ resource.path }}</small>
            <small v-if="sourceMapReason(resource)" class="source-map-unavailable-reason">
              {{ sourceMapReason(resource) }}
            </small>
          </p>
          <span class="resource-result">
            <em :class="{ 'source-map-unavailable': resource.status === 'failed' || resource.status === 'skipped', metadata: resource.status === 'metadata-only' }">{{ sourceMapStatusLabel(resource) }}</em>
            <small>{{ resource.bytes }}</small>
          </span>
        </div>
      </div>
    </section>
  </section>
</template>
