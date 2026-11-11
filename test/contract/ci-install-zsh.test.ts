// scripts/ci-install-zsh.sh, the step "Install zsh" of the job linux-tests in .github/workflows/ci.yml
// (worfy-polish 107). Run 43032607379 failed in all four shards when apt could reach none of the
// runner's mirrors; the script takes zsh from the cache, then apt, then Homebrew, and stays red when
// none of them gives it. Here sudo, timeout, apt-get, dpkg and brew are stubs on a PATH that has
// nothing else but the few tools the script and the stubs call, so no real package is touched.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { removeTestTree } from '../remove'
import { shellStub } from '../shell-stub'

const REPO = join(import.meta.dirname, '..', '..')
const SCRIPT = join(REPO, 'scripts', 'ci-install-zsh.sh')
const CI = join(REPO, '.github', 'workflows', 'ci.yml')
// The real tools the script and the stubs need; everything else is left off PATH, zsh above all.
const TOOLS = ['cat', 'chmod', 'ln', 'mkdir', 'mktemp', 'mv', 'readlink', 'rm']

/** The lines of the linux-tests job of ci.yml, up to the next job. */
function linuxTests(): string[] {
  const lines = readFileSync(CI, 'utf8').split('\n')
  const start = lines.indexOf('  linux-tests:')
  const end = lines.findIndex((line, i) => i > start && /^ {2}[a-z][\w-]*:$/.test(line))
  return lines.slice(start, end === -1 ? undefined : end)
}

// The script runs only on the Linux runner; the stubs are /bin/sh scripts.
describe.skipIf(process.platform === 'win32')('scripts/ci-install-zsh.sh: zsh for the Harness shell tests on the Linux runner', () => {
  let root: string
  let bin: string
  let debs: string
  let calls: string
  let output: string
  let bash: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ci-install-zsh-'))
    bin = join(root, 'bin')
    debs = join(root, 'debs')
    calls = join(root, 'calls.log')
    output = join(root, 'github-output')
    mkdirSync(bin)
    mkdirSync(join(root, 'tmp'))
    mkdirSync(join(root, 'no-brew'))
    writeFileSync(calls, '')
    writeFileSync(output, '')
    bash = execFileSync('/bin/sh', ['-c', 'command -v bash'], { encoding: 'utf8' }).trim()
    for (const tool of TOOLS) {
      symlinkSync(execFileSync('/bin/sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).trim(), join(bin, tool))
    }
    // The zsh that an install puts in place: a link to it in bin is zsh on PATH.
    shellStub(join(root, 'zsh'), ['echo "zsh 5.9 (stub)"'])
    const install = `ln -sf "${join(root, 'zsh')}" "${join(bin, 'zsh')}"`
    shellStub(join(bin, 'sudo'), ['echo "sudo $*" >>"$CALLS"', 'exec "$@"'])
    shellStub(join(bin, 'timeout'), ['shift', 'exec "$@"'])
    shellStub(join(bin, 'apt-get'), [
      'echo "apt-get $*" >>"$CALLS"',
      'case " $* " in',
      // timeout exits 124 when it stops the command it runs; APT=slow stands for an update stopped so.
      '  *" update "*) [ "$APT" = slow ] && exit 124; exit 0 ;;',
      '  *" download "*) [ "$APT" = ok ] || { echo "E: Failed to fetch zsh_5.9.deb" >&2; exit 100; }',
      '    : >zsh_5.9-8ubuntu3_amd64.deb; : >zsh-common_5.9-8ubuntu3_all.deb; exit 0 ;;',
      `  *" install "*) [ "$APT" = ok ] || exit 100; ${install}; exit 0 ;;`,
      'esac',
      'exit 64',
    ])
    shellStub(join(bin, 'dpkg'), ['echo "dpkg $*" >>"$CALLS"', `[ "$DPKG" = ok ] || exit 1`, install])
    shellStub(join(root, 'brew'), [
      'echo "brew $*" >>"$CALLS"',
      `[ "$1" = --prefix ] && { echo "${join(root, 'cellar')}"; exit 0; }`,
      '[ "$BREW" = ok ] || exit 1',
      `mkdir -p "${join(root, 'cellar', 'bin')}"`,
      `ln -sf "${join(root, 'zsh')}" "${join(root, 'cellar', 'bin', 'zsh')}"`,
    ])
  })

  afterEach(() => {
    removeTestTree(root)
  })

  function run(env: { APT?: string; DPKG?: string; BREW?: string; brew?: 'path' | 'dir' | 'none' } = {}) {
    if (env.brew === 'path') symlinkSync(join(root, 'brew'), join(bin, 'brew'))
    const result = spawnSync(bash, [SCRIPT, debs], {
      encoding: 'utf8',
      env: {
        PATH: bin,
        TMPDIR: join(root, 'tmp'),
        CALLS: calls,
        GITHUB_OUTPUT: output,
        ZSH_LINK: join(bin, 'zsh'),
        BREW_DIR: env.brew === 'dir' ? root : join(root, 'no-brew'),
        APT: env.APT ?? 'ok',
        DPKG: env.DPKG ?? 'ok',
        BREW: env.BREW ?? 'ok',
      },
    })
    return { status: result.status, out: result.stdout, err: result.stderr, calls: readFileSync(calls, 'utf8'), output: readFileSync(output, 'utf8') }
  }

  function cache(): void {
    mkdirSync(debs)
    writeFileSync(join(debs, 'zsh_5.9-8ubuntu2_amd64.deb'), '')
    writeFileSync(join(debs, 'zsh-common_5.9-8ubuntu2_all.deb'), '')
  }

  it('does nothing when zsh is on PATH already', () => {
    symlinkSync(join(root, 'zsh'), join(bin, 'zsh'))
    const result = run()
    expect(result.status, result.err).toBe(0)
    expect(result.out).toContain('zsh is on PATH already')
    expect(result.calls).toBe('')
  })

  it('installs the cached packages with dpkg and never calls apt: a cache hit needs no network', () => {
    cache()
    const result = run()
    expect(result.status, result.err).toBe(0)
    expect(result.calls).toBe(`sudo dpkg -i ${join(debs, 'zsh-common_5.9-8ubuntu2_all.deb')} ${join(debs, 'zsh_5.9-8ubuntu2_amd64.deb')}\ndpkg -i ${join(debs, 'zsh-common_5.9-8ubuntu2_all.deb')} ${join(debs, 'zsh_5.9-8ubuntu2_amd64.deb')}\n`)
    expect(result.out).not.toContain('::warning')
    // The folder came from the cache: nothing to save.
    expect(result.output).toBe('')
  })

  it('downloads the packages with apt on a cold cache, retrying each fetch, and asks the next step to save them', () => {
    const result = run()
    expect(result.status, result.err).toBe(0)
    const apt = result.calls.split('\n').filter((line) => line.startsWith('apt-get '))
    expect(apt).toEqual([
      'apt-get -o Acquire::Retries=3 -qq update',
      'apt-get -o Acquire::Retries=3 -qq download zsh zsh-common',
      `apt-get -o Acquire::Retries=3 -y -qq install ${join(debs, 'zsh-common_5.9-8ubuntu3_all.deb')} ${join(debs, 'zsh_5.9-8ubuntu3_amd64.deb')}`,
    ])
    expect(readdirSync(debs).sort()).toEqual(['zsh-common_5.9-8ubuntu3_all.deb', 'zsh_5.9-8ubuntu3_amd64.deb'])
    expect(result.output).toBe('debs=true\n')
    expect(result.out).not.toContain('::warning')
  })

  it('falls back to apt when the cached packages do not install, and replaces them with the new ones', () => {
    cache()
    const result = run({ DPKG: 'fail' })
    expect(result.status, result.err).toBe(0)
    expect(result.out).toContain('::warning title=Install zsh::the cached packages')
    expect(readdirSync(debs).sort()).toEqual(['zsh-common_5.9-8ubuntu3_all.deb', 'zsh_5.9-8ubuntu3_amd64.deb'])
    expect(result.output).toBe('debs=true\n')
  })

  it.for(['path', 'dir'] as const)('takes zsh from Homebrew (brew found by %s) when apt reaches no mirror, with a warning in the run', (where) => {
    const result = run({ APT: 'fail', brew: where })
    expect(result.status, result.err).toBe(0)
    expect(result.err).toContain('E: Failed to fetch')
    expect(result.out).toContain("::warning title=Install zsh::apt-get download failed (exit 100, apt's errors above); trying Homebrew")
    expect(result.out).toContain(`::warning title=Install zsh::zsh came from Homebrew (${join(bin, 'zsh')}), not from apt`)
    expect(result.calls).toContain('brew install zsh')
    expect(existsSync(join(bin, 'zsh'))).toBe(true)
    // A failed download leaves nothing in the folder the cache would save, and no save is asked for.
    expect(readdirSync(debs)).toEqual([])
    expect(result.output).toBe('')
  })

  it('says so when apt-get update ran past its time limit, and goes on to Homebrew', () => {
    const result = run({ APT: 'slow', brew: 'path' })
    expect(result.status, result.err).toBe(0)
    expect(result.out).toContain('::warning title=Install zsh::apt-get update ran past 180 s and was stopped; trying Homebrew')
    expect(result.calls).not.toContain('download')
    expect(result.calls).toContain('brew install zsh')
  })

  it('exits 1 when apt fails and the image has no Homebrew: a real failure stays red', () => {
    const result = run({ APT: 'fail', brew: 'none' })
    expect(result.status).toBe(1)
    expect(result.err).toContain('no zsh: apt failed and this image has no Homebrew')
    expect(result.calls).not.toContain('brew ')
  })

  it('exits 1 when neither apt nor Homebrew installs zsh', () => {
    const result = run({ APT: 'fail', BREW: 'fail', brew: 'path' })
    expect(result.status).toBe(1)
    expect(result.err).toContain('no zsh: neither apt nor Homebrew installed it')
    expect(existsSync(join(bin, 'zsh'))).toBe(false)
  })

  it('refuses to run without the packages folder', () => {
    const result = spawnSync(bash, [SCRIPT], { encoding: 'utf8', env: { PATH: bin } })
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('usage: scripts/ci-install-zsh.sh <packages folder>')
  })
})

describe('ci.yml: linux-tests installs zsh through scripts/ci-install-zsh.sh, with the packages in actions/cache', () => {
  it('restores the packages, runs the script on them, and saves them only when apt downloaded them', () => {
    const job = linuxTests().join('\n')
    const steps = [
      '      - name: Read the Ubuntu release',
      '        id: ubuntu',
      '        run: . /etc/os-release && echo "release=$VERSION_ID" >>"$GITHUB_OUTPUT"',
      '      - name: Restore the zsh packages',
      '        id: zsh-cache',
      '        uses: actions/cache/restore@v6',
      '        with:',
      '          path: ${{ runner.temp }}/zsh-debs',
      '          key: zsh-debs-${{ runner.os }}-${{ runner.arch }}-ubuntu-${{ steps.ubuntu.outputs.release }}',
      '      - name: Install zsh',
      '        id: zsh',
      '        env:',
      '          DEBS: ${{ runner.temp }}/zsh-debs',
      '        run: bash scripts/ci-install-zsh.sh "$DEBS"',
      '      - name: Save the zsh packages',
      "        if: steps.zsh-cache.outputs.cache-hit != 'true' && steps.zsh.outputs.debs == 'true'",
      '        uses: actions/cache/save@v6',
      '        with:',
      '          path: ${{ runner.temp }}/zsh-debs',
      '          key: ${{ steps.zsh-cache.outputs.cache-primary-key }}',
    ]
    const at = job.indexOf(steps[0] ?? '')
    expect(at).toBeGreaterThan(-1)
    // Comments may stand between the steps; the step lines themselves come in this order, as written.
    const found = job
      .slice(at)
      .split('\n')
      .filter((line) => !/^\s*#/.test(line))
      .slice(0, steps.length)
    expect(found).toEqual(steps)
    // The old one-line install, which went red with the first mirror out of reach, is gone.
    expect(job).not.toContain('apt-get install -y -qq zsh')
  })
})
