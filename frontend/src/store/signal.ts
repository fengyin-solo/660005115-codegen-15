import { defineStore } from 'pinia'
import { ref } from 'vue'
import axios from 'axios'
import type { AnalysisResult } from '@/types'

export const useSignalStore = defineStore('signal', () => {
  const loading = ref(false)
  const result = ref<AnalysisResult | null>(null)
  const activeView = ref('spectrum')
  // Monitor dashboard state. dashboardPage lives here (not in the component)
  // so reopening the dashboard returns to the same screen.
  const dashboardOpen = ref(false)
  const dashboardPage = ref(0)

  async function analyze(params: { modulation: string; samples: number; snr: number }) {
    loading.value = true
    try {
      const { data } = await axios.post('/api/generate', params)
      result.value = data
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

  // Poll the latest result for the monitor dashboard. A failed read never
  // touches the current result, so the dashboard keeps its previous screen.
  async function fetchLatest(): Promise<'ok' | 'empty' | 'error'> {
    try {
      const { data } = await axios.get('/api/result/latest')
      result.value = data
      return 'ok'
    } catch (e) {
      if (axios.isAxiosError(e) && e.response?.status === 404) return 'empty'
      return 'error'
    }
  }

  function openDashboard() { dashboardOpen.value = true }
  function closeDashboard() { dashboardOpen.value = false }

  return {
    loading, result, activeView, dashboardOpen, dashboardPage,
    analyze, importCSV, fetchLatest, openDashboard, closeDashboard
  }
})