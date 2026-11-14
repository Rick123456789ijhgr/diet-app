// 實驗結果頁的共用部分：結果資料夾輸入框與精簡下拉選單。
// E1 消融與自適應策略讀同一個結果資料夾（research/experiments/e1_barcode/runs），資料夾放在頁面層共用。
import { FolderPicker } from '@/components/FolderPicker'

/** 結果資料夾輸入框；空白為後端預設路徑（placeholder 顯示後端回報的實際路徑）。 */
export function RootInput({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted text-xs">結果資料夾（空白為預設）</span>
      <div className="flex gap-2">
        <input
          aria-label="結果資料夾"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? 'research/experiments/e1_barcode/runs'}
          className="border-card-border bg-sunken focus-visible:border-primary focus-visible:bg-card readout h-7 min-w-0 flex-1 rounded-lg border px-2 text-xs focus-visible:outline-none"
        />
        <FolderPicker value={value || placeholder || ''} onPick={onChange} />
      </div>
    </div>
  )
}

/**
 * 精簡下拉選單（原生 select）。
 * - options 為空時停用，並顯示 empty 作為唯一的佔位選項。
 * - help 以 title 屬性顯示為滑鼠停留提示。
 */
export function Select({
  label,
  value,
  onChange,
  options,
  empty,
  help,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  empty?: string
  help?: string
}) {
  return (
    <label className="flex flex-col gap-1" title={help}>
      <span className="text-muted text-xs">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={options.length === 0}
        className="border-card-border bg-sunken focus-visible:border-primary focus-visible:bg-card h-7 rounded-lg border px-2 text-xs focus-visible:outline-none"
      >
        {options.length === 0 && <option>{empty}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}
