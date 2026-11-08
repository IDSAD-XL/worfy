#!/usr/bin/env node
// Downloads the Electron binary in CI, with retries (worfy-polish 74):
//
//   node scripts/download-electron.mjs
//
// Every job of ci.yml and windows-tests.yml that starts Electron calls it right after the cache of
// the Electron download is restored (see "The Electron binary" at the top of ci.yml). It runs
// `node node_modules/electron/install.js`, the script that require('electron') runs when the binary
// is missing, up to 3 times, waiting 20 s and then 60 s between attempts. Each attempt prints one line,
// and the exit code is the one of the last attempt.
//
// Why retry: GitHub releases fails single requests. In run 42472260347 linux-tests 2/4 got
// "Response code 503" for electron-v44.10.2-linux-x64.zip while shards 1/4 and 3/4 downloaded the
// same file in the same minute, and @electron/get does not retry. A failed attempt leaves nothing
// behind: @electron/get checks the zip against checksums.json before it puts it in the cache folder,
// and install.js writes path.txt only after the zip is unpacked. A warm cache makes the first attempt
// succeed without the network.
//
// For tests only: DOWNLOAD_ELECTRON_INSTALL names the install script to run instead, and
// DOWNLOAD_ELECTRON_WAITS_MS the waits between attempts in milliseconds, separated by commas
// (`0,0`). The number of attempts is the number of waits plus one. A malformed value of either is
// exit code 2.

import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import process from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'

const WAITS_MS = [20_000, 60_000]

/** The waits between attempts: the default, or the list of DOWNLOAD_ELECTRON_WAITS_MS; null when malformed. */
function waitsFrom(text) {
  if (text === undefined || text === '') return WAITS_MS
  const parts = text.split(',').map((part) => part.trim())
  if (!parts.every((part) => /^\d+$/.test(part))) return null
  return parts.map(Number)
}

async function main() {
  const waits = waitsFrom(process.env.DOWNLOAD_ELECTRON_WAITS_MS)
  if (waits === null) {
    process.stderr.write(`download-electron: DOWNLOAD_ELECTRON_WAITS_MS must be milliseconds separated by commas, got "${process.env.DOWNLOAD_ELECTRON_WAITS_MS}"\n`)
    return 2
  }
  const install = process.env.DOWNLOAD_ELECTRON_INSTALL || join('node_modules', 'electron', 'install.js')
  const attempts = waits.length + 1
  let code = 1
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = spawnSync(process.execPath, [install], { stdio: 'inherit' })
    code = result.error !== undefined ? 1 : (result.status ?? 1)
    if (code === 0) {
      process.stdout.write(`download-electron: attempt ${attempt} of ${attempts} succeeded\n`)
      return 0
    }
    const why = result.error !== undefined ? result.error.message : result.signal !== null ? `signal ${result.signal}` : `exit code ${code}`
    if (attempt === attempts) {
      process.stdout.write(`download-electron: attempt ${attempt} of ${attempts} failed (${why}); no attempt left\n`)
      break
    }
    const wait = waits[attempt - 1] ?? 0
    process.stdout.write(`download-electron: attempt ${attempt} of ${attempts} failed (${why}); next attempt in ${wait / 1000} s\n`)
    await sleep(wait)
  }
  return code
}

process.exitCode = await main()
