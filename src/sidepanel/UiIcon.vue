<script setup lang="ts">
withDefaults(
  defineProps<{
    name:
      | "radar"
      | "overview"
      | "products"
      | "diagnostics"
      | "refresh"
      | "download"
      | "file"
      | "shield"
      | "box"
      | "layers"
      | "tag"
      | "trend"
      | "clock"
      | "search"
      | "sort"
      | "chevron-left"
      | "chevron-right"
      | "database"
      | "code"
      | "revoke"
      | "cancel"
      | "more"
      | "copy"
      | "arrow-up-right"
      | "chevron-down"
      | "chevron-up"
      | "close"
      | "check"
      | "alert"
      | "lock"
      | "globe"
      | "sparkle"
      | "sliders"
      | "external"
      | "menu";
    size?: number;
  }>(),
  { size: 18 },
);
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <template v-if="name === 'radar'">
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 4v2M20 12h-2M12 20v-2M4 12h2M14.2 9.8 19 5" />
    </template>
    <template v-else-if="name === 'overview'">
      <path d="M4 13h6V4H4zM14 20h6V11h-6zM4 20h6v-3H4zM14 7h6V4h-6z" />
    </template>
    <template v-else-if="name === 'products'">
      <path d="m4 8 8-4 8 4-8 4zM4 8v8l8 4 8-4V8M12 12v8" />
    </template>
    <template v-else-if="name === 'diagnostics'">
      <path d="M9 3h6l1 3 3 1v6l-3 1-1 3H9l-1-3-3-1V7l3-1z" />
      <circle cx="12" cy="10" r="2.5" />
      <path d="M12 17v4" />
    </template>
    <template v-else-if="name === 'refresh'">
      <path d="M20 11a8 8 0 0 0-14.5-4L4 9M4 4v5h5M4 13a8 8 0 0 0 14.5 4L20 15M20 20v-5h-5" />
    </template>
    <template v-else-if="name === 'download'">
      <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
    </template>
    <template v-else-if="name === 'file'">
      <path d="M6 3h8l4 4v14H6zM14 3v5h5M9 13h6M9 17h6" />
    </template>
    <template v-else-if="name === 'shield'">
      <path d="M12 3 5 6v5c0 4.6 2.9 8.1 7 10 4.1-1.9 7-5.4 7-10V6z" />
      <path d="m9 12 2 2 4-4" />
    </template>
    <template v-else-if="name === 'box'">
      <path d="m4 8 8-4 8 4-8 4zM4 8v8l8 4 8-4V8M12 12v8" />
    </template>
    <template v-else-if="name === 'layers'">
      <path d="m12 3 9 5-9 5-9-5zM3 12l9 5 9-5M3 16l9 5 9-5" />
    </template>
    <template v-else-if="name === 'tag'">
      <path d="M4 4h7l9 9-7 7-9-9z" />
      <circle cx="8" cy="8" r="1" />
    </template>
    <template v-else-if="name === 'trend'">
      <path d="m4 17 5-5 4 3 7-8M15 7h5v5" />
    </template>
    <template v-else-if="name === 'clock'">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </template>
    <template v-else-if="name === 'search'">
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 4 4" />
    </template>
    <template v-else-if="name === 'sort'">
      <path d="M8 6h10M8 12h7M8 18h4M4 4v16M2 18l2 2 2-2" />
    </template>
    <template v-else-if="name === 'chevron-left'">
      <path d="m15 18-6-6 6-6" />
    </template>
    <template v-else-if="name === 'chevron-right'">
      <path d="m9 18 6-6-6-6" />
    </template>
    <template v-else-if="name === 'database'">
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
    </template>
    <template v-else-if="name === 'code'">
      <path d="m8 9-3 3 3 3M16 9l3 3-3 3M14 5l-4 14" />
    </template>
    <template v-else-if="name === 'revoke'">
      <path d="M5 5l14 14M10 4.5A8 8 0 0 1 19.5 14M14 19.5A8 8 0 0 1 4.5 10" />
    </template>
    <template v-else-if="name === 'more'">
      <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="name === 'copy'">
      <rect x="8" y="8" width="11" height="12" rx="1.5" />
      <path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v10A1.5 1.5 0 0 0 5.5 17H8" />
    </template>
    <template v-else-if="name === 'arrow-up-right' || name === 'external'">
      <path d="M7 17 17 7M9 7h8v8" />
    </template>
    <template v-else-if="name === 'chevron-down'">
      <path d="m6 9 6 6 6-6" />
    </template>
    <template v-else-if="name === 'chevron-up'">
      <path d="m6 15 6-6 6 6" />
    </template>
    <template v-else-if="name === 'close'">
      <path d="m6 6 12 12M18 6 6 18" />
    </template>
    <template v-else-if="name === 'check'">
      <path d="m5 12 4.2 4.2L19 6.5" />
    </template>
    <template v-else-if="name === 'alert'">
      <path d="m12 3 9 17H3z" />
      <path d="M12 9v4M12 17h.01" />
    </template>
    <template v-else-if="name === 'lock'">
      <rect x="5" y="10" width="14" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v2" />
    </template>
    <template v-else-if="name === 'globe'">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.2 2.4 3.3 5.4 3.3 9S14.2 18.6 12 21c-2.2-2.4-3.3-5.4-3.3-9S9.8 5.4 12 3" />
    </template>
    <template v-else-if="name === 'sparkle'">
      <path d="m12 3 1.2 5.8L19 10l-5.8 1.2L12 17l-1.2-5.8L5 10l5.8-1.2zM19 16l.5 2.5L22 19l-2.5.5L19 22l-.5-2.5L16 19l2.5-.5z" />
    </template>
    <template v-else-if="name === 'sliders'">
      <path d="M4 7h16M4 17h16M8 4v6M16 14v6" />
    </template>
    <template v-else-if="name === 'menu'">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </template>
    <template v-else>
      <path d="m6 6 12 12M18 6 6 18" />
    </template>
  </svg>
</template>
