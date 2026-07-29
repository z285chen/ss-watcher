<script setup lang="ts">
import UiIcon from "./UiIcon.vue";

defineProps<{
  status: string;
  detail: string;
  bootId: string;
  busy: boolean;
  hasSession: boolean;
}>();

const emit = defineEmits<{
  back: [];
  establish: [];
  probes: [];
  cart: [];
  products: [];
  storage: [];
  revoke: [];
}>();
</script>

<template>
  <section class="prototype-view panel-diagnostics">
    <header class="workspace-heading">
      <div>
        <span class="content-kicker">运行与授权</span>
        <h1>诊断工具</h1>
        <p>直接调用 M0–M3 已有诊断动作，不改变扫描策略。</p>
      </div>
      <button type="button" class="diagnostics-back" @click="emit('back')">
        <UiIcon name="chevron-left" :size="15" />返回结果
      </button>
    </header>

    <section class="diagnostics-status-card">
      <div>
        <span class="status-orb" :class="{ offline: !hasSession }" />
        <p><strong>{{ status }}</strong><small>SW boot · {{ bootId || "尚未应答" }}</small></p>
      </div>
      <span :class="['diagnostics-session-chip', { warning: !hasSession }]">
        {{ hasSession ? "Session active" : "No session" }}
      </span>
    </section>

    <section class="diagnostics-actions" aria-label="诊断动作">
      <button type="button" :disabled="busy" @click="emit('establish')">
        <UiIcon name="shield" :size="17" />
        <span><strong>检查授权</strong><small>重新建立当前 action 绑定</small></span>
      </button>
      <button type="button" :disabled="busy || !hasSession" @click="emit('probes')">
        <UiIcon name="radar" :size="17" />
        <span><strong>运行双探针</strong><small>MAIN / ISOLATED</small></span>
      </button>
      <button type="button" :disabled="busy || !hasSession" @click="emit('cart')">
        <UiIcon name="globe" :size="17" />
        <span><strong>探测 cart.js</strong><small>匿名 currency 上下文</small></span>
      </button>
      <button type="button" :disabled="busy || !hasSession" @click="emit('products')">
        <UiIcon name="products" :size="17" />
        <span><strong>探测 products.json</strong><small>小样本能力检查</small></span>
      </button>
      <button type="button" :disabled="busy" @click="emit('storage')">
        <UiIcon name="database" :size="17" />
        <span><strong>IndexedDB 自检</strong><small>随机临时数据库</small></span>
      </button>
      <button type="button" class="danger" :disabled="busy || !hasSession" @click="emit('revoke')">
        <UiIcon name="revoke" :size="17" />
        <span><strong>吊销当前会话</strong><small>快照保留为只读</small></span>
      </button>
    </section>

    <section class="diagnostics-output">
      <header>
        <div><span class="content-kicker">原始运行输出</span><h2>可复制诊断信息</h2></div>
        <span>{{ detail ? "最新结果" : "暂无结果" }}</span>
      </header>
      <pre>{{ detail || "执行上方诊断动作后，策略返回会显示在这里。" }}</pre>
    </section>
  </section>
</template>
