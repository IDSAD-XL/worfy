// A file dropped where nothing takes it is never opened by the window (worfy-ui ticket 28): without
// this, Chromium shows the dropped file in place of the app. What takes files — the chat of the
// Session view (session/chat-drop.tsx), a Session Node on the Canvas — handles the drag itself and
// says so with preventDefault; anywhere else the cursor says no and the drop does nothing.

const carriesFiles = (event: DragEvent): boolean => event.dataTransfer?.types.includes('Files') === true

/** Installs the guard on `target` (the window); the answer removes it. */
export function guardFileDrops(target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window): () => void {
  const over = (event: DragEvent) => {
    if (!carriesFiles(event) || event.defaultPrevented) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'none'
  }
  const drop = (event: DragEvent) => {
    if (carriesFiles(event)) event.preventDefault()
  }
  target.addEventListener('dragover', over)
  target.addEventListener('drop', drop)
  return () => {
    target.removeEventListener('dragover', over)
    target.removeEventListener('drop', drop)
  }
}
