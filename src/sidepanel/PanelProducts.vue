<!-- Live M0–M3 presentation component. -->
<script setup lang="ts">
import { computed, ref, watch } from "vue";

import ResearchBriefButton from "./ResearchBriefButton.vue";
import UiIcon from "./UiIcon.vue";
import {
  productsBrief,
  type PanelProduct,
  type PanelStore,
} from "./panel-view-model";

const props = defineProps<{
  products: readonly PanelProduct[];
  store: PanelStore;
  partialMessage?: string;
}>();

const emit = defineEmits<{
  select: [product: PanelProduct];
  exportCsv: [];
}>();

const query = ref("");
const availability = ref<"all" | PanelProduct["availability"]>("all");
const category = ref("all");
const sort = ref<"created-desc" | "title-asc" | "title-desc" | "availability">(
  "created-desc",
);
const page = ref(1);
const pageSize = 20;
const availabilityOptions = ["all", "有货", "售罄", "未知"] as const;

const categoryOptions = computed(() => [
  "all",
  ...new Set(
    props.products
      .map((product) => product.type)
      .filter((value) => value !== "未提供"),
  ),
]);

const filteredRows = computed(() => {
  const search = query.value.trim().toLowerCase();
  const matching = props.products.filter((product) => {
      const matchesSearch =
        search.length === 0 ||
        [product.title, product.handle, product.vendor, product.type, ...product.tags]
          .join(" ")
          .toLowerCase()
          .includes(search);
      const matchesAvailability =
        availability.value === "all" || product.availability === availability.value;
      const matchesCategory = category.value === "all" || product.type === category.value;
      return matchesSearch && matchesAvailability && matchesCategory;
    });
  return [...matching].sort((left, right) => {
    if (sort.value === "title-asc") return left.title.localeCompare(right.title);
    if (sort.value === "title-desc") return right.title.localeCompare(left.title);
    if (sort.value === "availability") {
      const order = { 有货: 0, 售罄: 1, 未知: 2 } as const;
      return order[left.availability] - order[right.availability] ||
        left.title.localeCompare(right.title);
    }
    return right.createdAtEpoch - left.createdAtEpoch;
  });
});

const pageCount = computed(() =>
  Math.max(1, Math.ceil(filteredRows.value.length / pageSize)),
);

const rows = computed(() =>
  filteredRows.value.slice((page.value - 1) * pageSize, page.value * pageSize),
);

const brief = computed(() => productsBrief(props.store, props.products));

watch([query, availability, category, sort], () => {
  page.value = 1;
});

watch(
  () => props.products.length,
  () => {
    page.value = 1;
  },
);
</script>

<template>
  <section class="prototype-view prototype-products">
    <header class="workspace-heading">
      <div>
        <span class="content-kicker">公开目录</span>
        <h1>产品研究</h1>
        <p>先看结构，再进入单品公开字段与变体。</p>
      </div>
      <ResearchBriefButton compact :text="brief" label="复制摘要" />
    </header>

    <div v-if="partialMessage" class="prototype-callout warning-callout compact-callout">
      <UiIcon name="alert" :size="16" />
      <p>{{ partialMessage }}</p>
    </div>

    <div class="catalog-summary-line">
      <span><UiIcon name="check" :size="14" />匹配 {{ filteredRows.length }} / {{ products.length }} 个公开产品</span>
      <span>{{ store.sourceLabel }} · {{ store.priceVerified ? "价格已验证" : "价格待验证" }}</span>
    </div>

    <label class="prototype-search">
      <UiIcon name="search" :size="18" />
      <input v-model="query" type="search" aria-label="搜索公开产品" placeholder="搜索标题、handle、Vendor 或 Tag" />
      <button v-if="query" type="button" aria-label="清除搜索" @click="query = ''"><UiIcon name="close" :size="15" /></button>
    </label>

    <div class="catalog-control-row">
      <label>
        <UiIcon name="sort" :size="15" />
        <select v-model="sort" aria-label="产品排序">
          <option value="created-desc">公开创建时间 · 新到旧</option>
          <option value="title-asc">标题 · A–Z</option>
          <option value="title-desc">标题 · Z–A</option>
          <option value="availability">可售状态</option>
        </select>
      </label>
      <button type="button" @click="emit('exportCsv')">
        <UiIcon name="download" :size="14" />导出 CSV
      </button>
    </div>

    <div class="filter-row" aria-label="产品筛选">
      <button
        v-for="option in categoryOptions"
        :key="option"
        type="button"
        :class="{ active: category === option }"
        @click="category = option"
      >
        {{ option === 'all' ? '全部类型' : option }}
      </button>
    </div>
    <div class="filter-row secondary" aria-label="可售状态筛选">
      <button
        v-for="option in availabilityOptions"
        :key="option"
        type="button"
        :class="{ active: availability === option }"
        @click="availability = option"
      >
        {{ option === 'all' ? '全部状态' : option }}
      </button>
    </div>

    <div class="prototype-product-list" aria-label="产品列表">
      <button
        v-for="product in rows"
        :key="product.key"
        type="button"
        class="prototype-product-row"
        @click="emit('select', product)"
      >
        <span class="product-visual" :data-initial="product.title.slice(0, 1)">
          <img v-if="product.image" :src="product.image" alt="" loading="lazy" referrerpolicy="no-referrer" />
          <span v-else>{{ product.title.slice(0, 1) }}</span>
        </span>
        <span class="product-summary">
          <strong>{{ product.title }}</strong>
          <small>{{ product.handle }}</small>
          <span><em>{{ product.vendor }}</em><em>{{ product.type }}</em></span>
        </span>
        <span class="product-price">
          <strong>{{ product.price }}</strong>
          <small :class="product.availability === '有货' ? 'available' : product.availability === '售罄' ? 'soldout' : 'unknown'">{{ product.availability }}</small>
          <UiIcon name="chevron-right" :size="16" />
        </span>
      </button>
      <div v-if="rows.length === 0" class="catalog-empty">
        <UiIcon name="search" :size="24" />
        <strong>没有匹配的公开产品</strong>
        <span>调整关键词或筛选条件后再试。</span>
      </div>
    </div>

    <nav v-if="pageCount > 1" class="prototype-pagination" aria-label="产品分页">
      <button type="button" :disabled="page === 1" @click="page -= 1">
        <UiIcon name="chevron-left" :size="15" />上一页
      </button>
      <span>{{ page }} / {{ pageCount }}</span>
      <button type="button" :disabled="page === pageCount" @click="page += 1">
        下一页<UiIcon name="chevron-right" :size="15" />
      </button>
    </nav>

    <p class="catalog-boundary"><UiIcon name="shield" :size="14" />价格、可售与标签均来自该已提交的公开快照；不代表后台库存或订单。</p>
  </section>
</template>
