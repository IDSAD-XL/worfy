// The map the delegated acceptance of 2026-11-24 looked at (LONG_MAP of test/e2e/product-session.spec.ts) and the
// geometry helpers of the three tests that came out of it: mind-map-tree-replaces.test.ts (worfy-product-session
// ticket 33), mind-map-node-width.test.ts (ticket 34) and mind-map-graph-centre.test.ts (ticket 35).
import type { ProductTopicState } from '../../src/shared/ipc/product'
import type { MindMapNode } from '../../src/shared/product/mind-map'
import type { Placed } from '../../src/renderer/product/mind-map-layout'

/** The map of the e2e test (test/e2e/product-session.spec.ts, LONG_MAP), with two Tickets, as the acceptance drew it. */
export const LONG_MAP: MindMapNode[] = [
  { id: 'root-idea', kind: 'idea', text: 'Отдельный экран продуктовой работы: карта решений рядом с разговором', from: null, advice: true },
  { id: 'who', kind: 'question', text: 'Who decides when the advisor and the critic disagree about the scope?', from: 'root-idea' },
  {
    id: 'harness-first',
    kind: 'decision',
    text: 'Сначала проверить советника в Harness, интерфейс минимальный',
    from: 'root-idea',
    status: 'rejected',
    reason: 'экран Mind map и есть суть продуктовой сессии',
  },
  { id: 'split', kind: 'decision', text: 'Mind map 60 / чат 40, граф двигается и подсвечивает узлы сообщения', from: 'root-idea', status: 'accepted', reason: 'видно в прототипе', replaces: 'harness-first' },
  { id: 'laptop', kind: 'objection', text: 'Файл в docs/product/ правит tool агента, а не владелец руками', from: 'split', source: 'docs/design/F-SPEC.md' },
  { id: 'scale', kind: 'question', text: 'Как выглядит Mind map при сотне узлов и больше?', from: 'split' },
  { id: 'teams', kind: 'idea', text: 'Команда на большом проекте получает свою карту позже', from: 'laptop' },
  {
    id: 'very-long',
    kind: 'idea',
    text: 'Очень длинный текст узла, который не помещается даже в четыре строки: советник предлагает, критик возражает, владелец решает, а карта показывает каждое решение и то, из чего оно выросло',
    from: 'scale',
  },
]

export const topic = (): ProductTopicState => ({
  name: 'roadmap-demo',
  folder: '/demo/docs/product/roadmap-demo',
  title: 'Roadmap демо — карта',
  sections: [],
  tickets: [
    { number: 1, slug: 'users', file: '01-users.md', title: '01 — Кто пользователь', status: 'open' },
    { number: 2, slug: 'order', file: '02-order.md', title: '02 — Порядок Epic-ов', status: 'open' },
  ],
  nodes: LONG_MAP,
  errors: [],
})

/** A measure close to the UI font's (as mind-map-layout.test.ts has it): Cyrillic wider than Latin, a space narrow. */
export const fontLike = (text: string, size: number, bold: boolean): number =>
  [...text].reduce((width, glyph) => width + (glyph === ' ' ? 0.27 : /[Ѐ-ӿ]/.test(glyph) ? 0.66 : 0.52) * size * (bold ? 1.05 : 1), 0)

export const middle = (box: Placed) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 })

/** The points of an SVG path of M, L, Q and C commands, `steps` per segment, as the browser draws it. */
export function pathPoints(d: string, steps = 40): { x: number; y: number }[] {
  const tokens = d.match(/[MLQC]|-?[\d.]+/g) ?? []
  const points: { x: number; y: number }[] = []
  let at = { x: 0, y: 0 }
  let index = 0
  const next = () => ({ x: Number(tokens[index++]), y: Number(tokens[index++]) })
  while (index < tokens.length) {
    const command = tokens[index++]
    if (command === 'M') {
      at = next()
      points.push(at)
    } else if (command === 'L') {
      const end = next()
      for (let step = 1; step <= steps; step += 1) points.push({ x: at.x + ((end.x - at.x) * step) / steps, y: at.y + ((end.y - at.y) * step) / steps })
      at = end
    } else if (command === 'Q') {
      const [control, end] = [next(), next()]
      for (let step = 1; step <= steps; step += 1) {
        const t = step / steps
        points.push({ x: (1 - t) ** 2 * at.x + 2 * (1 - t) * t * control.x + t * t * end.x, y: (1 - t) ** 2 * at.y + 2 * (1 - t) * t * control.y + t * t * end.y })
      }
      at = end
    } else if (command === 'C') {
      const [one, two, end] = [next(), next(), next()]
      for (let step = 1; step <= steps; step += 1) {
        const t = step / steps
        const [a, b, c, e] = [(1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t * t, t ** 3]
        points.push({ x: a * at.x + b * one.x + c * two.x + e * end.x, y: a * at.y + b * one.y + c * two.y + e * end.y })
      }
      at = end
    } else throw new Error(`unexpected path command ${command} in ${d}`)
  }
  return points
}

export const pathLength = (d: string): number =>
  pathPoints(d).reduce((sum, point, index, all) => (index === 0 ? 0 : sum + Math.hypot(point.x - all[index - 1]!.x, point.y - all[index - 1]!.y)), 0)

/** Whether a point lies more than 1 px inside the box. */
export const inside = (point: { x: number; y: number }, box: Placed): boolean =>
  point.x > box.x + 1 && point.x < box.x + box.width - 1 && point.y > box.y + 1 && point.y < box.y + box.height - 1
