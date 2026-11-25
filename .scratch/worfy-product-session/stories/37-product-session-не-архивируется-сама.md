# Code story — worfy-product-session 37: Product Session не уходит в архив сама

Kind: pr · Epic: worfy-product-session · Ticket: 37 · PR: - · Language: ru

## 1. Что было не так

Автоархив законченных Session (ADR-0076) брал Node Product Session так же, как любой Session Node: по порогу
«Archive finished sessions after», по правилу `ticket-done` и в «Archive finished sessions now». Владелец хочет, чтобы
Product Session оставалась на Canvas, пока он сам не отправит её в архив. Отправить в архив один Node пользователь не
мог: такого действия в UI не было.

- Требование: [Что происходит](../issues/37-product-session-не-архивируется-сама.md#что-происходит)

## 2. Один предикат Product Session

Code: `src/shared/ipc/sessions.ts:58-65` · key lines: 64

```ts
/**
 * Whether a Layout Node is a Product Session's: a Session Node worfy runs whose data names the kind
 * `product`. main reads it for the save signal of an archived Node (src/main/agent/node-sessions.ts)
 * and to keep the Node out of the automatic archive (src/main/layout/archive.ts; ADR-0076, Amendments).
 */
export function isProductSessionNode(node: Pick<LayoutNode, 'kind' | 'data'>): boolean {
  return node.kind === SESSION_NODE_KIND && node.data.origin === 'worfy' && node.data.kind === 'product'
}
```

- Что делает: говорит, что Node — Product Session: Session Node, который запускает worfy, с `data.kind: 'product'`.
- Почему здесь: бриф требует взять существующую проверку, а не завести вторую. Она стояла прямо в
  `src/main/agent/node-sessions.ts` (сигнал сохранения при архиве Node-а); теперь её читают и `node-sessions.ts`, и
  `archive.ts`. В `src/shared/ipc/sessions.ts` уже лежат `SESSION_NODE_KIND` и описание `kind` в данных Node-а.
- Без него: в `archive.ts` появилась бы своя копия условия, и две проверки могли бы разойтись.
- Требование: [Где в коде](../issues/37-product-session-не-архивируется-сама.md#где-в-коде)
- Риски и пробелы test-ов: Node, у которого `kind: 'product'`, но `origin` не `worfy`, Product Session не считается —
  так было и в `node-sessions.ts`.

## 3. Правило архива пропускает Product Session

Code: `src/main/layout/archive.ts:142-152` · key lines: 146

```ts
function finishedSessions(nodes: readonly LayoutNode[], live: readonly LiveSessionLike[], history: readonly HistoryLike[]): FinishedSession[] {
  const alive = new Set(live.map((session) => session.sessionId))
  const lastAt = new Map(history.map((session) => [session.sessionId, session.lastAt === undefined ? Number.NaN : Date.parse(session.lastAt)]))
  return nodes.flatMap((node): FinishedSession[] => {
    if (node.kind !== SESSION_NODE_KIND || isArchived(node) || node.pinned || node.keep === true || isProductSessionNode(node)) return []
    const sessionId = sessionOf(node)
    if (sessionId === null || alive.has(sessionId)) return []
    const last = lastAt.get(sessionId)
    return [{ node, sessionId, lastAt: last === undefined || Number.isNaN(last) ? undefined : last }]
  })
}
```

- Что делает: `finishedSessions` — общий первый отбор правила. Из него берут `archiveCandidates` (таймер и «Archive
  finished sessions now» через `candidatesNow`), `bindingsNeeded` и `sessionsWithoutClock`. Node Product Session
  выпадает здесь, как Node с Keep, поэтому его не берёт ни один порог, ни `ticket-done`, и таймер не ставит ему
  `touchedAt`.
- Почему здесь: Ticket называет `archive.ts`, `archiveCandidates`, `ticket-done` и `candidatesNow`; одна проверка в
  общем отборе закрывает их все. `archiveFromScreen` её не получает: это `archive`, который просит сам пользователь
  (кнопка Archive на Node, ⌘Z после Restore, ⇧⌘Z).
- Без него: Product Session, простоявшая дольше порога, уходила бы в архив на следующем прогоне таймера.
- Требование: [Готово, когда](../issues/37-product-session-не-архивируется-сама.md#готово-когда)
- Риски и пробелы test-ов: уже заархивированная Product Session сама не возвращается — так требует Ticket. Ручной
  пункт на Mac Stable test-ы не заменяют.

## 4. Archive одного Node-а — `archive` с экрана

Code: `src/renderer/canvas/archive-node.ts:16-18` · key lines: 17

```ts
export function archiveSessionNode(projectId: string, nodeId: string, channel: LayoutChannel): Promise<string | undefined> {
  return applyRecorded(projectId, { op: 'archive', batch: crypto.randomUUID(), nodes: [{ id: nodeId, rule: 'idle' }] }, channel)
}
```

- Что делает: шлёт `archive` одного Node-а с новой партией через записывающий канал экрана. `applyRecorded` кладёт его
  в историю ⌘Z, а main проверяет его в `archiveFromScreen` и не берёт Node с Keep, закреплённый или с живой Session.
- Почему здесь: Orchestrator добавил в Ticket действие Archive на Node, через существующий `archive` с экрана. Модуль
  без React, чтобы его грузил contract test архива (`tsconfig.test.node.json`). Правило в записи — `idle`: новое
  значение `archiveRuleSchema` старый worfy не прочитал бы, а `readJsonFile` откладывает такой файл в сторону и
  начинает с пустого Layout-а (`src/main/storage/json-file.ts`).
- Без него: Product Session, которую автоархив больше не берёт, нельзя было бы отправить в архив совсем.
- Требование: [Готово, когда](../issues/37-product-session-не-архивируется-сама.md#готово-когда)
- Риски и пробелы test-ов: запись не отличает ручной архив от архива по порогу — оба `idle`. В UI правило архива
  нигде не показывается.

## 5. Кнопка Archive на каждом Session Node

Code: `src/renderer/canvas/nodes/SessionNode.tsx:299-319` · key lines: 300, 304, 312

```tsx
const archiveBlock = (node: { keep: boolean; pinned: boolean }, session: string | null): string | null =>
  node.keep ? 'Kept on the Canvas: press Kept to let it go first' : node.pinned ? 'Pinned to the screen: unpin it first' : session

function ArchiveButton({ projectId, id, blocked, readOnly, onProblem }: { projectId: string; id: string; blocked: string | null; readOnly: string | null; onProblem: (problem: string) => void }) {
  const archive = () =>
    void archiveSessionNode(projectId, id, screenChannel(projectId)).then((problem) => {
      if (problem !== undefined) onProblem(problem)
    })
  return (
    <button
      type="button"
      className="nodrag"
      style={styles.archive}
      data-testid="session-node-archive"
      disabled={blocked !== null}
      {...writeAction(readOnly, archive, blocked ?? 'Archive this Session: it leaves the Canvas, nothing is deleted; Restore in the Archive brings it back')}
    >
      Archive
    </button>
  )
}
```

- Что делает: кнопка Archive у каждого Session Node — и у того, что запускает worfy, и у read-only. Неактивна, и
  tooltip говорит почему, когда main всё равно отказал бы: Keep, закреплённый Node, Session работает или ещё не
  начиналась. Отказ main при записи уходит в строку ошибки Node-а.
- Почему здесь: своего контекстного меню у Session Node нет; действия над Node-ом — кнопки на самом Node-е. Строки в
  Command palette нет: у palette нет строк для выбранного Node-а.
- Без него: пользователь нажимал бы Archive на работающей Session и получал бы отказ без объяснения.
- Требование: [Готово, когда](../issues/37-product-session-не-архивируется-сама.md#готово-когда)
- Риски и пробелы test-ов: unit test-ы проверяют кнопку у Node-а, который запускает worfy; у read-only Node-а её
  проверяет e2e (живая Session `LIVE` — неактивна).

## 6. Archive — под шапкой, не в ней

Code: `src/renderer/canvas/nodes/SessionNode.tsx:145-158` · key lines: 149, 150

```tsx
  // Archive sits at the end of the line under the header, not in the header: there the chip and the
  // other buttons leave the title no room for one more (a 300 px Codex Node, worfy-product-session
  // ticket 37). The source on that line gives way instead.
  archive: {
    flex: 'none',
    marginLeft: 'auto',
    padding: '0 4px',
    border: 0,
    borderRadius: 'var(--radius-button)',
    background: 'transparent',
    color: 'var(--text-muted)',
    font: 'inherit',
    fontSize: 'var(--text-11)',
  },
```

- Что делает: кнопка стоит в конце строки под шапкой (метка Product Session, badge Vendor-а, источник), прижата вправо
  и не сжимается. Место отдают по порядку: сначала источник (`flex: '1 1 0'`), потом метка Product Session (многоточие),
  так что на Node-е 240 px Archive целая, а на 340 px метка не обрезана.
- Почему здесь: в шапке рядом с chip-ом, Keep, Hide и Remove кнопка не оставила заголовку Node-а Codex шириной 300 px
  места совсем: CI windows-e2e упал в `codex-sessions-on-canvas.spec.ts`, двойной щелчок по заголовку нашёл его
  невидимым. Метка Product Session и Resume Node-а Codex уже вынесены под шапку по той же причине (комментарии в
  `SessionNode.tsx`). Шапка теперь такая же, как до этого PR.
- Без него: на узком Node-е заголовок пропадает, и двойной щелчок по нему не открывает Session.
- Требование: [Где в коде](../issues/37-product-session-не-архивируется-сама.md#где-в-коде)
- Риски и пробелы test-ов: e2e проверяют, что Archive кончается внутри своей строки у каждого Node-а, в том числе у
  Product Session шириной 240 px, и что метка на 340 px целая. Долю заголовка они проверяют по виду шапки: больше 0,08
  у read-only Node-а и у Codex (на Mac около 0,12–0,14), больше 0,05 у законченного Node-а worfy (около 0,09). Заголовок
  законченного Node-а worfy (Resume, Keep, Hide, Remove) и до этого PR был узким, около десятой части Node-а, а на 240 px
  шапка main не оставляет ему места совсем и обрезает Remove; этот PR шапку не меняет. Что новый test красный с кнопкой в шапке, проверено только на Windows в CI, локально не проверялось.

## 7. Как проверено

- `pnpm test test/unit/archive-rule.test.ts test/contract/layout-archive.test.ts`: пять новых unit test-ов и три
  contract test-а красные до правки `archive.ts`, зелёные после.
- `test/unit/session-node-product.test.tsx` (кнопка), `test/unit/settings-canvas.test.tsx` (подсказка под порогом),
  contract test `archiveSessionNode` — красные до правки, зелёные после.
- `pnpm test:e2e test/e2e/session-archive.spec.ts test/e2e/codex-sessions-on-canvas.spec.ts` — exit 0: «Archive finished
  sessions now» и таймер на 24 h Product Session не берут, её Archive убирает её с Canvas, Restore в Archive возвращает;
  у каждого Node-а, Codex 300 px тоже, Archive виден и заголовок видим.
- `pnpm lint && pnpm typecheck && pnpm test` — exit 0; gate fast — exit 0.

## Проверить себя

1. Почему «Archive finished sessions now» перестал предлагать Product Session без отдельной правки `candidatesNow`?
   - Ответ: `candidatesNow` считает кандидатов через `archiveCandidates`, а тот начинает с `finishedSessions`, где Node
     Product Session отсеивается.
   - Строки: `src/main/layout/archive.ts:142-146`
2. Почему ⌘Z после Restore по-прежнему возвращает Product Session в архив?
   - Ответ: этот `archive` идёт через `archiveFromScreen`, а там свой отбор без `isProductSessionNode`: архив просит
     пользователь, и правило к нему не применяется.
   - Строки: `src/main/layout/archive.ts:386-388`
3. Почему кнопка Archive неактивна на Node с Keep, хотя Keep говорит только об автоархиве?
   - Ответ: кнопка идёт через `archiveFromScreen`, а он отбрасывает Node с Keep; активная кнопка получила бы отказ.
   - Строки: `src/renderer/canvas/nodes/SessionNode.tsx:299-300`
