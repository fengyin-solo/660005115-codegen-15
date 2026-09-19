import { defineStore } from 'pinia'
import { ref } from 'vue'
import axios from 'axios'
import type { AnalysisResult, MonitorSnapshot, MonitorStatus } from '@/types'

const SLIDE_KEY = 'monitor-slide'
const SLIDE_COUNT = 3

export const useSignalStore = defineStore('signal', () => {
  const loading = ref(false)
  const result = ref<AnalysisResult | null>(null)
  const activeView = ref('spectrum')

  // ---- 只读监控大屏状态 ----
  const monitorOpen = ref(false)
  // 当前停在的屏，重新打开大屏后仍停留在此屏（localStorage 跨会话持久化）
  const savedSlide = Number(localStorage.getItem(SLIDE_KEY))
  const monitorSlide = ref(Number.isInteger(savedSlide) && savedSlide >= 0 && savedSlide < SLIDE_COUNT ? savedSlide : 0)
  // 大屏展示的快照：读取失败时保留上一屏的数据，不清空
  const monitorSnapshot = ref<MonitorSnapshot | null>(null)
  const monitorStatus = ref<MonitorStatus>('idle')
  const monitorError = ref('')
  const monitorLastChecked = ref('')
  const monitorFetching = ref(false)

  async function analyze(params: { modulation: string; samples: number; snr: number }) {
    loading.value = true
    try {
      const { data } = await axios.post('/api/generate', params)
      result.value = data
      // 大屏打开时，结果区的最新数据立即同步到大屏，保持内容一致
      if (monitorOpen.value) {
        monitorSnapshot.value = { ...data, generatedAt: new Date().toISOString() }
        monitorStatus.value = 'ok'
        monitorError.value = ''
        monitorLastChecked.value = new Date().toLocaleTimeString('zh-CN', { hour12: false })
      }
    } finally { loading.value = false }
  }

  async function importCSV(formData: FormData) {
    loading.value = true
    try {
      const { data } = await axios.post('/api/import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      result.value = data
    } finally { loading.value = false }
  }

  /**
   * 大屏只读刷新：
   * - 成功：替换快照、清除断流标记
   * - 失败但本地有上一屏：保留旧快照，标记 stale（本次未取到数据）
   * - 失败且本地无数据：空态
   */
  let inflight = false
  async function refreshMonitor() {
    if (inflight) return
    inflight = true
    monitorFetching.value = true
    try {
      const { data } = await axios.get<MonitorSnapshot>('/api/result')
      monitorSnapshot.value = data
      monitorStatus.value = 'ok'
      monitorError.value = ''
    } catch (e) {
      const is404 = axios.isAxiosError(e) && e.response?.status === 404
      if (monitorSnapshot.value) {
        // 有上一屏：无论何种失败都保留旧数据，仅标记本次未取到
        monitorStatus.value = 'stale'
        monitorError.value = is404
          ? '服务端暂无分析数据'
          : (axios.isAxiosError(e) ? (e.response ? `读取失败（${e.response.status}）` : '网络异常，未取到数据') : '读取失败')
      } else {
        // 本地也没有任何数据：展示空态
        monitorStatus.value = 'empty'
        monitorError.value = is404 ? '' : (axios.isAxiosError(e)
          ? (e.response ? `读取失败（${e.response.status}）` : '网络异常，未取到数据')
          : '读取失败')
      }
    } finally {
      monitorLastChecked.value = new Date().toLocaleTimeString('zh-CN', { hour12: false })
      monitorFetching.value = false
      inflight = false
    }
  }

  function openMonitor() {
    monitorOpen.value = true
    // 打开时立即拉一次；失败会自动保留上一屏
    refreshMonitor()
  }
  function closeMonitor() { monitorOpen.value = false }

  function setMonitorSlide(i: number) {
    monitorSlide.value = ((i % SLIDE_COUNT) + SLIDE_COUNT) % SLIDE_COUNT
    localStorage.setItem(SLIDE_KEY, String(monitorSlide.value))
  }

  return {
    loading, result, activeView, analyze, importCSV,
    monitorOpen, monitorSlide, monitorSnapshot, monitorStatus, monitorError, monitorLastChecked, monitorFetching,
    refreshMonitor, openMonitor, closeMonitor, setMonitorSlide
  }
})
