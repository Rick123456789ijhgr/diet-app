import { describe, expect, it } from 'vitest'

import { lockfileState, storageEnvFrom } from './devEnv.mjs'

const from = (values) => (k) => values[k]

describe('啟動腳本的資料庫設定', () => {
  it('沒有 PGHOST、PGPORT 時用 localhost:5432', () => {
    const env = storageEnvFrom(from({ POSTGRES_USER: 'diet', POSTGRES_DB: 'diet' }))
    expect(env.DATABASE_URL).toBe('postgres://diet:@localhost:5432/diet?sslmode=disable')
  })

  it('主機與埠讀 PGHOST、PGPORT，帳號密碼經編碼', () => {
    const env = storageEnvFrom(
      from({
        POSTGRES_USER: 'a@b',
        POSTGRES_PASSWORD: 'p:w',
        POSTGRES_DB: 'diet',
        PGHOST: '127.0.0.1',
        PGPORT: '5433',
      }),
    )
    expect(env.DATABASE_URL).toBe('postgres://a%40b:p%3Aw@127.0.0.1:5433/diet?sslmode=disable')
  })

  it('已設定 DATABASE_URL 時原樣沿用', () => {
    const env = storageEnvFrom(from({ DATABASE_URL: 'postgres://x', PGPORT: '1' }))
    expect(env).toEqual({ DATABASE_URL: 'postgres://x' })
  })
})

describe('啟動腳本的前端套件檢查', () => {
  const fs = (files) => ({
    existsSync: (p) => p in files,
    statSync: (p) => ({ mtimeMs: files[p] }),
  })

  it('沒有 package-lock.json 時回報缺檔而不丟例外', () => {
    expect(lockfileState('lock', 'installed', fs({ installed: 1 }))).toBe('missing-lock')
  })

  it('依修改時間判斷是否需要重新安裝', () => {
    expect(lockfileState('lock', 'installed', fs({ lock: 1, installed: 2 }))).toBe('up-to-date')
    expect(lockfileState('lock', 'installed', fs({ lock: 2, installed: 1 }))).toBe('stale')
    expect(lockfileState('lock', 'installed', fs({ lock: 1 }))).toBe('stale')
  })
})
