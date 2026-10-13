import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** 合併 className，後者覆蓋前者衝突的 Tailwind 類別。 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
