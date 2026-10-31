// The place of the worfy Guide in the shell (worfy-guide ticket 03, ADR-0090): mounted once by
// AppShell.tsx, it follows Help ▸ worfy Guide and draws nothing while the Guide is closed. The
// window itself — GuideWindow.tsx with the texts and diagrams it imports — is a chunk of its own,
// loaded by React.lazy the first time the Guide opens, so the start of the app neither loads nor
// runs it (test/e2e/guide.spec.ts checks the chunk is not fetched before that).
import { lazy, Suspense, useEffect } from 'react'
import { followGuideCommands, useGuide } from './store'

const GuideWindow = lazy(() => import('./GuideWindow'))

export function GuideHost() {
  const open = useGuide((state) => state.open)
  useEffect(followGuideCommands, [])
  if (!open) return null
  return (
    <Suspense fallback={null}>
      <GuideWindow />
    </Suspense>
  )
}
