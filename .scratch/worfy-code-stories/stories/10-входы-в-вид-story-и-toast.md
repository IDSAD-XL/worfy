# Code story — worfy-code-stories 10: Входы в вид Story: рамка Epic-а, карточка Ticket-а, Pull requests, toast, Command palette

Kind: pr · Epic: worfy-code-stories · Ticket: 10 · PR: - · Language: ru

## 1. Что было не так

Вид Story (Ticket 09) открывался только через крючок e2e test-а `__worfyStory`: ни одной кнопки, ни команды, ни
уведомления. Reader (Ticket 08) уже отдавал файл story (`stories.read`) и код фрагмента из git (`stories.code`), но вид
был типизирован на `Story` и не знал, где story закреплена, поэтому код шёл только из самой story.

- Требование: [Что происходит](../issues/10-входы-в-вид-story-и-toast.md#что-происходит)

## 2. Один путь открытия для всех входов

Code: `src/renderer/stories/open.ts:95-102` · key lines: 97, 99, 100

```ts
export async function openStoryFile(projectId: string, path: string): Promise<string | undefined> {
  const result = await invoke('stories.read', { projectId, path })
  if (!result.ok) return failureReason('stories.read', result.error)
  const read = result.value
  if (!read.ok) return read.reason
  openStory(projectId, read.story, { codeOf: storyCodeSource(projectId, read.path), storyDir: read.dir })
  return undefined
}
```

- Что делает: просит main прочитать файл story, на отказе возвращает причину (кнопка показывает её в tooltip и Canvas
  остаётся), иначе открывает вид с источником кода этого файла и папкой для ссылок Requirement.
- Почему здесь: все шесть входов — кнопки рамки и карточки, пункт «⋯», Pull requests, toast и Command palette — зовут
  одну функцию, и разбор отказа живёт в одном месте.
- Без него: каждый вход читал бы файл по-своему, и story с ошибкой формата открывала бы пустой вид.
- Требование: [Что делаем, п. 1–5](../issues/10-входы-в-вид-story-и-toast.md#что-делаем)
- Риски и пробелы test-ов: отказ `stories.read` проверен unit test-ом на кнопке рамки; на остальных входах — только путь
  без отказа (e2e).

## 3. Код фрагмента — там, где story закреплена

Code: `src/renderer/stories/open.ts:50-57` · key lines: 52

```ts
export function storyCodeSource(projectId: string, path: string): FragmentCodeSource {
  return async (fragment, head, pr) => {
    const at = head !== null ? { commit: head } : { path, pr }
    const result = await invoke('stories.code', { projectId, at, fragment })
    if (!result.ok) throw new Error(failureReason('stories.code', result.error))
    return result.value
  }
}
```

- Что делает: story или глава с PR head читается в этом commit-е; story из git без head — по своему файлу и PR шапки или
  главы (`PR -` — null, main берёт PR из Ticket-а сам).
- Почему здесь: вид не знает про git; источник кода создаётся вместе с открытием файла и знает его путь.
- Без него: вид показывал бы код из текста story, а не из commit-а, где story лежит.
- Требование: не записано
- Риски и пробелы test-ов: unit test проверяет форму `at` для трёх случаев; что main находит код — contract test-ы
  Ticket-а 08, e2e этого Ticket-а код не сверяет.

## 4. Причина «нет commit-а» — свой текст

Code: `src/renderer/stories/StoryView.tsx:148-148` · key lines: 148

```ts
const NO_ANCHOR_NOTE = 'The code as the story quotes it: git has no commit to read it at.'
```

- Что делает: при `reason: 'no-anchor'` над кодом пишется, что git не из чего читать, а не «main branch изменился».
- Почему здесь: прежняя заметка вида подходила только к `changed`.
- Без него: человек решил бы, что код на main ушёл вперёд, хотя commit-а просто нет.
- Требование: не записано
- Риски и пробелы test-ов: правка StoryView — строки типа экрана, `screensOf`, `FragmentBlock`, две константы заметок и
  тип `story` в props; test `story-view.test.tsx` дополнен случаем `no-anchor`.

## 5. Toast — один раз на Epic, без потока при первом чтении

Code: `src/renderer/stories/story-toast.ts:62-74` · key lines: 64, 66, 71

```ts
export function acceptStoryEpics(projectId: string, epics: readonly Pick<Epic, 'epic' | 'stories'>[]): void {
  const record = readShown()
  const withStory = epics.filter((epic) => epic.stories?.some((entry) => entry.kind === 'epic') === true).map((epic) => epic.epic)
  const known = record[projectId]
  if (known === undefined) {
    record[projectId] = withStory
    writeShown(record)
    return
  }
  const fresh = withStory.filter((epic) => !known.includes(epic))
  if (fresh.length === 0) return
  record[projectId] = [...known, ...fresh]
  writeShown(record)
```

- Что делает: считает Epic-и со `story.md`; первый model Project-а только запоминает их, дальше новый Epic даёт toast и
  записывается в localStorage окна (папка данных worfy). `stories/*.md` не учитываются.
- Почему здесь: факт «показан» должен пережить перезапуск, а Project с готовыми Epic-ами не должен дать пачку toast-ов.
- Без него: каждое чтение model-а и каждый запуск worfy снова показывали бы toast.
- Требование: [Что делаем, п. 4](../issues/10-входы-в-вид-story-и-toast.md#что-делаем)
- Риски и пробелы test-ов: правило «первый model только запоминает» решено без владельца; story.md, появившийся, пока
  Project ни разу не открывался на этой машине, toast-а не даёт.

## 6. «⋯» рамки остаётся ради story

Code: `src/renderer/canvas/actions/AutopilotAction.tsx:652-653` · key lines: 653

```ts
  const storyPath = epicStoryPath(epic)
  if (hidden && !pastRuns && storyPath === null) return null
```

- Что делает: у done Epic-а без прошлых Run-ов «⋯» раньше не рисовался; теперь он есть, пока у Epic-а есть `story.md`, с
  одним пунктом «Code story».
- Почему здесь: «меню Epic-а» — это «⋯» Autopilot-а, другого меню у рамки нет, а story появляется как раз у done Epic-а.
- Без него: вход из меню пропал бы ровно тогда, когда story есть.
- Требование: [Что делаем, п. 1](../issues/10-входы-в-вид-story-и-toast.md#что-делаем)
- Риски и пробелы test-ов: AutopilotAction.tsx нет в «Где в коде» Ticket-а; случай done Epic-а без Run-ов не покрыт test-ом.

## 7. Что сознательно не меняли

`PullRequestsSection.tsx` из «Где в коде» не тронут: в боковой панели только счётчики групп, отдельного PR там нет,
кнопка «Code story» стоит в панели выбранного PR. `ticket-card.ts` не тронут: строка действий карточки уже держит место.
Крючок `__worfyStory` оставлен — им пользуются e2e вида и a11y. Для PR без story кнопки нет — её даст Ticket 11.

## 8. Как проверено

`pnpm lint && pnpm typecheck && pnpm test` под временным HOME — exit 0. Unit test-ы `story-entries.test.tsx`,
`story-toast.test.ts`, `palette-commands.test.tsx`, `story-view.test.tsx` сначала были красными. e2e
`test/e2e/code-story.spec.ts` (входы, toast, снимки в обеих темах) — только в CI.
