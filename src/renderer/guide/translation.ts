// The check that every text of the worfy Guide exists in both languages (worfy-guide ticket 03,
// ADR-0090): the English and the Russian file of a Topic, and of the Guide's own labels, hold the
// same keys and lists of the same length, and every string is filled. test/unit/guide-content.test.tsx
// runs it over every file, so a string without one of its two versions fails the tests.

type Text = string | readonly Text[] | { readonly [key: string]: Text }

function kindOf(value: unknown): 'a string' | 'a list' | 'a group' | 'not text' {
  if (typeof value === 'string') return 'a string'
  if (Array.isArray(value)) return 'a list'
  if (value !== null && typeof value === 'object') return 'a group'
  return 'not text'
}

/**
 * Every place where `en` and `ru` differ in shape, as `<path>: <problem>`; empty when the two match.
 * The path joins keys and list positions with dots: `underTheHood.files.src/main/menu.ts`.
 */
export function translationGaps(en: unknown, ru: unknown, path = ''): string[] {
  const where = path === '' ? '(root)' : path
  const enKind = kindOf(en)
  const ruKind = kindOf(ru)
  if (enKind !== ruKind) return [`${where}: ${enKind} in en, ${ruKind} in ru`]
  if (enKind === 'a string') {
    const gaps: string[] = []
    if ((en as string).trim() === '') gaps.push(`${where}: empty in en`)
    if ((ru as string).trim() === '') gaps.push(`${where}: empty in ru`)
    return gaps
  }
  if (enKind === 'not text') return [`${where}: not text`]
  const child = (key: string | number) => (path === '' ? String(key) : `${path}.${key}`)
  if (enKind === 'a list') {
    const enList = en as readonly Text[]
    const ruList = ru as readonly Text[]
    const gaps: string[] = []
    for (let index = 0; index < Math.max(enList.length, ruList.length); index++) {
      if (index >= ruList.length) gaps.push(`${child(index)}: missing in ru`)
      else if (index >= enList.length) gaps.push(`${child(index)}: missing in en`)
      else gaps.push(...translationGaps(enList[index], ruList[index], child(index)))
    }
    return gaps
  }
  const enGroup = en as Record<string, unknown>
  const ruGroup = ru as Record<string, unknown>
  const gaps: string[] = []
  for (const key of Object.keys(enGroup)) {
    if (!Object.hasOwn(ruGroup, key)) gaps.push(`${child(key)}: missing in ru`)
    else gaps.push(...translationGaps(enGroup[key], ruGroup[key], child(key)))
  }
  for (const key of Object.keys(ruGroup)) if (!Object.hasOwn(enGroup, key)) gaps.push(`${child(key)}: missing in en`)
  return gaps
}
