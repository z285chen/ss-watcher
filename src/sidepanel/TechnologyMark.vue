<script setup lang="ts">
import { computed } from "vue";

import type { PanelFindingKind } from "./panel-view-model";

const props = defineProps<{
  label: string;
  kind: PanelFindingKind;
}>();

type KnownMark = "shopify" | "google" | "meta" | "clarity" | "tiktok" | "pinterest" | "react" | "vue" | "graphql";

const normalized = computed(() => props.label.toLowerCase());
const mark = computed<KnownMark | undefined>(() => {
  const value = normalized.value;
  if (/shopify|theme runtime/u.test(value)) return "shopify";
  if (/google|gtag|analytics/u.test(value)) return "google";
  if (/meta pixel|facebook pixel/u.test(value)) return "meta";
  if (/clarity/u.test(value)) return "clarity";
  if (/tiktok/u.test(value)) return "tiktok";
  if (/pinterest/u.test(value)) return "pinterest";
  if (/react/u.test(value)) return "react";
  if (/vue/u.test(value)) return "vue";
  if (/graphql/u.test(value)) return "graphql";
  return undefined;
});

const fallback = computed(() => {
  const first = props.label.trim().match(/[A-Za-z0-9]/u)?.[0];
  return (first ?? props.kind.slice(0, 1)).toUpperCase();
});
</script>

<template>
  <span class="technology-mark" :class="mark ?? `fallback-${kind}`" aria-hidden="true">
    <svg v-if="mark === 'shopify'" viewBox="0 0 32 32">
      <path fill="#95bf47" d="M8.2 8.8 10 8.3c.4-2.3 1.9-4.7 4.5-4.7 2.2 0 3.2 1.5 3.5 3.3l2.6-.8 3.2 2.1 2.1 18.3L8.2 29z"/>
      <path fill="#5e8e3e" d="m20.6 6.1 3.2 2.1 2.1 18.3-5.3-3.2z" opacity=".65"/>
      <path fill="#fff" d="M17.4 10.2c-.8-.4-1.7-.6-2.6-.5-2 .1-2.1 1.4-2.1 1.7.1 1.8 5 2.2 5.2 6.5.2 3.4-1.8 5.8-4.8 6a7.3 7.3 0 0 1-5-1.4l.7-3s1.8 1.3 3.4 1.2c1-.1 1.4-.9 1.4-1.5-.1-2.4-4.1-2.3-4.4-6.2-.2-3.3 1.9-6.6 6.8-6.9 1.9-.1 2.9.3 2.9.3z" transform="translate(3 2) scale(.76)"/>
    </svg>
    <svg v-else-if="mark === 'google'" viewBox="0 0 32 32">
      <path fill="#f9ab00" d="M5 26.2V17a3.8 3.8 0 0 1 7.6 0v9.2a3.8 3.8 0 1 1-7.6 0Z"/>
      <path fill="#e37400" d="M14 26.2V9.5a3.8 3.8 0 0 1 7.6 0v16.7a3.8 3.8 0 1 1-7.6 0Z"/>
      <circle cx="25.6" cy="26.2" r="3.8" fill="#f9ab00"/>
    </svg>
    <svg v-else-if="mark === 'meta'" viewBox="0 0 32 32">
      <path fill="none" stroke="#0866ff" stroke-linecap="round" stroke-width="3.4" d="M4 21.8c2.2-9.3 5.1-14 8.1-14 4.6 0 7.5 16.4 11.7 16.4 2.1 0 3.3-2.1 3.3-4.9 0-5.3-3-11.5-7.1-11.5-4.7 0-8.4 16.4-12.2 16.4-2.2 0-3.8-1-3.8-2.4Z"/>
    </svg>
    <svg v-else-if="mark === 'clarity'" viewBox="0 0 32 32">
      <path fill="#2878d0" d="M4 5h24v5H4zm0 8h16v5H4zm0 8h21v6H4z"/>
      <path fill="#63a8ef" d="m20 13 8 5-8 5z"/>
    </svg>
    <svg v-else-if="mark === 'tiktok'" viewBox="0 0 32 32">
      <path fill="#25f4ee" d="M18 5h4c.5 3 2.2 4.7 5 5v4c-2-.1-3.7-.7-5-1.8V21a7 7 0 1 1-6-7v4.2a3 3 0 1 0 2 2.8z" transform="translate(-1 1)"/>
      <path fill="#fe2c55" d="M18 4h4c.5 3 2.2 4.7 5 5v4c-2-.1-3.7-.7-5-1.8V20a7 7 0 1 1-6-7v4.2a3 3 0 1 0 2 2.8z" opacity=".9"/>
      <path fill="#111" d="M19 4h3c.5 3 2.2 4.7 5 5v3c-3.9-.6-6.4-2.8-8-8Zm0 5v11a6 6 0 1 1-5-5.9v3.2a3 3 0 1 0 2 2.8V9z"/>
    </svg>
    <svg v-else-if="mark === 'pinterest'" viewBox="0 0 32 32">
      <circle cx="16" cy="16" r="13" fill="#bd081c"/>
      <path fill="#fff" d="M14.7 24.7c1.1-1.9 1.4-3 2-5.4 1 1.6 2.8 2 4.5 2 5.9 0 9.9-5.3 9.9-12.4C31.1 2.2 25.6-3 18.5-3 9.1-3 4.3 3.7 4.3 9.3c0 4.2 1.6 8 5 9.4.6.3 1.1 0 1.3-.7l.5-2c.2-.7.1-.9-.4-1.5-.9-1.1-1.5-2.6-1.5-4.7 0-6.1 4.6-11.6 11.9-11.6 6.5 0 10.1 4 10.1 9.3 0 7-3.1 12.9-7.7 12.9-2.5 0-4.4-2.1-3.8-4.7.7-3 2.1-6.2 2.1-8.3 0-1.9-1-3.5-3.2-3.5-2.5 0-4.5 2.6-4.5 6.1 0 2.2.8 3.7.8 3.7l-3.2 13.4c-.9 4-.1 8.8 0 9.3" transform="translate(6.5 8.3) scale(.48)"/>
    </svg>
    <svg v-else-if="mark === 'react'" viewBox="0 0 32 32">
      <circle cx="16" cy="16" r="2.5" fill="#61dafb"/>
      <g fill="none" stroke="#61dafb" stroke-width="1.7"><ellipse cx="16" cy="16" rx="13" ry="5"/><ellipse cx="16" cy="16" rx="13" ry="5" transform="rotate(60 16 16)"/><ellipse cx="16" cy="16" rx="13" ry="5" transform="rotate(120 16 16)"/></g>
    </svg>
    <svg v-else-if="mark === 'vue'" viewBox="0 0 32 32">
      <path fill="#41b883" d="M2 5h7l7 12L23 5h7L16 29z"/>
      <path fill="#35495e" d="M9 5h5l2 3.5L18 5h5l-7 12z"/>
    </svg>
    <svg v-else-if="mark === 'graphql'" viewBox="0 0 32 32">
      <path fill="none" stroke="#e10098" stroke-width="2" d="m16 3 11 6.5v13L16 29 5 22.5v-13Zm0 0v26M5 9.5l22 13M27 9.5l-22 13"/>
      <g fill="#e10098"><circle cx="16" cy="3" r="2.2"/><circle cx="27" cy="9.5" r="2.2"/><circle cx="27" cy="22.5" r="2.2"/><circle cx="16" cy="29" r="2.2"/><circle cx="5" cy="22.5" r="2.2"/><circle cx="5" cy="9.5" r="2.2"/></g>
    </svg>
    <span v-else>{{ fallback }}</span>
  </span>
</template>
