<!-- Live M0–M3 presentation component. -->
<script setup lang="ts">
import { computed } from "vue";

import ResearchBriefButton from "./ResearchBriefButton.vue";
import UiIcon from "./UiIcon.vue";
import {
  overviewBrief,
  type PanelStore,
} from "./panel-view-model";

const props = defineProps<{
  store: PanelStore;
}>();

const emit = defineEmits<{
  openProducts: [];
  openTechnology: [];
}>();

const brief = computed(() => overviewBrief(props.store));
</script>

<template>
  <section class="prototype-view prototype-overview">
    <div v-if="store.partialMessage" class="prototype-callout warning-callout">
      <UiIcon name="alert" :size="17" />
      <div>
        <strong>本次快照为部分覆盖</strong>
        <p>{{ store.partialMessage }}</p>
      </div>
    </div>

    <section class="store-profile" aria-labelledby="store-pulse-title">
      <div class="store-profile-topline">
        <span class="store-logo" aria-hidden="true">
          {{ store.initial }}
          <img v-if="store.favicon" :src="store.favicon" alt="" referrerpolicy="no-referrer" />
        </span>
        <div class="store-profile-heading">
          <h1 id="store-pulse-title">{{ store.host }}</h1>
          <p>{{ store.snapshotLabel }}</p>
        </div>
        <span :class="['verified-chip', { warning: !store.priceVerified }]">
          <UiIcon name="shield" :size="14" />
          {{ store.priceVerified ? "价格已验证" : "价格待验证" }}
        </span>
      </div>

      <div class="store-facts" aria-label="店铺公开上下文">
        <div><span><UiIcon name="layers" :size="15" />主题</span><strong>{{ store.theme }}</strong></div>
        <div><span><UiIcon name="globe" :size="15" />市场</span><strong>{{ store.market }}</strong></div>
        <div><span><UiIcon name="check" :size="15" />店面类型</span><strong>{{ store.storefront }}</strong></div>
      </div>
    </section>

    <section class="overview-conclusion" aria-labelledby="overview-conclusion-title">
      <span>本次结论</span>
      <div>
        <strong id="overview-conclusion-title">{{ store.summaryTitle }}</strong>
        <p>{{ store.summaryBody }}</p>
      </div>
    </section>

    <section class="signal-rail" aria-label="关键指标">
      <div><span>公开产品</span><strong>{{ store.productCount }}</strong></div>
      <div><span>变体</span><strong>{{ store.variantCount }}</strong></div>
      <div><span>折扣产品</span><strong>{{ store.discountedProducts }}</strong></div>
      <div><span>技术信号</span><strong>{{ store.technologyCount }}</strong></div>
    </section>

    <div class="overview-columns">
      <section class="flat-group social-proof" aria-labelledby="social-title">
          <h2 id="social-title">公开账号</h2>
          <div v-if="store.socials.length > 0">
            <a
              v-for="social in store.socials"
              :key="social.platform"
              :href="social.url"
              target="_blank"
              rel="noopener noreferrer"
              :title="social.url"
            >{{ social.label }}</a>
          </div>
          <small v-else>未发现公开账号</small>
      </section>

      <section class="flat-group next-actions" aria-labelledby="next-actions-title">
        <div class="flat-group-heading">
          <h2 id="next-actions-title">从结论进入证据</h2>
          <ResearchBriefButton compact :text="brief" label="复制摘要" />
        </div>
      <button type="button" class="action-row" @click="emit('openProducts')">
        <span class="action-icon purple"><UiIcon name="products" :size="18" /></span>
        <span><strong>浏览产品结构</strong><small>{{ store.coverageLabel }}</small></span>
        <UiIcon name="chevron-right" :size="18" />
      </button>
      <button type="button" class="action-row" @click="emit('openTechnology')">
        <span class="action-icon mint"><UiIcon name="code" :size="19" /></span>
        <span>
          <strong>核查前端技术</strong>
          <small>{{ store.pixelCount }} 个 Pixel 代码信号 · {{ store.sourceMapCount }} 个 source map</small>
        </span>
        <UiIcon name="chevron-right" :size="18" />
      </button>
      </section>
    </div>

    <section class="flat-group evidence-snapshot" aria-labelledby="evidence-snapshot-title">
      <h2 id="evidence-snapshot-title">现在能确认什么</h2>
      <div class="evidence-list">
        <div>
          <span :class="['evidence-bullet', store.priceVerified ? 'success' : 'amber']">
            <UiIcon :name="store.priceVerified ? 'check' : 'alert'" :size="13" />
          </span>
          <p>
            <strong>{{ store.priceVerified ? "价格可比较" : "价格仅展示原始口径" }}</strong>
            <span>{{ store.priceVerified ? "匿名市场上下文与公开价格来源已通过门控。" : "匿名 market/currency 或价格来源尚未全部通过门控。" }}</span>
          </p>
        </div>
        <div>
          <span class="evidence-bullet purple"><UiIcon name="trend" :size="13" /></span>
          <p><strong>公开快照可追溯</strong><span>{{ store.sourceLabel }}；公开 Collection 排序不等价于真实销量。</span></p>
        </div>
        <div>
          <span class="evidence-bullet amber"><UiIcon name="sparkle" :size="13" /></span>
          <p><strong>可复制研究摘要</strong><span>复制的是带来源与边界的本地事实摘要，不含登录数据。</span></p>
        </div>
      </div>
    </section>
  </section>
</template>
