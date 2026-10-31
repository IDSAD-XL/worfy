// A stand-in for node_modules/electron/install.js (README.md): the test puts an install.js into the
// clone that imports this file, and the build runs it with node in the clone. It notes
// `electron-install` in FAKE_UPDATE_TRACE, then puts the Electron there as a finished download
// leaves it — unless FAKE_ELECTRON_INSTALL says `nothing` (it ends with 0 and puts nothing) or `fail`
// (it exits 1). No network.
import process from 'node:process'
import { putElectron } from './electron.mjs'
import { report } from './report.mjs'

report('electron-install')
const mode = process.env.FAKE_ELECTRON_INSTALL ?? 'download'
if (mode === 'fail') {
  process.stderr.write('fake electron install failed: the download was cut off\n')
  process.exitCode = 1
} else if (mode !== 'nothing') {
  putElectron()
  process.stdout.write('fake electron downloaded\n')
}
