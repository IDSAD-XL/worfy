// Finds the time limits of tests written as bare numbers, which the run's multiplier
// (test/time-scale.ts) never reaches. test/contract/test-timeout-scale.test.ts runs it over test/**
// and the three configurations of the test run.
//
// What counts as a limit:
// - the last argument of it, test, describe, suite and the hooks (beforeAll…), with their modifiers
//   (`it.skipIf(…)(…)`, `test.each(…)(…)`);
// - a `timeout`, `testTimeout` or `hookTimeout` property, except inside the argument of a matcher that
//   compares values (`toEqual({ timeout: 10_000 })` checks an option the product passes on);
// - the argument of `test.setTimeout` and `testInfo.setTimeout` (Playwright);
// - the second argument of `waitFor`, `waitUntil` and `poll` when it is a number;
// - a constant whose name has TIMEOUT in it.
// A bare number is a numeric literal or arithmetic of numeric literals only (`15 * 60_000`); a
// conditional or `??` counts by its branches. An expression with a name in it (`RUN_TIMEOUT`,
// `ROUNDS * 6_000`) is not looked into: a named constant is checked where it is defined. Zero is not
// a limit. A line marked `// unscaled: <reason>` (on the line or the line before) is left out: a
// bound the test expects to run out, or a time budget of the product.

import { createRequire } from 'node:module'
import type * as TypeScript from 'typescript'

// typescript is CommonJS; a default import of it does not type-check under the test tsconfig.
const ts = createRequire(import.meta.url)('typescript') as typeof TypeScript

export type Unscaled = { line: number; text: string }

const DECLARATIONS = new Set(['it', 'test', 'describe', 'suite', 'beforeAll', 'beforeEach', 'afterAll', 'afterEach'])
const LIMIT_PROPERTIES = new Set(['timeout', 'testTimeout', 'hookTimeout'])
const WAITS = new Set(['waitFor', 'waitUntil', 'poll'])
const VALUE_MATCHERS = /^(toEqual|toStrictEqual|toMatchObject|toHaveBeenCalledWith|toHaveBeenLastCalledWith|toHaveBeenNthCalledWith|toContainEqual)$/
const ARITHMETIC = new Set([ts.SyntaxKind.AsteriskToken, ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.SlashToken])
const MARK = /\/\/\s*unscaled:\s*\S/

function onlyNumbers(e: TypeScript.Expression): boolean {
  if (ts.isParenthesizedExpression(e)) return onlyNumbers(e.expression)
  if (ts.isNumericLiteral(e)) return true
  return ts.isBinaryExpression(e) && ARITHMETIC.has(e.operatorToken.kind) && onlyNumbers(e.left) && onlyNumbers(e.right)
}

/** Whether `e` is, or may evaluate to, a bare non-zero number. */
function bare(e: TypeScript.Expression): boolean {
  if (ts.isParenthesizedExpression(e)) return bare(e.expression)
  if (ts.isNumericLiteral(e)) return Number(e.text) !== 0
  if (onlyNumbers(e)) return true
  if (ts.isConditionalExpression(e)) return bare(e.whenTrue) || bare(e.whenFalse)
  if (ts.isBinaryExpression(e) && (e.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || e.operatorToken.kind === ts.SyntaxKind.BarBarToken)) return bare(e.right)
  return false
}

/** The identifier a call chain starts from: `it` for `it.skipIf(x)(…)`, `vi` for `vi.waitFor(…)`. */
function rootName(e: TypeScript.Expression): string | undefined {
  let at = e
  while (ts.isCallExpression(at) || ts.isPropertyAccessExpression(at)) at = at.expression
  return ts.isIdentifier(at) ? at.text : undefined
}

/** The name a call ends with: `waitFor` for `vi.waitFor(…)` and `waitFor(…)`. */
function lastName(e: TypeScript.Expression): string | undefined {
  if (ts.isIdentifier(e)) return e.text
  if (ts.isPropertyAccessExpression(e)) return e.name.text
  return undefined
}

function inValueMatcher(node: TypeScript.Node): boolean {
  let at = node.parent
  while (at && (ts.isObjectLiteralExpression(at) || ts.isArrayLiteralExpression(at) || ts.isPropertyAssignment(at))) at = at.parent
  return !!at && ts.isCallExpression(at) && ts.isPropertyAccessExpression(at.expression) && VALUE_MATCHERS.test(at.expression.name.text)
}

/** The limits in `source` (a TypeScript or TSX file named `fileName`) written as bare numbers. */
export function unscaledLimits(source: string, fileName: string): Unscaled[] {
  const kind = fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind)
  const lines = source.split('\n')
  const found: Unscaled[] = []
  const check = (e: TypeScript.Expression): void => {
    if (!bare(e)) return
    const line = file.getLineAndCharacterOfPosition(e.getStart()).line
    if (MARK.test(lines[line] ?? '') || MARK.test(lines[line - 1] ?? '')) return
    found.push({ line: line + 1, text: (lines[line] ?? '').trim() })
  }
  const visit = (node: TypeScript.Node): void => {
    if (ts.isCallExpression(node)) {
      const root = rootName(node.expression)
      const last = node.arguments.at(-1)
      if (root && DECLARATIONS.has(root) && node.arguments.length >= 2 && last && !ts.isFunctionLike(last)) check(last)
      const name = lastName(node.expression)
      if (name === 'setTimeout' && ts.isPropertyAccessExpression(node.expression) && root && /^(test|testInfo|info)$/.test(root) && node.arguments[0]) check(node.arguments[0])
      if (name && WAITS.has(name) && node.arguments[1] && ts.isNumericLiteral(node.arguments[1])) check(node.arguments[1])
    }
    if (ts.isPropertyAssignment(node) && LIMIT_PROPERTIES.has(node.name.getText()) && !inValueMatcher(node)) check(node.initializer)
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && /TIMEOUT/i.test(node.name.text) && node.initializer) check(node.initializer)
    ts.forEachChild(node, visit)
  }
  visit(file)
  return found
}
