// 冷啟動模組的外框：未登入時顯示登入表單，登入後留在原網址並顯示原頁面（Outlet）。
// 開發工具頁不經過這裡，不需要登入。
import { LogIn } from 'lucide-react'
import { useState } from 'react'
import { Outlet } from 'react-router'

import { ApiError } from '@/api/client'
import { EmptyState } from '@/components/layout/Workspace'
import { Button, Card } from '@/components/ui/primitives'
import { useLogin, useMe } from '@/hooks/useAuth'
import { errorText } from '@/lib/text'

import { ColdstartError, Field, TextInput } from './common'

export function LoginGate() {
  const me = useMe()
  if (me.isPending) return <EmptyState>載入中…</EmptyState>
  if (me.isError) {
    return (
      <div className="p-6">
        <ColdstartError error={me.error} />
      </div>
    )
  }
  if (!me.data) return <LoginForm />
  return <Outlet />
}

export function LoginForm() {
  const login = useLogin()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const err = login.error
  const credentialError = err instanceof ApiError && err.code === 'INVALID_CREDENTIALS'
  return (
    <div className="flex h-full items-start justify-center overflow-y-auto pr-3 pb-3 pt-16">
      <Card className="w-full max-w-sm p-6">
        <h1 className="text-[22px] leading-tight font-semibold tracking-tight">登入</h1>
        <p className="text-muted mt-1 text-sm">
          冷啟動上傳需要登入。帳號由管理者以 wbuser 指令建立。
        </p>
        <form
          className="mt-5 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            login.mutate({ username: username.trim(), password })
          }}
        >
          <Field label="帳號">
            <TextInput
              name="username"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </Field>
          <Field label="密碼">
            <TextInput
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
          {err &&
            (credentialError ? (
              <p role="alert" className="text-danger text-sm">
                {errorText('INVALID_CREDENTIALS')}
              </p>
            ) : (
              <ColdstartError error={err} />
            ))}
          <Button type="submit" variant="primary" disabled={login.isPending || !username}>
            <LogIn className="size-4" aria-hidden />
            {login.isPending ? '登入中…' : '登入'}
          </Button>
        </form>
      </Card>
    </div>
  )
}
