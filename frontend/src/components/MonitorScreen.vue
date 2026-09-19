<template>
  <Teleport to="body">
    <div v-if="store.monitorOpen" class="monitor-root">
      <header class="monitor-header">
        <div class="header-left">
          <h1>📡 射频信号分析监控大屏</h1>
          <span class="badge readonly">只读模式</span>
          <span class="badge" :class="statusClass">
            <span class="status-dot" />{{ statusText }}
          </span>
          <span class="meta-time">{{ clock }}</span>
        </div>
        <div class="header-readings">
          <div class="mini-reading"><span class="mini-label">检测类型</span><span class="mini-val blue">{{ typeText }}</span></div>
          <div class="mini-reading"><span class="mini-label">置信度</span><span class="mini-val">{{ confidenceText }}</span></div>
          <div class="mini-reading"><span class="mini-label">符号速率</span><span class="mini-val">{{ symbolRateText }}</span></div>
          <div class="mini-reading"><span class="mini-label">载波频偏</span><span class="mini-val">{{ freqOffsetText }}</span></div>
        </div>
        <div class="header-actions">
          <span class="meta-time small">更新于 {{ store.monitorLastChecked || '—' }}</span>
          <el-button size="small" :loading="store.monitorFetching" @click="store.refreshMonitor()">🔄 刷新</el-button>
          <el-button size="small" :type="autoplay ? 'primary' : 'default'" @click="toggleAutoplay">
            {{ autoplay ? '⏸ 暂停轮播' : '▶ 自动轮播' }}
          </el-button>
          <el-button size="small" type="danger" plain @click="store.closeMonitor()">✕ 退出大屏</el-button>
        </div>
      </header>

      <!-- 无数据空态：不展示任何旧图表 -->
      <div v-if="!store.monitorSnapshot" class="monitor-empty">
        <div class="empty-icon">📭</div>
        <div class="empty-title">{{ emptyTitle }}</div>
        <div class="empty-desc">{{ emptyDesc }}</div>
        <el-button type="primary" :loading="store.monitorFetching" @click="store.refreshMonitor()">重新读取</el-button>
      </div>

      <template v-else>
        <!-- 本次未取到数据：保留上一屏内容，顶部标出 -->
        <div v-if="store.monitorStatus === 'stale'" class="stale-banner">
          ⚠️ 本次未取到数据{{ store.monitorError ? `（${store.monitorError}）` : '' }}，以下为上一屏内容（{{ dataTime }}）
        </div>

        <main class="monitor-body" @mouseenter="hovering = true" @mouseleave="hovering = false">
          <!-- 第 1 屏：概览（关键读数 + 图表集中一屏） -->
          <section v-show="store.monitorSlide === 0" class="slide slide-overview">
            <div class="kpi-row">
              <div class="kpi-card">
                <div class="kpi-label">检测调制类型</div>
                <div class="kpi-value blue">{{ typeText }}</div>
              </div>
              <div class="kpi-card">
                <div class="kpi-label">识别置信度</div>
                <div class="kpi-value">{{ confidenceText }}</div>
              </div>
              <div class="kpi-card">
                <div class="kpi-label">符号速率</div>
                <div class="kpi-value">{{ symbolRateText }}</div>
              </div>
              <div class="kpi-card">
                <div class="kpi-label">载波频率偏移</div>
                <div class="kpi-value">{{ freqOffsetText }}</div>
              </div>
            </div>
            <div class="overview-mosaic">
              <div class="mpanel mp-spectrum">
                <h3>📊 FFT频谱图</h3>
                <div ref="spectrumSmallEl" class="chart-box"></div>
              </div>
              <div class="mpanel mp-constellation">
                <h3>⭐ 星座图 (IQ平面)</h3>
                <canvas ref="constSmallCvs" class="cvs-box"></canvas>
              </div>
              <div class="mpanel mp-waterfall">
                <h3>🌊 瀑布图 (Spectrogram)</h3>
                <canvas ref="waterSmallCvs" class="cvs-box"></canvas>
              </div>
              <div class="mpanel mp-candidates">
                <h3>🔬 候选调制方式</h3>
                <div class="candidate-list">
                  <div v-for="c in candidates" :key="c.type" class="candidate-row-lg">
                    <span class="c-type-lg">{{ c.type }}</span>
                    <el-progress :percentage="Math.round(c.score * 100)" :stroke-width="12" :color="progressColor(c.score)" />
                  </div>
                </div>
              </div>
            </div>
          </section>

          <!-- 第 2 屏：频谱 + 瀑布图 -->
          <section v-show="store.monitorSlide === 1" class="slide slide-dual">
            <div class="big-panel">
              <h3>📊 FFT频谱图</h3>
              <div ref="spectrumBigEl" class="chart-box big"></div>
            </div>
            <div class="big-panel">
              <h3>🌊 瀑布图 (Spectrogram)</h3>
              <canvas ref="waterBigCvs" class="cvs-box big"></canvas>
            </div>
          </section>

          <!-- 第 3 屏：星座图 + 调制识别 -->
          <section v-show="store.monitorSlide === 2" class="slide slide-dual">
            <div class="big-panel">
              <h3>⭐ 星座图 (IQ平面)</h3>
              <canvas ref="constBigCvs" class="cvs-box big"></canvas>
            </div>
            <div class="big-panel modulation-panel">
              <h3>🔬 调制识别结果</h3>
              <div class="kpi-row compact">
                <div class="kpi-card"><div class="kpi-label">检测类型</div><div class="kpi-value blue">{{ typeText }}</div></div>
                <div class="kpi-card"><div class="kpi-label">置信度</div><div class="kpi-value">{{ confidenceText }}</div></div>
                <div class="kpi-card"><div class="kpi-label">符号速率</div><div class="kpi-value">{{ symbolRateText }}</div></div>
              </div>
              <div class="candidate-list big-list">
                <div v-for="c in candidates" :key="c.type" class="candidate-row-lg">
                  <span class="c-type-lg">{{ c.type }}</span>
                  <el-progress :percentage="Math.round(c.score * 100)" :stroke-width="16" :color="progressColor(c.score)" />
                </div>
              </div>
            </div>
          </section>

          <!-- 手动切换 -->
          <button class="nav-arrow left" @click="prevSlide">‹</button>
          <button class="nav-arrow right" @click="nextSlide">›</button>
          <div class="dots">
            <button v-for="(t, i) in slideTitles" :key="t" class="dot" :class="{ active: store.monitorSlide === i }" @click="goSlide(i)">
              <span class="dot-index">{{ i + 1 }}</span>{{ t }}
            </button>
          </div>
        </main>
      </template>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import * as echarts from 'echarts'
import { useSignalStore } from '../store/signal'

const store = useSignalStore()
const SLIDE_COUNT = 3
const slideTitles = ['概览', '频谱 / 瀑布图', '星座图 / 识别']
const AUTOPLAY_KEY = 'monitor-autoplay'
const AUTOPLAY_INTERVAL = 8000
const POLL_INTERVAL = 5000

const autoplay = ref(localStorage.getItem(AUTOPLAY_KEY) !== 'off')
const hovering = ref(false)
const clock = ref('')

// ---- 图表 / 画布引用（v-show 常驻，挂载时即可初始化） ----
const spectrumSmallEl = ref<HTMLDivElement>()
const spectrumBigEl = ref<HTMLDivElement>()
const constSmallCvs = ref<HTMLCanvasElement>()
const constBigCvs = ref<HTMLCanvasElement>()
const waterSmallCvs = ref<HTMLCanvasElement>()
const waterBigCvs = ref<HTMLCanvasElement>()
let spectrumSmallChart: echarts.ECharts | null = null
let spectrumBigChart: echarts.ECharts | null = null
let resizeObserver: ResizeObserver | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
let autoTimer: ReturnType<typeof setInterval> | null = null
let clockTimer: ReturnType<typeof setInterval> | null = null

// ---- 关键读数（与结果区 ModulationResult 保持一致） ----
const mod = computed(() => store.monitorSnapshot?.modulation)
const typeText = computed(() => mod.value?.type || '—')
const confidenceText = computed(() => mod.value ? `${Math.round(mod.value.confidence * 100)}%` : '—')
const symbolRateText = computed(() => mod.value?.symbolRate != null ? `${mod.value.symbolRate.toFixed(0)} Baud` : 'N/A')
const freqOffsetText = computed(() => mod.value?.frequencyOffset != null ? `${mod.value.frequencyOffset} Hz` : 'N/A')
const candidates = computed(() => store.monitorSnapshot?.modulation.candidates ?? [])
const dataTime = computed(() => store.monitorSnapshot?.generatedAt
  ? new Date(store.monitorSnapshot.generatedAt).toLocaleString('zh-CN', { hour12: false })
  : '未知时间')

const statusClass = computed(() => ({
  ok: 'st-ok', stale: 'st-stale', empty: 'st-empty', idle: 'st-idle'
}[store.monitorStatus]))
const statusText = computed(() => ({
  ok: '数据正常', stale: '未取到数据·展示上一屏', empty: '暂无数据', idle: '正在读取…'
}[store.monitorStatus]))
const emptyTitle = computed(() => store.monitorStatus === 'idle' ? '正在读取数据…' : '暂无分析数据')
const emptyDesc = computed(() => store.monitorStatus === 'idle'
  ? '正在从分析服务获取最新读数，请稍候'
  : store.monitorError
    ? `${store.monitorError}。请先在主界面执行一次信号分析，大屏将自动加载结果。`
    : '还没有任何分析结果。请先在主界面执行一次信号分析，大屏将自动加载结果。')

function progressColor(score: number) {
  if (score > 0.7) return '#66bb6a'
  if (score > 0.4) return '#ffa726'
  return '#ef5350'
}

// ---- 频谱图（与 SpectrumPlot.vue 相同的数据截取与配置） ----
function buildSpectrumOption() {
  const s = store.monitorSnapshot
  if (!s) return null
  const { frequencies, magnitudes } = s.spectrum
  const halfN = Math.floor(frequencies.length / 2)
  const data: [number, number][] = []
  for (let i = 0; i < halfN; i++) data.push([frequencies[i], magnitudes[i]])
  return {
    backgroundColor: 'transparent',
    grid: { left: 60, right: 25, top: 20, bottom: 45 },
    xAxis: { type: 'value', name: '频率 (Hz)', nameLocation: 'middle', nameGap: 28, axisLabel: { color: '#8899aa' } },
    yAxis: { type: 'value', name: '幅度 (dB)', nameLocation: 'middle', nameGap: 45, axisLabel: { color: '#8899aa' } },
    series: [{
      type: 'line', data, symbol: 'none', lineStyle: { color: '#42a5f5', width: 1.5 },
      areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(66,165,245,0.4)' }, { offset: 1, color: 'rgba(66,165,245,0.02)' }]) }
    }],
    animation: false
  }
}
function renderSpectrum() {
  const option = buildSpectrumOption()
  if (!option) return
  spectrumSmallChart?.setOption(option)
  spectrumBigChart?.setOption(option)
}

// ---- 星座图（与 ConstellationPlot.vue 相同的映射与配色，按容器尺寸自适应） ----
function drawConstellation(cvs: HTMLCanvasElement | undefined) {
  if (!cvs) return
  const ctx = cvs.getContext('2d')
  if (!ctx) return
  const rect = cvs.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return
  const dpr = window.devicePixelRatio || 1
  const W = rect.width, H = rect.height
  cvs.width = Math.round(W * dpr)
  cvs.height = Math.round(H * dpr)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = '#0d1520'
  ctx.fillRect(0, 0, W, H)
  ctx.strokeStyle = '#2a3a4a'
  ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke()
  const pts = store.monitorSnapshot?.constellation || []
  if (pts.length) {
    const scale = Math.min(W, H) * 0.4
    for (const pt of pts) {
      const x = W / 2 + pt.i * scale, y = H / 2 - pt.q * scale
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2)
      ctx.fillStyle = '#42a5f5'; ctx.fill()
      ctx.strokeStyle = 'rgba(66,165,245,0.5)'; ctx.stroke()
    }
  }
  ctx.fillStyle = '#8899aa'
  ctx.font = '10px system-ui'
  ctx.fillText('I →', W - 25, H / 2 - 5)
  ctx.fillText('Q ↑', W / 2 + 5, 14)
}

// ---- 瀑布图（与 WaterfallPlot.vue 相同的逐行归一化与配色） ----
function drawWaterfall(cvs: HTMLCanvasElement | undefined) {
  if (!cvs) return
  const ctx = cvs.getContext('2d')
  if (!ctx) return
  const rect = cvs.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return
  const dpr = window.devicePixelRatio || 1
  const W = rect.width, H = rect.height
  cvs.width = Math.round(W * dpr)
  cvs.height = Math.round(H * dpr)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = '#0d1520'
  ctx.fillRect(0, 0, W, H)
  const rows = store.monitorSnapshot?.waterfall || []
  if (!rows.length) return
  const rowH = H / rows.length
  for (let r = 0; r < rows.length; r++) {
    const vals = rows[r].values, n = vals.length
    if (!n) continue
    const valsMin = Math.min(...vals), valsMax = Math.max(...vals)
    const vRange = valsMax - valsMin || 1
    for (let i = 0; i < n; i++) {
      const t = (vals[i] - valsMin) / vRange
      const rv = Math.round(t * 200)
      const gv = Math.round(t * 100 + (1 - t) * 50)
      const bv = Math.round((1 - t) * 200 + 30)
      ctx.fillStyle = `rgb(${rv},${gv},${bv})`
      ctx.fillRect(i * W / n, r * rowH, W / n + 1, rowH + 1)
    }
  }
}

function renderAll() {
  renderSpectrum()
  drawConstellation(constSmallCvs.value)
  drawConstellation(constBigCvs.value)
  drawWaterfall(waterSmallCvs.value)
  drawWaterfall(waterBigCvs.value)
}

// ---- 轮播：自动 + 手动；悬停暂停 ----
function goSlide(i: number) {
  store.setMonitorSlide((i + SLIDE_COUNT) % SLIDE_COUNT)
  restartAuto()
}
function nextSlide() { goSlide(store.monitorSlide + 1) }
function prevSlide() { goSlide(store.monitorSlide - 1) }
function toggleAutoplay() {
  autoplay.value = !autoplay.value
  localStorage.setItem(AUTOPLAY_KEY, autoplay.value ? 'on' : 'off')
  restartAuto()
}
function restartAuto() {
  if (autoTimer) { clearInterval(autoTimer); autoTimer = null }
  if (autoplay.value && !hovering.value && store.monitorOpen && store.monitorSnapshot) {
    autoTimer = setInterval(() => {
      if (!hovering.value) store.setMonitorSlide((store.monitorSlide + 1) % SLIDE_COUNT)
    }, AUTOPLAY_INTERVAL)
  }
}

function updateClock() {
  clock.value = new Date().toLocaleString('zh-CN', { hour12: false })
}

function onKeydown(e: KeyboardEvent) {
  if (!store.monitorOpen) return
  if (e.key === 'Escape') store.closeMonitor()
  else if (e.key === 'ArrowRight') nextSlide()
  else if (e.key === 'ArrowLeft') prevSlide()
}

function ensureCharts() {
  if (!spectrumSmallChart && spectrumSmallEl.value) spectrumSmallChart = echarts.init(spectrumSmallEl.value)
  if (!spectrumBigChart && spectrumBigEl.value) spectrumBigChart = echarts.init(spectrumBigEl.value)
}

function onSnapshotChange(newVal: unknown, oldVal: unknown) {
  // 空态 -> 有数据时图表 DOM 才挂载，需等下一帧再初始化与绘制
  requestAnimationFrame(() => { ensureCharts(); renderAll() })
  // 仅在空态恢复时重启轮播；普通轮询刷新不能重置计时，否则自动轮播永远不翻页
  if (!oldVal && newVal) restartAuto()
}

// 快照更新后重绘（成功替换 / 失败保留均会触发；失败时重绘的仍是上一屏数据）
watch(() => store.monitorSnapshot, onSnapshotChange)
watch(() => store.monitorSlide, () => {
  // v-show 切换后让 ECharts 重新适配尺寸
  requestAnimationFrame(() => { spectrumSmallChart?.resize(); spectrumBigChart?.resize(); renderAll() })
})
watch(hovering, restartAuto)

// 重新打开大屏：停在原来那屏，立即重新读取（失败会自动保留上一屏）
watch(() => store.monitorOpen, (open) => {
  if (open) {
    updateClock()
    requestAnimationFrame(() => {
      ensureCharts()
      spectrumSmallChart?.resize()
      spectrumBigChart?.resize()
      renderAll()
    })
    store.refreshMonitor()
    restartAuto()
  } else if (autoTimer) {
    clearInterval(autoTimer)
    autoTimer = null
  }
})

onMounted(() => {
  updateClock()
  clockTimer = setInterval(updateClock, 1000)

  if (store.monitorOpen) {
    ensureCharts()
    renderAll()
    restartAuto()
  }

  resizeObserver = new ResizeObserver(() => {
    if (!store.monitorOpen) return
    spectrumSmallChart?.resize()
    spectrumBigChart?.resize()
    renderAll()
  })
  resizeObserver.observe(document.body)

  // 轮询只读接口（仅大屏打开期间发请求）
  pollTimer = setInterval(() => { if (store.monitorOpen) store.refreshMonitor() }, POLL_INTERVAL)
  window.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  pollTimer && clearInterval(pollTimer)
  autoTimer && clearInterval(autoTimer)
  clockTimer && clearInterval(clockTimer)
  resizeObserver?.disconnect()
  spectrumSmallChart?.dispose()
  spectrumBigChart?.dispose()
  window.removeEventListener('keydown', onKeydown)
})
</script>

<style scoped>
.monitor-root {
  position: fixed; inset: 0; z-index: 2000;
  background: radial-gradient(ellipse at top, #13202f 0%, #0b121b 100%);
  display: flex; flex-direction: column; overflow: hidden;
}

/* ---- 顶部栏 ---- */
.monitor-header {
  display: flex; align-items: center; gap: 24px; flex-wrap: wrap;
  padding: 14px 28px;
  background: linear-gradient(135deg, #1a2332, #243447);
  border-bottom: 1px solid #2a3a4a;
}
.header-left { display: flex; align-items: center; gap: 12px }
.header-left h1 { font-size: 1.25rem; color: #64b5f6; white-space: nowrap }
.badge {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 12px; padding: 3px 10px; border-radius: 999px;
  border: 1px solid #3a4a5a; color: #b0bec5; background: #0d1520;
}
.badge.readonly { border-color: #64b5f6; color: #90caf9 }
.status-dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor }
.st-ok { color: #66bb6a; border-color: #66bb6a }
.st-stale { color: #ffa726; border-color: #ffa726 }
.st-empty { color: #90a4ae; border-color: #607d8b }
.st-idle { color: #64b5f6; border-color: #64b5f6 }
.meta-time { font-size: 12px; color: #78909c; white-space: nowrap }
.meta-time.small { opacity: .8 }

.header-readings { display: flex; gap: 20px; flex: 1; justify-content: center; flex-wrap: wrap }
.mini-reading { display: flex; flex-direction: column; align-items: center; gap: 2px }
.mini-label { font-size: 11px; color: #78909c }
.mini-val { font-size: 17px; font-weight: 700; color: #e0e0e0 }
.mini-val.blue { color: #64b5f6 }

.header-actions { display: flex; align-items: center; gap: 10px }

/* ---- 空态 ---- */
.monitor-empty {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px;
}
.empty-icon { font-size: 72px }
.empty-title { font-size: 24px; font-weight: 700; color: #cfd8dc }
.empty-desc { color: #78909c; font-size: 14px; max-width: 520px; text-align: center; line-height: 1.7 }

/* ---- 断流标记条 ---- */
.stale-banner {
  padding: 8px 28px; background: rgba(255, 167, 38, .14);
  border-bottom: 1px solid rgba(255, 167, 38, .45);
  color: #ffcc80; font-size: 13px;
}

/* ---- 主体 / 分屏 ---- */
.monitor-body { flex: 1; position: relative; padding: 20px 28px 64px; min-height: 0 }
.slide { height: 100%; display: flex; flex-direction: column; gap: 16px; animation: fadein .25s ease }
@keyframes fadein { from { opacity: 0 } to { opacity: 1 } }

.kpi-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px }
.kpi-row.compact { grid-template-columns: repeat(3, 1fr) }
.kpi-card {
  background: #1a2332; border: 1px solid #2a3a4a; border-radius: 10px;
  padding: 18px; text-align: center;
}
.kpi-label { font-size: 13px; color: #8899aa; margin-bottom: 8px }
.kpi-value { font-size: 30px; font-weight: 700; color: #e0e0e0; line-height: 1.1 }
.kpi-value.blue { color: #64b5f6 }
.kpi-row.compact .kpi-value { font-size: 24px }

.overview-mosaic {
  flex: 1; min-height: 0;
  display: grid; gap: 16px;
  grid-template-columns: 1.3fr 1fr;
  grid-template-rows: 1fr 1fr;
}
.mpanel { background: #1a2332; border: 1px solid #2a3a4a; border-radius: 10px; padding: 14px; display: flex; flex-direction: column; min-height: 0 }
.mpanel h3 { color: #90caf9; font-size: 14px; margin-bottom: 10px }
.mp-spectrum { grid-row: 1 }
.mp-constellation { grid-column: 2; grid-row: 1 }
.mp-waterfall { grid-column: 1; grid-row: 2 }
.mp-candidates { grid-column: 2; grid-row: 2 }
.chart-box, .cvs-box { flex: 1; min-height: 0; width: 100%; border-radius: 6px }
.cvs-box { display: block }

.slide-dual { display: grid; grid-template-rows: 1fr 1fr; gap: 16px }
.big-panel {
  background: #1a2332; border: 1px solid #2a3a4a; border-radius: 10px;
  padding: 18px; display: flex; flex-direction: column; min-height: 0;
}
.big-panel h3 { color: #90caf9; font-size: 16px; margin-bottom: 12px }
.chart-box.big, .cvs-box.big { flex: 1 }
.modulation-panel { gap: 4px }
.big-list { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 6px }

.candidate-list { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 4px; min-height: 0 }
.candidate-row-lg { display: flex; align-items: center; gap: 14px; margin: 7px 0 }
.c-type-lg { width: 64px; flex-shrink: 0; font-size: 15px; color: #e0e0e0 }

/* ---- 导航 ---- */
.nav-arrow {
  position: absolute; top: 50%; transform: translateY(-50%);
  width: 46px; height: 46px; border-radius: 50%;
  border: 1px solid #3a4a5a; background: rgba(13, 21, 32, .75);
  color: #90caf9; font-size: 26px; line-height: 1; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background .2s;
}
.nav-arrow:hover { background: #1a2332 }
.nav-arrow.left { left: 10px }
.nav-arrow.right { right: 10px }

.dots {
  position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%);
  display: flex; gap: 10px;
}
.dot {
  display: inline-flex; align-items: center; gap: 6px;
  background: rgba(13, 21, 32, .8); border: 1px solid #3a4a5a; border-radius: 999px;
  color: #90a4ae; font-size: 12px; padding: 6px 14px; cursor: pointer;
}
.dot-index {
  display: inline-flex; align-items: center; justify-content: center;
  width: 16px; height: 16px; border-radius: 50%;
  background: #2a3a4a; font-size: 10px;
}
.dot.active { color: #90caf9; border-color: #64b5f6; background: rgba(66, 165, 245, .12) }
.dot.active .dot-index { background: #64b5f6; color: #0b121b }
</style>
