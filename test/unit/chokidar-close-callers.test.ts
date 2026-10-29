// Every chokidar watch in src/main is closed through closeForGood (src/main/chokidar-close.ts), never
// by its own close() (worfy-windows tickets 75 and 76): chokidar 5.0.0 can open a closed watch again,
// and on Windows such a watch of a removed folder took a whole processor core until worfy quit.
//
// The search asks the TypeScript type checker, not a pattern, so the name of a variable and the way
// it got its value do not matter. Two rules, both on values whose type is chokidar's FSWatcher (or a
// union with it):
// - its `close` is not reached: `<x>.close`, `<x>['close']`, `const { close } = <x>` (and so
//   `<x>.close()` and `<x>.close.call(…)`);
// - it does not leave as a value of another type that has a `close`: where the checker knows the type
//   a place expects (an argument, the right side of an assignment, a variable with a type, a return, a
//   property of an object literal), that type is chokidar's FSWatcher, or it has no `close` member.
//   `map.set(id, watcher)` into a `Map<string, { close }>`, an argument of a `{ close(): … }`
//   parameter or of a `T extends { close(): … }` one, or `return watcher` as `{ close }` would let
//   some other code call its close(). `once(watcher, 'ready')` from node:events takes it as an
//   EventEmitter, which has no close, and is left alone. Code that gets it back with its own type, as
//   from a generic `<T>(value: T) => T`, falls under the first rule.
// Only closeForGood itself may do either: it is the one place a chokidar watch is closed.
// The close() of LinkSafeWatch, of Node's own fs.watch, of a file handle or of any other object is not
// chokidar's and is left alone; a CardsWatch that wraps closeForGood is too.
//
// Not covered: a value cast with `as`, or passed through `any`; there the checker loses the type. Nor an
// argument of a rest parameter `...values: T[]` with `T extends { close(): … }`.
import { join, relative, sep } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { ms } from '../time-scale'

const REPO = join(import.meta.dirname, '..', '..')
const MAIN = join(REPO, 'src', 'main') + sep
const HELPER = 'src/main/chokidar-close.ts'

/** Whether a type is chokidar's FSWatcher itself. */
function isFsWatcher(type: ts.Type): boolean {
  const symbol = type.getSymbol() ?? type.aliasSymbol
  return (
    symbol?.getName() === 'FSWatcher' &&
    (symbol.getDeclarations() ?? []).some((declaration) => /[\\/]chokidar[\\/]/.test(declaration.getSourceFile().fileName))
  )
}

/** Whether a type is chokidar's FSWatcher, or a union that holds it. */
function holdsChokidarWatcher(type: ts.Type): boolean {
  return type.isUnion() ? type.types.some(isFsWatcher) : isFsWatcher(type)
}

/** Whether a place that expects this type lets other code close a chokidar watch: a type other than FSWatcher with a `close`. */
function letsOthersClose(checker: ts.TypeChecker, type: ts.Type): boolean {
  const members = type.isUnion() ? type.types : [type]
  return members.some((member) => !isFsWatcher(member) && checker.getPropertyOfType(checker.getApparentType(member), 'close') !== undefined)
}

/**
 * For an argument, the type its parameter is declared with, before a generic one is inferred: at the call,
 * `T extends { close(): … }` is inferred as FSWatcher, while inside the function its value is a T.
 */
function declaredParameterType(checker: ts.TypeChecker, node: ts.Expression): ts.Type | undefined {
  const call = node.parent
  if (!(ts.isCallExpression(call) || ts.isNewExpression(call)) || !call.arguments) return undefined
  const index = call.arguments.indexOf(node)
  const declaration = index < 0 ? undefined : checker.getResolvedSignature(call)?.getDeclaration()
  if (!declaration || ts.isJSDocSignature(declaration)) return undefined
  const parameter = declaration.parameters[index]
  return parameter && !parameter.dotDotDotToken ? checker.getTypeAtLocation(parameter) : undefined
}

interface Found {
  at: string
  what: string
}

/** Every place in src/main that reaches the close of a chokidar watch, or lets one leave as another type. */
function chokidarEscapes(): Found[] {
  const configPath = join(REPO, 'tsconfig.node.json')
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
    throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
  } })
  if (!parsed) throw new Error(`cannot read ${configPath}`)
  const files = parsed.fileNames.filter((file) => join(file).startsWith(MAIN))
  const program = ts.createProgram({ rootNames: files, options: { ...parsed.options, noEmit: true } })
  const checker = program.getTypeChecker()
  const isChokidar = (node: ts.Node): boolean => holdsChokidarWatcher(checker.getTypeAtLocation(node))
  const found: Found[] = []
  for (const source of program.getSourceFiles()) {
    if (!join(source.fileName).startsWith(MAIN)) continue
    const file = relative(REPO, source.fileName).split(sep).join('/')
    const report = (node: ts.Node, what: string): void => {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart())
      found.push({ at: `${file}:${line + 1}`, what })
    }
    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAccessExpression(node) && node.name.text === 'close' && isChokidar(node.expression)) report(node, 'close')
      if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) && node.argumentExpression.text === 'close' && isChokidar(node.expression)) {
        report(node, 'close')
      }
      if (ts.isObjectBindingPattern(node) && node.elements.some((element) => (element.propertyName ?? element.name).getText(source) === 'close') && isChokidar(node)) {
        report(node, 'close')
      }
      if (ts.isExpression(node) && !ts.isParenthesizedExpression(node.parent) && isChokidar(node)) {
        const expected = checker.getContextualType(node)
        // The argument of closeForGood is the one place a chokidar watch goes to be closed.
        const toHelper = ts.isCallExpression(node.parent) && ts.isIdentifier(node.parent.expression) && node.parent.expression.text === 'closeForGood'
        const declared = toHelper ? undefined : declaredParameterType(checker, node)
        if (expected && !toHelper && letsOthersClose(checker, expected)) report(node, `leaves as ${checker.typeToString(expected)}`)
        else if (declared && letsOthersClose(checker, declared)) report(node, `leaves as ${checker.typeToString(declared)}`)
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return found.sort((a, b) => a.at.localeCompare(b.at))
}

describe('chokidar watches in src/main are closed only through closeForGood', () => {
  it('no code but closeForGood reaches the close of a chokidar FSWatcher or lets one leave as another type', () => {
    const found = chokidarEscapes()
    // The helper's own close() is found: the search sees a chokidar watch where there is one.
    expect(found.filter(({ at }) => at.startsWith(`${HELPER}:`))).toEqual([expect.objectContaining({ what: 'close' })])
    expect(found.filter(({ at }) => !at.startsWith(`${HELPER}:`)).map(({ at, what }) => `${at} ${what}`), 'close these through closeForGood (src/main/chokidar-close.ts)').toEqual([])
    // The type checker reads all of src/main: some seconds alone, more in a full run.
  }, ms(60_000))
})
