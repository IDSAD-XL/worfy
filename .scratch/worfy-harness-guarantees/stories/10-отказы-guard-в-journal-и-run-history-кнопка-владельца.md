# Code story — worfy-harness-guarantees 10: Отказы guard в Journal и Run history; кнопка владельца

Kind: pr · Epic: worfy-harness-guarantees · Ticket: 10 · PR: - · Language: ru

## 1. Что было не так

Отказ guard-а видел только агент: Journal Run-а и Run history о нём молчали. PR, который дописывает путь проверки в
trail Ticket-а, `land` сливал сразу и только называл его в своей строке; PR без Ticket-а, который меняет путь
проверки, ждал владельца, но кнопки для владельца не было.

- Требование: [Что происходит](../issues/10-отказы-guard-в-journal-и-run-history-кнопка-владельца.md#что-происходит)

## 2. `land` ждёт отметки владельца

Code: `harness/bin/land:942-960` · key lines: 944, 947, 948, 956

```js
function verified(st, pr, head, view, marks) {
    const { touched, trail: t, outside, added } = verificationOf(st, pr, head, view)
    const owner = !!(marks && marks[OWNER_MARK] && marks[OWNER_MARK].state === "success")
    const notes = []
    if (touched.length) {
        if (!t.ticket && !owner) throw new Wait(`verification paths, and the PR has no ticket (${t.reason}): ${touched.join(", ")} — the owner decides`)
        if (!t.ticket) notes.push(`${touched.join(", ")} (no ticket, the owner's mark)`)
        else {
            const name = `${t.ticket.epic} ${t.ticket.nn}`
            if (!t.trail) throw new Wait(`verification paths outside the trail of ${name} (${t.reason}): ${touched.join(", ")}`)
            if (outside.length) throw new Wait(`verification paths outside the trail of ${name}: ${outside.join(", ")}`)
            notes.push(`${touched.join(", ")} (trail of ${name})`)
        }
    }
    if (added.length && !owner) throw new Wait(`the owner's mark: verification paths added to the trail of ${added.map((e) => e.ticket || e.file).join(", ")}`)
    for (const e of added) notes.push(`added to the trail of ${e.file}: ${e.paths.join(", ")}`)
    if (notes.length) log(`#${pr.number}: verification paths: ${notes.join("; ")}`)
    return notes.length ? `verification paths: ${notes.join("; ")}` : null
}
```

- Что делает: отметка — commit status `owner` success среди статусов head-а (`marks` читает `ready()` на том же
  head). Без неё PR, который дописывает путь проверки в trail, ждёт с причиной `the owner's mark: …`; с ней проходит.
  PR без Ticket-а с отметкой проходит с заметкой `(no ticket, the owner's mark)`. Путь вне trail-а своего Ticket-а
  ждёт и с отметкой.
- Почему здесь: Ticket называет `ready()` и `statuses` в `harness/bin/land` и текст причины ожидания.
- Без него: такой PR сливался без решения владельца (новый test на старом `land` — 10 падений).
- Требование: [Готово, когда, п. 4](../issues/10-отказы-guard-в-journal-и-run-history-кнопка-владельца.md#готово-когда)
- Риски и пробелы test-ов: отметка на другом commit-е и `pending` — случаи `land-verification.test.sh`; что `land`
  сам ничего не пишет на GitHub — проверка файла `posted` в том же test-е.

## 3. Запись отметки — только по щелчку и один раз

Code: `src/main/github/owner-mark.ts:128-142` · key lines: 129, 130, 131, 133

```ts
      if (look.error !== null) return refused(`The PR could not be read, nothing is written: ${look.error}`, look)
      if (!look.needed) return refused('The PR needs no owner mark now: it is closed, or it changes no verification path that needs one', look)
      if (look.head !== head) return refused(`The PR moved to ${short(look.head ?? '')} since the view showed ${short(head)}: look at the new head first`, look)
      if (look.allowed) return { outcome: 'already', reason: null, look }
      try {
        await this.options.run(['api', '--method', 'POST', `repos/${repo}/statuses/${head}`, '-f', 'state=success', '-f', `context=${OWNER_CONTEXT}`, '-f', `description=${OWNER_DESCRIPTION}`], root, env)
      } catch (error) {
        const reason = firstLine(messageOf(error))
        this.health.failed(root, reason)
        return { outcome: 'failed', reason: `GitHub did not take the mark: ${reason}`, look }
      }
      this.health.answered(root)
      return { outcome: 'allowed', reason: null, look: { ...look, allowed: true } }
    } finally {
      this.inFlight.delete(key)
```

- Что делает: перед записью заново читает `land --verification`; отказывает, если PR больше не нуждается в отметке
  или head сдвинулся с того, что видел владелец; при `owner` success отвечает `already`; иначе один POST статуса
  `owner` на этот head. Ошибку GitHub возвращает с причиной и не повторяет.
- Почему здесь: Ticket называет новый модуль в `src/main/github/` по образцу `pr-reply-send.ts` (ADR-0105) и
  `pr-review-submit.ts` (ADR-0112): ничего не пишется без щелчка.
- Без него: отметка могла бы лечь на head, которого владелец не видел, или дважды.
- Требование: [Готово, когда, п. 3](../issues/10-отказы-guard-в-journal-и-run-history-кнопка-владельца.md#готово-когда)
- Риски и пробелы test-ов: `test/unit/owner-mark.test.ts` идёт на stub gh и stub `land`; настоящий POST на GitHub
  не проверялся. Гонка двух щелчков — множество `inFlight`, test «a second click while the first runs».

## 4. Кнопка в виде PR

Code: `src/renderer/pr-inbox/VerificationChange.tsx:62-73` · key lines: 66, 69, 70

```tsx
  const allow = (): void => {
    if (running) return
    setRunning(true)
    setAnswer({ ...answer, note: null })
    void invoke('prInbox.allowVerification', { projectId, repo, number, head: shown })
      .then((result) => {
        if (!result.ok) return setAnswer({ ...answer, note: failureReason('prInbox.allowVerification', result.error) })
        const said = result.value.outcome === 'refused' || result.value.outcome === 'failed' ? result.value.reason : null
        setAnswer({ ...answer, look: result.value.look, note: said })
      })
      .finally(() => setRunning(false))
  }
```

- Что делает: щелчок отправляет `prInbox.allowVerification` с head-ом, который показал вид; ответ main меняет
  строку (отметка стоит) или пишет причину отказа рядом с кнопкой. Открытие вида только читает `prInbox.verification`.
- Почему здесь: Ticket называет `src/renderer/pr-inbox/PrInboxView.tsx` и правую панель вида PR.
- Без него: у владельца не было способа поставить отметку, которой ждёт `land`.
- Требование: [Готово, когда, п. 3](../issues/10-отказы-guard-в-journal-и-run-history-кнопка-владельца.md#готово-когда)
- Риски и пробелы test-ов: `test/unit/pr-inbox-verification.test.tsx` — на fake bridge; e2e для кнопки нет.

## 5. `WORFY_GUARD_LOG` у Session-ов Claude и Codex

Code: `src/main/vendors/claude/options.ts:812-819` · key lines: 816

```ts
function sessionEnv(input: SessionOptionsInput): Env {
  const own: Env = {
    ...(input.kind === 'product' ? { [SESSION_KIND_VARIABLE]: 'product' } : {}),
    ...(input.epic !== undefined && input.epic !== '' ? { [EPIC_VARIABLE]: input.epic } : {}),
    ...(input.guardLog !== undefined && input.guardLog !== '' ? { [GUARD_LOG_VARIABLE]: input.guardLog } : {}),
  }
  return input.environment === undefined && Object.keys(own).length === 0 ? input.env : { ...input.env, ...input.environment, ...own }
}
```

- Что делает: в окружение Claude Code кладётся путь файла отказов Session-а; у Codex то же делает
  `src/main/vendors/codex/session.ts:965`. Файл один на Session: `<данные worfy>/guard-log/<id>.jsonl`.
- Почему здесь: Ticket называет `sessionEnv` и окружение Run-а Codex.
- Без него: guard ничего не пишет (без переменной лог выключен), и Run-у нечего читать.
- Требование: [Готово, когда, п. 1](../issues/10-отказы-guard-в-journal-и-run-history-кнопка-владельца.md#готово-когда)
- Риски и пробелы test-ов: `agent-options.test.ts` и `codex-session.test.ts` проверяют переменную; Session-ы, которые
  worfy не запускал, отказов в Run history не дают. Файлы `guard-log/` никто не чистит.

## 6. Строки файла — в Journal видом `guard-deny`

Code: `src/main/autopilot/run.ts:4297-4311` · key lines: 4298, 4302, 4307

```ts
  private readGuardLogs(run: Run): Promise<void> {
    run.guardRead = run.guardRead.then(async () => {
      for (const [file, { tail, session }] of run.guardTails) {
        let refusals: GuardRefusal[]
        try {
          refusals = await tail.read()
        } catch (error) {
          console.warn(`[autopilot] ${run.projectId}: could not read the guard's refusals in ${file}`, error)
          continue
        }
        for (const refusal of refusals) await this.write(run, guardDenyFields(refusal, session, homedir()))
      }
    })
    return run.guardRead
  }
```

- Что делает: Run читает файлы своих Session-ов цепочкой (`guardRead`), так что строка не переносится дважды, и
  пишет каждую строку отказа в Journal. Читатель (`GuardLogTail`) берёт только целые строки и только отказы с
  момента, когда Run взял Session (`guardSince`). Чтение идёт на `result`, `background_tasks` и при отпускании Session.
- Почему здесь: Ticket называет `src/main/autopilot/` — место, где Run пишет Journal.
- Без него: отказ видел только агент.
- Требование: [Готово, когда, п. 1](../issues/10-отказы-guard-в-journal-и-run-history-кнопка-владельца.md#готово-когда)
- Риски и пробелы test-ов: `autopilot-run.test.ts` (3 test-а) и `guard-deny.test.ts`, в том числе запуск настоящего
  `harness/hooks/guard.mjs`. Отказ после последнего `result` и до отпускания ловит только чтение при отпускании.

## 7. Блок Guard в Run history

Code: `src/renderer/flight-recorder/DetailPanel.tsx:483-494` · key lines: 484, 486, 489

```tsx
            <tr key={index} data-testid="run-history-guard-refusal">
              <td>{clock(Date.parse(refusal.at))}</td>
              <td>
                {refusal.agent ?? 'Orchestrator'}
                {refusal.ticket === undefined ? null : <span className="w-fr-muted"> ({refusal.ticket})</span>}
              </td>
              <td title={refusal.rule}>{guardRuleText(refusal.rule)}</td>
              <td>
                <code>{refusal.command === '' ? refusal.tool : refusal.command}</code>
              </td>
            </tr>
          ))}
```

- Что делает: строка блока — время, кто (`Orchestrator` у main Session), правило словами и команда. В шапке Run-а
  после причины остановки — `Guard · N refused`.
- Почему здесь: Ticket называет `RunHistoryView.tsx` и `DetailPanel.tsx`.
- Без него: отказы лежали бы в Journal, но на экране их не было бы.
- Требование: [Готово, когда, п. 2](../issues/10-отказы-guard-в-journal-и-run-history-кнопка-владельца.md#готово-когда)
- Риски и пробелы test-ов: «строка в конце Run-а» прочитана как строка в шапке после причины остановки — так в
  тексте Ticket-а не записано. E2e `test/e2e/flight-recorder.spec.ts` дописан, локально не запускался.

## 8. Что сознательно не меняли

- `harness/hooks/guard.mjs` не тронут: формат строки отказа уже в его шапке, а файл параллельно правит Ticket 06.
- Правило путей проверок в приложении не повторено: вид PR и запись читают его у `land --verification`.

## 9. Как проверено

`bash harness/bin/tests/land-verification.test.sh` — exit 0 (52 проверки; на `land` из main — 10 падений);
`land.test.sh`, `land-story.test.sh`, `land-epic-story.test.sh`, `guard-verification.test.sh`,
`plugin-neutral.test.sh` — exit 0; `pnpm lint`, `pnpm typecheck` — exit 0; unit и contract test-ы затронутых модулей
(`guard-deny`, `owner-mark`, `pr-inbox-*`, `autopilot-*`, `flight-recorder-*`, `agent-options`, `codex-session`) — exit 0.

## Проверить себя

1. Почему щелчок, сделанный после нового push в PR, ничего не пишет?
   - Ответ: main заново читает head и отказывает, если он не тот, что показал вид: отметка одного commit-а ничего не
     говорит о следующем.
   - Строки: `src/main/github/owner-mark.ts:130`
2. Пропустит ли отметка `owner` путь проверки вне trail-а Ticket-а PR-а?
   - Ответ: нет: для PR с Ticket-ом путь вне trail-а ждёт до проверки отметки, отметка снимает только ожидание
     расширения trail-а и PR без Ticket-а.
   - Строки: `harness/bin/land:947-956`
3. Почему отказ guard-а не попадает в Journal дважды, хотя чтение запускают и `result`, и отпускание Session?
   - Ответ: чтения идут одно за другим через `guardRead`, а читатель двигает свой offset только на целые строки.
   - Строки: `src/main/autopilot/run.ts:4298-4310`
