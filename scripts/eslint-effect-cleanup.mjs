// An ESLint rule: an effect returns a cleanup function or nothing (worfy-polish ticket 165).
//
// React 19 keeps whatever the callback of useEffect, useLayoutEffect or useInsertionEffect returns and, when it is not
// undefined, calls it before the effect runs again and when the component goes away. A returned Promise, object or
// number throws there («destroy_ is not a function» in the production build), and the part fails to render.
// TypeScript does not catch it: the DOM types say `scrollIntoView` returns void, yet Chromium may answer with a
// Promise, and a function that returns a value is assignable to `() => void` anyway.
//
// The rule has no type information, so it judges the shape of the code:
//   - the body of an arrow without braces must be a cleanup: a function, a name (a cleanup kept in a variable),
//     `undefined`, a `void` expression, or a conditional whose both branches are one of these. A call there is an
//     error: write it in braces, and `return` its result only when that result is the cleanup
//     (`useEffect(() => { return follow() }, [])`) — the reader then sees the choice;
//   - an async callback is an error: it always returns a Promise;
//   - in braces, `return` of a literal, a template, an object, an array, an arithmetic or comparison, or an `await`
//     is an error.

const HOOKS = new Set(['useEffect', 'useLayoutEffect', 'useInsertionEffect'])

const hookName = (callee) => {
  if (callee.type === 'Identifier') return callee.name
  if (callee.type === 'MemberExpression' && !callee.computed && callee.property.type === 'Identifier') return callee.property.name
  return undefined
}

const isFunction = (node) => node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression'

const isCleanup = (node) => {
  if (isFunction(node) || node.type === 'Identifier') return true
  if (node.type === 'UnaryExpression' && node.operator === 'void') return true
  if (node.type === 'ConditionalExpression') return isCleanup(node.consequent) && isCleanup(node.alternate)
  return false
}

const VALUES = new Set(['Literal', 'TemplateLiteral', 'ObjectExpression', 'ArrayExpression', 'BinaryExpression', 'AwaitExpression'])

// The return statements of one function body, not of the functions nested in it.
const returnsOf = (body) => {
  const found = []
  const walk = (node) => {
    if (!node || typeof node.type !== 'string') return
    if (node.type === 'ReturnStatement') found.push(node)
    if (isFunction(node) || node.type === 'FunctionDeclaration' || node.type === 'ClassBody') return
    for (const [key, value] of Object.entries(node)) {
      if (key === 'parent') continue
      if (Array.isArray(value)) value.forEach(walk)
      else if (value && typeof value === 'object') walk(value)
    }
  }
  body.body.forEach(walk)
  return found
}

export const effectCleanup = {
  meta: {
    type: 'problem',
    docs: { description: 'An effect callback returns a cleanup function or nothing: React 19 calls whatever it returns' },
    schema: [],
    messages: {
      concise:
        '{{hook}} returns what this expression gives, and React calls it as the cleanup: write the call in braces, and `return` it only when it returns the cleanup.',
      async: '{{hook}} with an async callback returns a Promise, and React calls it as the cleanup: start the async work inside the effect.',
      value: '{{hook}} returns a value that is not a function, and React calls it as the cleanup.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const hook = hookName(node.callee)
        const callback = node.arguments[0]
        if (!HOOKS.has(hook) || !callback || !isFunction(callback)) return
        const data = { hook }
        if (callback.async) {
          context.report({ node: callback, messageId: 'async', data })
          return
        }
        if (callback.body.type !== 'BlockStatement') {
          if (!isCleanup(callback.body)) context.report({ node: callback.body, messageId: 'concise', data })
          return
        }
        for (const statement of returnsOf(callback.body)) {
          if (statement.argument && VALUES.has(statement.argument.type)) context.report({ node: statement.argument, messageId: 'value', data })
        }
      },
    }
  },
}
