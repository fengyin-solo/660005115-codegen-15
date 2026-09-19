export interface SignalData {
  i: number[]
  q: number[]
  sampleRate: number
  centerFreq: number
}

export interface SpectrumData {
  frequencies: number[]
  magnitudes: number[]
}

export interface WaterfallRow {
  time: number
  values: number[]
}

export interface ConstellationPoint {
  i: number
  q: number
}

export interface ModulationResult {
  type: string
  confidence: number
  candidates: { type: string; score: number }[]
  symbolRate: number | null
  frequencyOffset: number | null
}

export interface AnalysisResult {
  spectrum: SpectrumData
  waterfall: WaterfallRow[]
  constellation: ConstellationPoint[]
  modulation: ModulationResult
}

/** 监控大屏从只读接口 GET /api/result 取到的一屏快照（附带数据生成时间） */
export type MonitorSnapshot = AnalysisResult & { generatedAt?: string }

/** 大屏数据读取状态：idle 未读取过 / empty 后端无数据 / ok 成功 / stale 有旧数据但本次未取到 */
export type MonitorStatus = 'idle' | 'empty' | 'ok' | 'stale'

export const MODULATION_TYPES = ['AM', 'FM', 'BPSK', 'QPSK', '16QAM']