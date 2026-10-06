import { builtinModules } from 'node:module'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import js from '@eslint/js'
import { defineConfig } from 'eslint/config'
import reactHooks from 'eslint-plugin-react-hooks'
import { reactRefresh } from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'

const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), 'src')
const nodeBuiltins = new Set(builtinModules)

// Process boundaries (spec.md, "Где что лежит"). Code in these layers runs outside the main
// process, so it may reach Electron and Node only through the preload bridge, and never imports
// the main process (or, for shared, the renderer) directly. Type-only imports count too: one
// `import type ... from 'electron'` pulls Node's types into the web typecheck project and hides
// every later node:* import there.
const forbiddenLayers = {
  renderer: ['main', 'preload'],
  'card-runtime': ['main', 'preload'],
  shared: ['main', 'preload', 'renderer'],
}

const layerOf = (file) => {
  const rel = relative(srcDir, file)
  if (rel.startsWith('..') || isAbsolute(rel)) return undefined
  return rel.split(sep)[0]
}

const processBoundary = {
  meta: {
    type: 'problem',
    docs: { description: 'Keep src/renderer, src/card-runtime and src/shared off Electron, Node and the main process' },
    schema: [],
    messages: {
      electron:
        "src/{{layer}} must not import '{{source}}': only src/main and src/preload run where Electron is available.",
      node: "src/{{layer}} must not import the Node module '{{source}}': only src/main and src/preload run under Node.",
      layer: "src/{{layer}} must not import from src/{{target}} ('{{source}}'): that crosses a process boundary.",
    },
  },
  create(context) {
    const layer = layerOf(context.filename)
    const forbidden = forbiddenLayers[layer]
    if (!forbidden) return {}

    const check = (sourceNode) => {
      if (!sourceNode || sourceNode.type !== 'Literal' || typeof sourceNode.value !== 'string') return
      const source = sourceNode.value
      const data = { layer, source }
      if (source === 'electron' || source.startsWith('electron/')) {
        context.report({ node: sourceNode, messageId: 'electron', data })
      } else if (source.startsWith('node:') || nodeBuiltins.has(source) || nodeBuiltins.has(source.split('/')[0])) {
        context.report({ node: sourceNode, messageId: 'node', data })
      } else if (source.startsWith('.') || isAbsolute(source)) {
        const target = layerOf(resolve(dirname(context.filename), source))
        if (forbidden.includes(target)) context.report({ node: sourceNode, messageId: 'layer', data: { ...data, target } })
      }
    }

    return {
      ImportDeclaration: (node) => check(node.source),
      ExportNamedDeclaration: (node) => check(node.source),
      ExportAllDeclaration: (node) => check(node.source),
      ImportExpression: (node) => check(node.source),
      TSImportType: (node) => check(node.source ?? node.argument?.literal),
      TSExternalModuleReference: (node) => check(node.expression),
      CallExpression: (node) => {
        if (node.callee.type === 'Identifier' && node.callee.name === 'require') check(node.arguments[0])
      },
    }
  },
}

export default defineConfig(
  {
    // .claude/worktrees/ holds other tickets' checkouts: never lint them from here.
    // ZzVitestProbe* is a probe file an older discovery test left in src/ (ADR-0036).
    ignores: ['node_modules/**', 'out/**', 'dist/**', 'test-results/**', 'playwright-report/**', '.claude/worktrees/**', '**/ZzVitestProbe*'],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts', 'test/**/*.ts', '*.config.{js,ts}', 'electron.vite.config.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}', 'test/**/*.tsx'],
    languageOptions: { globals: globals.browser },
    extends: [reactHooks.configs.flat.recommended],
  },
  {
    files: ['src/renderer/**/*.tsx'],
    extends: [reactRefresh.configs.vite()],
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}', 'src/card-runtime/**/*.{ts,tsx}', 'src/shared/**/*.{ts,tsx}'],
    plugins: { worfy: { rules: { 'process-boundary': processBoundary } } },
    rules: { 'worfy/process-boundary': 'error' },
  },
)
