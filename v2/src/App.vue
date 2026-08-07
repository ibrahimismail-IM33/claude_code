<script setup>
import { computed } from 'vue';
import { useProbe } from './stores/probe.js';

const probe = useProbe();
const summary = computed(() => `${probe.visible.length}/${probe.rows.length}`);
</script>

<template>
  <div id="cspProbe">
    <p class="count">{{ summary }}</p>
    <button id="probeZone" @click="probe.zone = 'A'">Zon A</button>
    <button id="probeSwasta" @click="probe.status = 'swasta'">Swasta</button>
  </div>
</template>

<style scoped>
.count { font-variant-numeric: tabular-nums }
</style>
