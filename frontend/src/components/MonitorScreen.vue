<template>
  <div class="monitor-overlay" @mouseenter="hovering = true" @mouseleave="hovering = false">
    <header class="mon-header">
      <div class="mon-title">
        <span class="mon-logo">📡</span>
        <div>
          <h2>监控大屏 · 射频信号分析</h2>
          <p class="mon-sub">只读视图 · 内容与结果区保持一致</p>
        </div>
      </div>
      <div class="mon-status">
        <span v-if="fetchFailed && store.result" class="badge badge-warn">⚠ 本次未取到数据，展示上次结果</span>
        <span v-else-if="store.result" class="badge badge-ok">● 数据正常</span>
        <span class="clock">{{ clock }}</span>
        <button class="close-btn" @click="store.closeDashboard()">✕ 关闭</button>
      </div>
    </header>

    <div v-if="!store.result" class="empty-state">
      <div class="empty-icon">📭</div>
      <h3>暂无分析数据</h3>
      <p>尚未获取到分析结果，请先在主界面生成信号并完成分析，大屏将自动同步展示。</p>
      <p v-if="fetchFailed" class="empty-warn">⚠ 本次尝试读取数据未成功，将继续自动重试</p>
    </div>

    <template v-else>
      <div class="metric-strip">
        <div v-for="m in metrics" :key="m.label" class="metric">
          <div class="m-label">{{ m.label }}</div>
          <div class="m-value" :class="{ hl: m.hl }">{{ m.value }}</div>
        </div>
      </div>

      <div class="screen-body">
        <div v-if="store.dashboardPage === 0" class="screen-page">
          <div class="grid-2">
            <SpectrumPlot />
            <ConstellationPlot />
          </div>
          <WaterfallPlot />
        </div>
        <div v-else-if="store.dashboardPage === 1" class="screen-page">
          <SpectrumPlot />
          <WaterfallPlot />
        </div>
        <div v-else class="screen-page">
          <div class="grid-2">
            <ModulationResult />
            <ConstellationPlot />
          </div>
        </div>
      </div>

      <footer class="mon-footer">
        <div class="pager">
          <button class="nav-btn" title="上一屏" @click="go(store.dashboardPage - 1)">◀</button>
          <span
            v-for="(t, i) in pages" :key="t"
            class="page-tab" :class="{ active: i === store.dashboardPage }"
            @click="go(i)"
          >{{ t }}</span>
          <button class="nav-btn" title="下一屏" @click="go(store.dashboardPage + 1)">▶</button>
        </div>
        <div class="footer-right">
          <button class="nav-btn" @click="toggleRotate">{{ autoRotate ? '⏸ 暂停轮播' : '▶ 恢复轮播' }}</button>
          <span class="last-update">上次更新 {{ lastUpdateText }}</span>
        </div>
      </footer>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useSignalStore } from '../store/signal'
import SpectrumPlot from './SpectrumPlot.vue'
import ConstellationPlot from './ConstellationPlot.vue'
import WaterfallPlot from './WaterfallPlot.vue'
import ModulationResult from './ModulationResult.vue'

const store = useSignalStore()
const pages = ['综合概览', '频谱 · 瀑布', '星座 · 识别']

const autoRotate = ref(true)
const hovering = ref(false)
const fetchFailed = ref(false)
const clock = ref('')
const lastUpdate = ref<Date | null>(store.result ? new Date() : null)

const ROTATE_MS = 8000
const POLL_MS = 5000
let rotateTimer: number | undefined
let pollTimer: number | undefined
let clockTimer: number | undefined

const metrics = computed(() => {
  const m = store.result?.modulation
  return [
    { label: '检测调制方式', value: m?.type || '-', hl: true },
    { label: '置信度', value: m ? (m.confidence * 100).toFixed(1) + ' %' : '-', hl: false },
    { label: '符号速率', value: m?.symbolRate != null ? m.symbolRate.toFixed(0) + ' Baud' : 'N/A', hl: false },
    { label: '载波频偏', value: m?.frequencyOffset != null ? m.frequencyOffset.toFixed(2) + ' Hz' : 'N/A', hl: false }
  ]
})
const lastUpdateText = computed(() => lastUpdate.value ? fmtTime(lastUpdate.value) : '—')

function fmtTime(d: Date) { return d.toLocaleTimeString('zh-CN', { hour12: false }) }

// Current screen index is stored in the Pinia store, so it survives
// closing and reopening the dashboard.
function step(i: number) {
  const n = pages.length
  store.dashboardPage = ((i % n) + n) % n
}
function go(i: number) { step(i); restartRotate() }
function toggleRotate() { autoRotate.value = !autoRotate.value; restartRotate() }

function restartRotate() {
  if (rotateTimer) clearInterval(rotateTimer)
  rotateTimer = window.setInterval(() => {
    if (autoRotate.value && !hovering.value && store.result) step(store.dashboardPage + 1)
  }, ROTATE_MS)
}

// On a failed read, keep the current screen and data untouched and only
// flag the failure; the next successful poll clears the flag.
async function refresh() {
  const status = await store.fetchLatest()
  if (status === 'error') { fetchFailed.value = true; return }
  fetchFailed.value = false
  if (status === 'ok') lastUpdate.value = new Date()
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') store.closeDashboard()
  else if (e.key === 'ArrowLeft') go(store.dashboardPage - 1)
  else if (e.key === 'ArrowRight') go(store.dashboardPage + 1)
}

onMounted(() => {
  refresh()
  restartRotate()
  pollTimer = window.setInterval(refresh, POLL_MS)
  clock.value = fmtTime(new Date())
  clockTimer = window.setInterval(() => { clock.value = fmtTime(new Date()) }, 1000)
  window.addEventListener('keydown', onKey)
})
onUnmounted(() => {
  clearInterval(rotateTimer)
  clearInterval(pollTimer)
  clearInterval(clockTimer)
  window.removeEventListener('keydown', onKey)
})
</script>

<style scoped>
.monitor-overlay {
  position: fixed; inset: 0; z-index: 1000; overflow-y: auto;
  background: radial-gradient(ellipse at top, #10202f 0%, #0a121c 60%);
  display: flex; flex-direction: column; padding: 16px 28px;
}
.mon-header { display: flex; justify-content: space-between; align-items: center; padding-bottom: 14px; border-bottom: 1px solid #2a3a4a }
.mon-title { display: flex; align-items: center; gap: 14px }
.mon-logo { font-size: 32px }
.mon-title h2 { font-size: 1.3rem; color: #64b5f6; letter-spacing: 2px }
.mon-sub { font-size: .8rem; color: #8899aa; margin-top: 2px }
.mon-status { display: flex; align-items: center; gap: 14px }
.badge { font-size: .8rem; padding: 4px 12px; border-radius: 12px }
.badge-ok { color: #66bb6a; background: rgba(102,187,106,.12); border: 1px solid rgba(102,187,106,.4) }
.badge-warn { color: #ffa726; background: rgba(255,167,38,.12); border: 1px solid rgba(255,167,38,.5) }
.clock { font-size: .95rem; color: #90caf9; font-variant-numeric: tabular-nums }
.close-btn {
  background: #1a2332; color: #e0e0e0; border: 1px solid #2a3a4a; border-radius: 6px;
  padding: 6px 14px; cursor: pointer; font-size: .85rem
}
.close-btn:hover { border-color: #64b5f6; color: #64b5f6 }

.empty-state { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: #8899aa }
.empty-icon { font-size: 56px }
.empty-state h3 { color: #e0e0e0; font-size: 1.2rem }
.empty-warn { color: #ffa726; font-size: .85rem; margin-top: 6px }

.metric-strip { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin: 16px 0 }
.metric {
  background: linear-gradient(180deg, #16222f, #101a26); border: 1px solid #2a3a4a; border-radius: 8px;
  text-align: center; padding: 14px 8px; box-shadow: inset 0 0 24px rgba(66,165,245,.05)
}
.m-label { font-size: .78rem; color: #8899aa; margin-bottom: 6px }
.m-value { font-size: 1.6rem; font-weight: 700; color: #e0e0e0 }
.m-value.hl { color: #64b5f6; text-shadow: 0 0 12px rgba(100,181,246,.4) }

.screen-body { flex: 1 }
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px }
.grid-2 > .panel { margin-top: 0 !important }

.mon-footer {
  display: flex; justify-content: space-between; align-items: center;
  padding-top: 14px; margin-top: 16px; border-top: 1px solid #2a3a4a
}
.pager { display: flex; align-items: center; gap: 10px }
.page-tab {
  padding: 5px 14px; border-radius: 14px; font-size: .82rem; cursor: pointer;
  color: #8899aa; background: #1a2332; border: 1px solid #2a3a4a
}
.page-tab.active { color: #0a121c; background: #64b5f6; border-color: #64b5f6; font-weight: 600 }
.page-tab:hover:not(.active) { color: #64b5f6; border-color: #64b5f6 }
.nav-btn {
  background: #1a2332; color: #90caf9; border: 1px solid #2a3a4a; border-radius: 6px;
  padding: 5px 12px; cursor: pointer; font-size: .82rem
}
.nav-btn:hover { border-color: #64b5f6 }
.footer-right { display: flex; align-items: center; gap: 14px }
.last-update { font-size: .78rem; color: #8899aa }
</style>
