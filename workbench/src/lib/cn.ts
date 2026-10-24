import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * 合併 className，後者覆蓋前者衝突的 Tailwind 類別。
 * clsx 處理條件式（false、undefined、物件寫法），twMerge 去掉被覆蓋的類別（例如 'p-2 p-4' → 'p-4'）。
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
