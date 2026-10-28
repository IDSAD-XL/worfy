// Triage only (the draft PR of triage/windows-e2e, never merged): does a deny ACE set the way the e2e tests set it
// stop the runner's user? linked-add-project.spec.ts denies (RD) on a folder and expects readdir to fail;
// linked-machines.spec.ts denies (WD,AD) and expects a new file in the folder to fail. Each case prints the
// principal, the folder's ACL after the deny, and what Node got. Nothing outside a new temporary folder changes.
const fs = require('node:fs')
const os = require('node:os')
const { execFileSync } = require('node:child_process')
const { join } = require('node:path')

const asTests = `${process.env.USERDOMAIN ?? ''}\\${process.env.USERNAME ?? ''}`
// The Windows whoami by its full path: Git Bash's coreutils whoami may come first on PATH and takes no /priv.
const WHOAMI = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'whoami.exe')
const whoami = execFileSync(WHOAMI, { encoding: 'utf8' }).trim()
console.log(`whoami: ${whoami}; USERDOMAIN: ${process.env.USERDOMAIN}; USERNAME: ${process.env.USERNAME}; COMPUTERNAME: ${process.env.COMPUTERNAME}`)
// The runtime that runs this file (node, or Electron with ELECTRON_RUN_AS_NODE), and the privileges of its
// token: a child gets a copy of the parent's token, so whoami /priv shows which ones are enabled here.
console.log(`runtime: ${process.execPath} electron=${process.versions.electron ?? 'no'}`)
console.log(execFileSync(WHOAMI, ['/priv'], { encoding: 'utf8' }).trim())
const base = fs.realpathSync.native(fs.mkdtempSync(join(os.tmpdir(), 'deny-probe-')))

function probe(label, principal, rights, attempt) {
  const folder = join(base, label)
  fs.mkdirSync(folder)
  fs.writeFileSync(join(folder, 'inside.txt'), 'x')
  try {
    execFileSync('icacls', [folder, '/deny', `${principal}:${rights}`], { stdio: 'pipe' })
  } catch (error) {
    console.log(`${label}: icacls /deny failed: ${String(error.stderr ?? error.message).trim()}`)
    return
  }
  console.log(`${label}: ACL after the deny:\n${execFileSync('icacls', [folder], { encoding: 'utf8' }).trim()}`)
  try {
    console.log(`${label}: allowed: ${attempt(folder)}`)
  } catch (error) {
    console.log(`${label}: refused: ${error.code}`)
  } finally {
    execFileSync('icacls', [folder, '/remove:d', principal], { stdio: 'ignore' })
  }
}

const read = (folder) => JSON.stringify(fs.readdirSync(folder))
const write = (folder) => {
  fs.writeFileSync(join(folder, 'new.txt'), 'y')
  return 'wrote new.txt'
}
probe('read-user', asTests, '(RD)', read)
probe('write-user', asTests, '(WD,AD)', write)
probe('read-whoami', whoami, '(RD)', read)
probe('read-admins', '*S-1-5-32-544', '(RD)', read)
fs.rmSync(base, { recursive: true, force: true })
