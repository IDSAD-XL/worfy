# Code story — worfy-polish 172: Waits сам закрывает то, что пользователь уже сделал

Kind: pr · Epic: worfy-polish · Ticket: 172 · PR: - · Language: ru

## 1. Что было не так

Во вкладке Waits копились пункты, дело по которым уже сделано: PR смержен или закрыт, Harness заменён, черновики
отправлены. Поиск PR inbox берёт только открытые PR, поэтому пункт смерженного PR висел до 14 дней; строку Health
check `harness` пересчитывал только полный прогон; пункты Slack, Jira, Autopilot и предложения без пункта уходили
только по Dismiss.

- Требование: [Что происходит](../issues/172-waits-закрывает-сделанное.md#что-происходит)

## 2. Поиск PR inbox говорит, что он нашёл и полон ли он

Code: `src/main/github/inbox.ts:812-815` · key lines: 814

```ts
    }
    state.members = members
    state.searchComplete = data.review.nodes.length < INBOX_SEARCH_LIMIT && data.involves.nodes.length < INBOX_SEARCH_LIMIT
  }
```

- Что делает: после каждого поиска reader запоминает, что оба `search` дали меньше `INBOX_SEARCH_LIMIT` (100) PR-ов; snapshot отдаёт это вместе с ключами всех найденных PR (`search.found`, строка 589), с details в cache или без.
- Почему здесь: Ticket называет `inbox.ts:57`, `:75`, `:98-101` и snapshot (`src/shared/ipc/pr-inbox.ts`) среди своих файлов и требует, чтобы reader отдал полноту и номера, а решение шло по номерам поиска, а не по строкам групп.
- Без него: по строкам групп нельзя отличить смерженный PR от открытого, чьи details не прочитались (он уходит из cache), а по странице в 100 PR — смерженный от не вошедшего в страницу.
- Требование: [Что строить, п. 1](../issues/172-waits-закрывает-сделанное.md#что-строить)
- Риски и пробелы test-ов: поиск, у которого ровно 100 PR, считается неполным, хотя мог быть полным: пункт тогда висит до 14 дней, как раньше. Проверено в `test/contract/pr-inbox.test.ts` (100 PR — не полный, 99 — полный).

## 3. Attention core закрывает пункт PR, которого полный поиск не нашёл

Code: `src/main/assistant/core/sources.ts:184-190` · key lines: 184, 188

```ts
  if (snapshot.error !== null || snapshot.search == null || !snapshot.search.complete) return
  const found = new Set(snapshot.search.found)
  for (const item of core.items(snapshot.projectId)) {
    // The keys of its events go too: a PR this one search missed, found again unchanged, waits again.
    if (item.source === 'pr-inbox' && item.subject.kind === 'pr' && OPEN_STATES.includes(item.state) && !found.has(item.subject.id)) core.resolveGone(snapshot.projectId, item.subject, 'pr-inbox', `${item.subject.id}:`)
  }
}
```

- Что делает: после строк snapshot-а `prInboxAttention` проходит по открытым пунктам `pr-inbox` Project-а и закрывает те, чьего PR нет в `search.found`, через `resolveGone`: он ещё снимает ключи `seen` этого PR, так что PR, найденный снова с тем же `updatedAt`, открывает пункт снова (ревью, раунд 1). Ошибка чтения, неполный поиск или snapshot без `search` не закрывают ничего.
- Почему здесь: Ticket называет `sources.ts:160-179` (`takePrInbox`); `readAt === null` и выключенный reader отсекает уже первая строка `takePrInbox`.
- Без него: пункт смерженного PR и предложение на нём («Resolve conflicts in PR #8406») висят до удаления через 14 дней.
- Требование: [Что происходит, п. 1](../issues/172-waits-закрывает-сделанное.md#что-происходит), [Готово, когда, п. 1](../issues/172-waits-закрывает-сделанное.md#готово-когда)
- Риски и пробелы test-ов: закрываются только пункты источника `pr-inbox`; пункт `ci` о том же PR (subject другой) не трогается. Шесть случаев «нельзя проверить» и повторное открытие — в `test/unit/assistant-attention-sources.test.ts`; снятые ключи `seen` значат, что PR, пропавший и найденный снова в тот же день, склеивается в прежний пункт (`events` растёт).

## 4. Строка Harness пересчитывается после установки и на focus

Code: `src/main/first-run/harness-row.ts:17-24` · key lines: 22, 23

```ts
export function followHarnessRow(
  health: Pick<HealthReports, 'registerRecheck' | 'recheckNow'>,
  deps: Pick<CheckDeps, 'harness' | 'update'>,
  onInstalled: (listener: (status: HarnessStatus) => void) => () => void,
): () => void {
  health.registerRecheck('harness', () => harnessCheck(deps))
  return onInstalled((status) => void health.recheckNow('harness', undefined, () => harnessCheck(deps, status)))
}
```

- Что делает: re-check `harness` регистрируется у Health check (focus окна, не чаще раза в 5 мин, если строка не `ok`), а каждое `onHarnessInstalled` пересчитывает строку с тем статусом, что вернула установка. `harnessCheck` (`checks.ts`) читает только `appInstaller().status()` и прошлый `harnessBehind` из snapshot-а Update.
- Почему здесь: Ticket велит подписаться на `onHarnessInstalled` (`src/main/ipc/harness.ts:50-56`) и зарегистрировать re-check по образцу `github-access` (`src/main/ipc/first-run.ts:286-292`). Отдельный файл — чтобы проводку проверить без Electron; `first-run.ts` только зовёт его.
- Без него: пункт «Replace Harness» висит до следующего полного прогона Health check.
- Требование: [Что строить, п. 2](../issues/172-waits-закрывает-сделанное.md#что-строить), [Готово, когда, п. 2](../issues/172-waits-закрывает-сделанное.md#готово-когда)
- Риски и пробелы test-ов: `HealthReports.recheckNow` пересчитывает только строку, которая уже есть в отчёте (иначе первая проверка ставила вторую строку рядом — e2e `first-run.spec.ts:381`, CI раунд 1), и ждёт идущий re-check той же строки, чтобы не потерять пересчёт после установки (test с медленным re-check на focus, ревью раунд 1); Сам popover версии и Electron не запускались (бриф).

## 5. Первое сообщение автоматического wake-а несёт то, что worfy проверить не может

Code: `src/main/assistant/session/runner.ts:94-98` · key lines: 95, 97

```ts
function unchecked(wake: AssistantWake, items: readonly AttentionItem[], itemRecord: (item: AttentionItem) => { id: string }): string[] {
  if (wake.reason === 'user') return []
  const handed = new Set(wake.items.map((item) => item.id))
  const open = items.filter((item) => ASSISTANT_RECHECKED_SOURCES.includes(item.source) && OPEN_STATES.includes(item.state) && !handed.has(item.id)).sort((a, b) => a.startedAt - b.startedAt)
  if (open.length === 0) return []
```

- Что делает: на batch, urgent и morning `wakePrompt` получает раздел «Open items worfy cannot re-check»: открытые пункты Slack, Jira и Autopilot, не переданные этим wake-ом, самые старые первыми, не больше 10, короткими записями `worfy-app` (тексты — outside-text) и число остальных. Run на сообщение пользователя раздела не получает.
- Почему здесь: решение владельца 2026-11-28: model перепроверяет такие пункты на wake-ах, которые и так идут. Ticket называет `runner.ts:93-108` (`wakePrompt`).
- Без него: model не знает о старых пунктах Slack, Jira и Autopilot, и они висят до Dismiss пользователя.
- Требование: [Решения владельца](../issues/172-waits-закрывает-сделанное.md#решения-владельца), [Что строить, п. 3](../issues/172-waits-закрывает-сделанное.md#что-строить)
- Риски и пробелы test-ов: размер раздела не ограничен числом символов, только десятью записями с обрезанным title (`ITEM_TITLE_MAX` = 300). Planner не менялся: test в `assistant-wake-planner.test.ts` охранный, зелёный и до правки.

## 6. `item_close`: закрыть можно только то, что worfy сам не проверит

Code: `src/main/mcp/app-server.ts:676-687` · key lines: 680, 683, 685

```ts
    item_close: async ({ id, why }) => {
      await refuseLinkedItem(id, 'Nothing was closed.')
      const item = deps.items().find((each) => publicItemId(each.id) === id)
      if (item === undefined) throw new ToolError(`No item ${id}: items_list lists them. Nothing was closed.`)
      if (!ASSISTANT_RECHECKED_SOURCES.includes(item.source)) {
        throw new ToolError(`Item ${id} is of ${item.source}: worfy re-checks such items itself and closes them when their cause goes. Only items of ${ASSISTANT_RECHECKED_SOURCES.join(', ')} are closed with item_close. Nothing was closed.`)
      }
      if (!OPEN_STATES.includes(item.state)) throw new ToolError(`Item ${id} is not open (${item.state}). Nothing was closed.`)
      // Hidden first, then cut: a hidden secret may make the line longer than the item keeps.
      deps.closeItem(item, redactSecrets(why.trim()).slice(0, ITEM_CLOSE_WHY_MAX))
      return { closed: id }
    },
```

- Что делает: новый tool закрывает открытый пункт Slack, Jira или Autopilot с `why` (до 200 символов, секреты скрыты, потом обрезка); пункт Linked machine, неизвестный id, пункт другого источника и не открытый пункт — отказ. Строки Journal нет.
- Почему здесь: Ticket: «нового tool-а в `worfy-app` нет, его надо завести: `item_close { id, why }`» рядом с `proposal_remove` (`app-server.ts:659-666`); Journal не трогать — решение владельца.
- Без него: model нечем закрыть пункт без пункта-причины, кроме как попросить пользователя.
- Требование: [Что строить, п. 3](../issues/172-waits-закрывает-сделанное.md#что-строить), [Решения владельца](../issues/172-waits-закрывает-сделанное.md#решения-владельца)
- Риски и пробелы test-ов: закрытие идёт через `AttentionCore.close`, `closedBy`/`closedWhy` снимаются, когда новое событие склеивается с пунктом; пункт нового дня — новый пункт без метки. Настоящая Session не запускалась: test зовёт tool через JSON-RPC, как это сделала бы Session.

## 7. `proposal_remove` с `why` прячет предложение и хранит причину

Code: `src/main/assistant/proposals/book.ts:91-97` · key lines: 94, 95

```ts
  remove(id: string, closed?: { by: 'assistant'; why: string }): void {
    const before = this.get(id)
    const next = new Map(this.kept())
    if (closed === undefined) next.delete(id)
    else next.set(id, { ...before, closed: { at: this.options.now(), by: closed.by, why: closed.why } })
    this.commit(next)
  }
```

- Что делает: без `why` предложение удаляется, как раньше; с `why` остаётся в book с `closed: { at, by, why }`. `list()` его не отдаёт (окно, `proposals_list`), `memoryView` не несёт его в первое сообщение, следующая запись после 14 дней убирает его из файла.
- Почему здесь: Ticket: «С `why` book не удаляет предложение, а помечает закрытым… хранит его 14 дней, как пункты»; файл назван в «Где в коде».
- Без него: предложение «7 draft replies wait for your Send» нельзя ни проверить, ни закрыть с объяснением.
- Требование: [Что строить, п. 3](../issues/172-waits-закрывает-сделанное.md#что-строить)
- Риски и пробелы test-ов: старая сборка, прочитавшая тот же файл памяти, не знает поля `closed` и покажет такое предложение снова (zod отбросит поле).

## 8. Что сознательно не меняли

Journal (`src/main/assistant/actions/journal.ts`) — ни строки о закрытии (решение владельца 2026-11-28). Planner,
daily limit и правило 80 % не тронуты. Новых вызовов GitHub и новых таймеров нет. Дата старше 6 дней —
`shortTime` (`src/renderer/assistant/format.ts`), считает календарные дни, чтобы день недели не совпал с сегодняшним.

## 9. Как проверено

- `pnpm lint` — exit 0; `pnpm typecheck` — exit 0; `pnpm test` — см. Evidence в Ticket-е.
- Новые и изменённые test-ы: `test/contract/pr-inbox.test.ts`, `test/unit/assistant-attention-sources.test.ts`,
  `test/contract/health-harness-row.test.ts`, `test/unit/assistant-session.test.ts`,
  `test/contract/worfy-app-tools.test.ts`, `test/contract/assistant-two-machines.test.ts`,
  `test/unit/assistant-wake-planner.test.ts`, `test/unit/assistant-short-time.test.tsx`.

## Проверить себя

1. Почему пункт PR не закрывается, когда PR просто пропал из строк групп snapshot-а?
   - Ответ: PR, чьи details не прочитались, уходит из cache и из строк, хотя открыт; решение идёт по `search.found` — ключам самого поиска.
   - Строки: `src/main/assistant/core/sources.ts:184-190`, `src/main/github/inbox.ts:812-815`
2. Что помешает model закрыть пункт, который worfy проверяет сам, например пункт Health check?
   - Ответ: `item_close` отказывает всему, чей источник не в `ASSISTANT_RECHECKED_SOURCES` (slack, jira, autopilot).
   - Строки: `src/main/mcp/app-server.ts:676-687`
3. Почему run на сообщение пользователя не получает раздел с открытыми пунктами?
   - Ответ: пользователь ждёт ответа; уборка едет только на автоматических wake-ах — `unchecked` возвращает пустой список при `reason === 'user'`.
   - Строки: `src/main/assistant/session/runner.ts:94-98`
