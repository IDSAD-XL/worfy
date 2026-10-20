// Every chokidar watch in src/main is closed through closeForGood (src/main/chokidar-close.ts), never
// by its own close() (worfy-windows tickets 75 and 76): chokidar 5.0.0 can open a closed watch again,
// and on Windows such a watch of a removed folder took a whole processor core until worfy quit.
//
// The search asks the TypeScript type checker, not a pattern: a call `<x>.close()` is reported when
// the type of `<x>` is chokidar's FSWatcher (or a union with it), whatever the variable is called and
// however it got there. The close() of LinkSafeWatch, of Node's own fs.watch, of a file handle or of
// any other object is not chokidar's and is left alone; a CardsWatch that wraps closeForGood is too.
import { join, relative, sep } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { timeScale } from '../time-scale'

const REPO = join(import.meta.dirname, '..', '..')
const MAIN = join(REPO, 'src', 'main') + sep
const HELPER = 'src/main/chokidar-close.ts'

/** Whether a type is chokidar's FSWatcher, or a union that holds it. */
function isChokidarWatcher(type: ts.Type): boolean {
  if (type.isUnion()) return type.types.some(isChokidarWatcher)
  const symbol = type.getSymbol() ?? type.aliasSymbol
  return (
    symbol?.getName() === 'FSWatcher' &&
    (symbol.getDeclarations() ?? []).some((declaration) => /[\\/]chokidar[\\/]/.test(declaration.getSourceFile().fileName))
  )
}

/** Every `<x>.close(...)` in src/main whose `<x>` is a chokidar watch, as `file:line`. */
function chokidarCloses(): string[] {
  const configPath = join(REPO, 'tsconfig.node.json')
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
    throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
  } })
  if (!parsed) throw new Error(`cannot read ${configPath}`)
  const files = parsed.fileNames.filter((file) => join(file).startsWith(MAIN))
  const program = ts.createProgram({ rootNames: files, options: { ...parsed.options, noEmit: true } })
  const checker = program.getTypeChecker()
  const found: string[] = []
  for (const source of program.getSourceFiles()) {
    if (!join(source.fileName).startsWith(MAIN)) continue
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'close') {
        if (isChokidarWatcher(checker.getTypeAtLocation(node.expression.expression))) {
          const { line } = source.getLineAndCharacterOfPosition(node.getStart())
          found.push(`${relative(REPO, source.fileName).split(sep).join('/')}:${line + 1}`)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return found.sort()
}

describe('chokidar watches in src/main are closed only through closeForGood', () => {
  it('the only close() of a chokidar FSWatcher in src/main is the one inside closeForGood', () => {
    const closes = chokidarCloses()
    // The helper's own close() is found: the search sees a chokidar watch where there is one.
    expect(closes.filter((at) => at.startsWith(`${HELPER}:`))).toHaveLength(1)
    expect(closes.filter((at) => !at.startsWith(`${HELPER}:`)), 'close these through closeForGood (src/main/chokidar-close.ts)').toEqual([])
    // The type checker reads all of src/main: some seconds alone, more in a full run.
  }, 60_000 * timeScale)
})
