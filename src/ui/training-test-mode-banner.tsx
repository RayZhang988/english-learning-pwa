export function TrainingTestModeBanner({
  wallSeconds,
}: {
  readonly wallSeconds: number
}) {
  return (
    <aside className="training-test-mode-banner" role="status">
      测试模式：每项 {wallSeconds} 秒。测试数据与正式学习数据隔离。
    </aside>
  )
}
