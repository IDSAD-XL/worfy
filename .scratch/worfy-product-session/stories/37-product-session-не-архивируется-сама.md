# Code story — worfy-product-session 37: Product Session не уходит в архив сама

Kind: pr · Epic: worfy-product-session · Ticket: 37 · PR: - · Language: ru

## 1. Что было не так

Автоархив законченных Session (ADR-0076) брал Node Product Session так же, как любой Session Node: по порогу
«Archive finished sessions after», по правилу `ticket-done` и в «Archive finished sessions now». Владелец хочет, чтобы
Product Session оставалась на Canvas, пока он сам не отправит её в архив.

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

Code: `src/main/layout/archive.ts:141-151` · key lines: 145

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
  (⌘Z после Restore, ⇧⌘Z), а отдельного действия Archive на одном Node в UI нет.
- Без него: Product Session, простоявшая дольше порога, уходила бы в архив на следующем прогоне таймера.
- Требование: [Готово, когда](../issues/37-product-session-не-архивируется-сама.md#готово-когда)
- Риски и пробелы test-ов: уже заархивированная Product Session сама не возвращается — так требует Ticket. Ручной
  пункт на Mac Stable test-ы не заменяют.

## 4. Как проверено

- `pnpm test test/unit/archive-rule.test.ts test/contract/layout-archive.test.ts`: пять новых unit test-ов и три
  contract test-а красные до правки `archive.ts`, зелёные после.
- `pnpm lint && pnpm typecheck && pnpm test` — exit 0; gate fast — exit 0; `pnpm test:e2e test/e2e/session-archive.spec.ts`
  — exit 0.

## Проверить себя

1. Почему «Archive finished sessions now» перестал предлагать Product Session без отдельной правки `candidatesNow`?
   - Ответ: `candidatesNow` считает кандидатов через `archiveCandidates`, а тот начинает с `finishedSessions`, где Node
     Product Session отсеивается.
   - Строки: `src/main/layout/archive.ts:141-145`
2. Почему ⌘Z после Restore по-прежнему возвращает Product Session в архив?
   - Ответ: этот `archive` идёт через `archiveFromScreen`, а там свой отбор без `isProductSessionNode`: архив просит
     пользователь, и правило к нему не применяется.
   - Строки: `src/main/layout/archive.ts:385-387`
