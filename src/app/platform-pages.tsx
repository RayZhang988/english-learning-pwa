import { Outlet } from 'react-router'

export function PlatformShell() {
  return (
    <main className="platform-shell">
      <Outlet />
    </main>
  )
}

export function PlatformReadyPage() {
  return (
    <section className="platform-message">
      <h1>英语学习</h1>
      <p>技术底座已运行，尚未接入训练模块。</p>
    </section>
  )
}

export function NotFoundPage() {
  return (
    <section className="platform-message">
      <h1>页面不存在</h1>
    </section>
  )
}
