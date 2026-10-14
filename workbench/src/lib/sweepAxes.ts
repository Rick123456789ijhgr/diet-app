// 參數掃描的退化種類與範圍，對應 Python 的 dietai.devtools.degradations.SWEEP_AXES。
// 範圍超出時後端會回報 INVALID_PARAMS，兩邊不一致時能立即發現。

export interface SweepAxis {
  key: string
  label: string
  lo: number
  hi: number
  defaultLo: number
  defaultHi: number
  step: number
}

export const SWEEP_AXES: SweepAxis[] = [
  { key: 'blur_sigma', label: '高斯模糊 σ', lo: 0, hi: 20, defaultLo: 0, defaultHi: 8, step: 0.5 },
  { key: 'gain', label: '整體亮度倍率', lo: 0, hi: 3, defaultLo: 0.1, defaultHi: 2, step: 0.05 },
  {
    key: 'gradient',
    label: '亮度梯度強度',
    lo: 0,
    hi: 1,
    defaultLo: 0,
    defaultHi: 0.9,
    step: 0.05,
  },
  { key: 'scale', label: '縮小倍率', lo: 0.05, hi: 1, defaultLo: 0.1, defaultHi: 1, step: 0.05 },
  {
    key: 'noise_std',
    label: '高斯雜訊標準差',
    lo: 0,
    hi: 80,
    defaultLo: 0,
    defaultHi: 40,
    step: 1,
  },
  { key: 'glare', label: '光斑半徑比例', lo: 0, hi: 0.6, defaultLo: 0, defaultHi: 0.4, step: 0.02 },
  { key: 'rotate_deg', label: '旋轉角度', lo: -90, hi: 90, defaultLo: 0, defaultHi: 45, step: 1 },
]

export const axisOf = (key: string) => SWEEP_AXES.find((a) => a.key === key) ?? SWEEP_AXES[0]!
