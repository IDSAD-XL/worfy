import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'
import { buildVersion } from './scripts/build-version'

/**
 * Folders of harness/ that stay out of the copy the app carries: the Harness's own tests and its
 * eval cases (evals/, run by `pnpm eval:harness`; their local results/ hold run transcripts).
 */
export const HARNESS_NOT_BUNDLED = [join('bin', 'tests'), join('hooks', 'tests'), 'evals']

/**
 * Copies harness/ into out/harness/ next to out/main/ on every build of main (`pnpm build`,
 * `pnpm test:e2e`, `pnpm package`, `pnpm dev`), without its tests and evals, with the build version
 * (scripts/build-version.ts) as `version` in the copy's .claude-plugin/plugin.json.
 * harness/ itself is never written: `git status` stays clean after a build.
 * electron-builder.yml puts out/harness/ into Contents/Resources/harness/ of the .app;
 * src/main/harness/bundled.ts finds it there or here.
 */
function bundleHarness(): Plugin {
  let root = ''
  let target = ''
  return {
    name: 'worfy:bundle-harness',
    configResolved(config) {
      root = config.root
      target = resolve(config.root, config.build.outDir, '..', 'harness')
    },
    writeBundle() {
      const source = join(root, 'harness')
      // Taken before the copy: out/ is ignored by git, so the copy itself never makes the tree dirty.
      const version = buildVersion(root)
      rmSync(target, { recursive: true, force: true })
      cpSync(source, target, {
        recursive: true,
        filter: (path) => {
          const inside = relative(source, path)
          return !path.endsWith(`${sep}.DS_Store`) && !HARNESS_NOT_BUNDLED.some((dir) => inside === dir || inside.startsWith(`${dir}${sep}`))
        },
      })
      const manifestPath = join(target, '.claude-plugin', 'plugin.json')
      const { name, ...rest } = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
      writeFileSync(manifestPath, `${JSON.stringify({ name, version, ...rest }, null, 2)}\n`)
    },
  }
}

export default defineConfig({
  main: {
    plugins: [bundleHarness()],
  },
  preload: {
    build: {
      rollupOptions: {
        // A sandboxed preload cannot be an ES module: emit CommonJS.
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    plugins: [react()],
  },
})
