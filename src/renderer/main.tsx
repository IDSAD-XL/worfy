import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

export function App() {
  return <main>worfy</main>
}

const container = document.getElementById('root')
if (container) {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
