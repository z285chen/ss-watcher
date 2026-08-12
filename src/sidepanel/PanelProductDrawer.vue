<!-- Live M0–M3 presentation component. -->
<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";

import ResearchBriefButton from "./ResearchBriefButton.vue";
import UiIcon from "./UiIcon.vue";
import { productBrief, type PanelProduct } from "./panel-view-model";

const props = defineProps<{
  product: PanelProduct;
}>();

const emit = defineEmits<{
  close: [];
}>();

const drawer = ref<HTMLElement>();
const closeButton = ref<HTMLButtonElement>();
let previouslyFocused: HTMLElement | undefined;

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    emit("close");
    return;
  }
  if (event.key !== "Tab" || drawer.value === undefined) return;
  const focusable = [...drawer.value.querySelectorAll<HTMLElement>(
    'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
  )];
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable.at(-1);
  if (first === undefined || last === undefined) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

onMounted(() => {
  previouslyFocused = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : undefined;
  window.addEventListener("keydown", onKeydown);
  void nextTick(() => closeButton.value?.focus());
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  if (previouslyFocused?.isConnected) previouslyFocused.focus();
});
</script>

<template>
  <Teleport to="body">
    <div class="product-drawer-backdrop" @click.self="emit('close')">
      <aside ref="drawer" class="product-drawer" role="dialog" aria-modal="true" :aria-label="`${product.title} 产品详情`">
        <header class="drawer-header">
          <div>
            <span class="content-kicker">公开产品详情</span>
            <h2>{{ product.title }}</h2>
            <p>{{ product.handle }}</p>
          </div>
          <button ref="closeButton" type="button" class="drawer-close" aria-label="关闭产品详情" @click="emit('close')"><UiIcon name="close" :size="19" /></button>
        </header>

        <div v-if="product.image" class="drawer-product-visual">
          <img :src="product.image" :alt="product.title" referrerpolicy="no-referrer" />
        </div>

        <div class="drawer-price-line">
          <div><span>公开价格</span><strong>{{ product.price }}</strong><small>{{ product.priceNote }}</small></div>
          <span :class="['drawer-availability', product.availability === '有货' ? 'available' : product.availability === '售罄' ? 'soldout' : 'unknown']">{{ product.availability }}</span>
        </div>

        <dl class="drawer-facts">
          <div><dt>Vendor</dt><dd>{{ product.vendor }}</dd></div>
          <div><dt>Product Type</dt><dd>{{ product.type }}</dd></div>
          <div><dt>公开创建时间</dt><dd>{{ product.createdAt }}</dd></div>
          <div><dt>目录来源</dt><dd>{{ product.sourceLabel }}</dd></div>
        </dl>

        <section class="drawer-section">
          <div class="drawer-section-heading"><h3>公开标签</h3><span>{{ product.tags.length }}</span></div>
          <div v-if="product.tags.length > 0" class="drawer-tags"><span v-for="tag in product.tags" :key="tag">{{ tag }}</span></div>
          <p v-else class="drawer-empty-copy">当前公开快照未提供标签。</p>
        </section>

        <section class="drawer-section">
          <div class="drawer-section-heading"><h3>变体</h3><span>{{ product.variants.length }}</span></div>
          <div class="drawer-variants">
            <div v-for="variant in product.variants" :key="variant.title">
              <span>{{ variant.title }}</span>
              <strong>{{ variant.price }}</strong>
              <small :class="variant.availability === '有货' ? 'available' : variant.availability === '售罄' ? 'soldout' : 'unknown'">{{ variant.availability }}</small>
            </div>
          </div>
        </section>

        <a
          v-if="product.url"
          class="drawer-public-link"
          :href="product.url"
          target="_blank"
          rel="noopener noreferrer"
        >
          <UiIcon name="external" :size="15" />打开公开产品页
        </a>

        <div class="drawer-brief">
          <div><UiIcon name="sparkle" :size="17" /><p><strong>研究摘要</strong><span>仅复制可追溯的公开字段。</span></p></div>
          <ResearchBriefButton compact :text="productBrief(props.product)" label="复制上下文" />
        </div>
        <p class="drawer-disclaimer"><UiIcon name="shield" :size="13" />数据来自当前 committed 公开快照；不代表后台库存、订单或真实销量。</p>
      </aside>
    </div>
  </Teleport>
</template>
