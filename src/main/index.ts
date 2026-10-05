import { app, BrowserWindow, ipcMain } from 'electron'
import { registerIpc } from './ipc/index'
import { dataRoot } from './storage/paths'
import { createMainWindow } from './window'

// Electron's own files (caches, local storage) go under worfy's data root too, so a test run
// with a temporary WORFY_DATA_DIR leaves nothing in the real Application Support folder.
app.setPath('userData', dataRoot())

void app.whenReady().then(async () => {
  // Handlers go in before the first window, so its first call never finds a channel missing.
  await registerIpc(ipcMain)
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
