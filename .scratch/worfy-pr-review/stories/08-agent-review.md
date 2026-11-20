# Code story — worfy-pr-review 08: Agent review

Kind: pr · Epic: worfy-pr-review · Ticket: 08 · PR: - · Language: ru

## 1. Что было не так

Черновик ревью чужого PR (Ticket 07) писал только main. Agent review — второй способ ревью рядом с Review myself:
Session с Team reviewer-ом или линзами пишет весь черновик сама. Ей нужен свой писатель файла, который не трогает
записи человека, канал запуска и остановки, и main должен видеть её записи по мере появления. Возражение 3 critic-а:
два писателя одного файла — main и скрипт — не должны терять записи друг друга.

- Требование: [Что происходит](../issues/08-agent-review.md#что-происходит)

## 2. Main пишет файл черновика под общим замком

Code: `src/main/github/pr-review-draft.ts:546-556` · key lines: 546, 547, 550

```ts
      await withLock(file, async () => {
        const draft = applied(await this.read(file), pending.changes, file, pending.repo, pending.pr, this.warn)
        if (draft !== null) {
          await (this.options.writeFile ?? ((path, text) => writeFile(path, text)))(tmp, serialize(draft))
          await renameInto(tmp, file)
          written = true
        }
        // Right after the rename, with no await between: a quit (flushSync) while the temporary file is removed must not
        // find the written changes still waiting. Inside exclusive(): no change came meanwhile, so what waited is what was written.
        this.drop(file)
      })
```

- Что делает: чтение файла, наложение очереди изменений и rename временного файла идут под замком `<file>.lock` —
  файлом, который создаётся только если его ещё нет (`flag: 'wx'`). Тот же замок берёт `bin/pr-review-draft`. Замок
  старше 10 s оставил упавший писатель, его забирают. Не дождался замка 15 s — изменения остаются в очереди до
  следующей записи. `flushSync` при выходе и Discard берут тот же замок; замок, который держит запись этого же процесса
  (`heldHere`), `flushSync` не ждёт: до конца выхода эта запись уже не продолжится, а скрипт замок не пускает.
- Почему здесь: Ticket 07 уже перечитывал файл перед записью, но между чтением и rename-ом проходит несколько `await`;
  скрипт, записавший в это окно, терялся. Файл `pr-review-draft.ts` Ticket 08 называет «только читать»; без правки
  main пункт «ни одна запись не потеряна» не выполнить — это отклонение записано в «Итог» Ticket-а.
- Без него: test гонки (200 записей main и 200 записей скрипта) терял 98 записей скрипта из 200.
- Требование: [Готово, когда, п. 2](../issues/08-agent-review.md#готово-когда)
- Риски и пробелы test-ов: два писателя, одновременно нашедшие один устаревший замок, могут оба его забрать
  (комментарий `shortcut:` в коде); test этого не проверяет — замок устаревает только после падения писателя.

## 3. Скрипт меняет только записи агента

Code: `harness/bin/pr-review-draft:182-205` · key lines: 183, 184, 188, 190, 194, 200

```js
function apply(draft) {
    if (draft.state !== "draft") die(1, `the review is ${draft.state}: nothing written`)
    if (isObject(draft.agent) && draft.agent.state === "stopped") die(1, "Agent review was stopped in worfy (Stop or Take over): nothing written")
    if (request.kind === "comment") {
        const { path: where, line, side, start, body } = request
        const first = start ?? line
        const text = side === "RIGHT" ? linesAt(draft.anchoredOn ?? draft.startedOn, where, first, line) : null
        draft.payload.comments.push({ path: where, ...(start === undefined ? {} : { start_line: start, start_side: side }), line, side, body })
        draft.anchors.push({ text: text ?? "", by: "agent" })
        return `a comment on ${where}:${start === undefined ? line : `${start}-${line}`}`
    }
    if (request.kind === "summary") {
        if (draft.payload.body !== "" && draft.bodyBy !== "agent") die(1, "the summary is the person's: nothing written")
        draft.payload.body = request.body
        draft.bodyBy = "agent"
        return "the summary"
    }
    if (request.kind === "verdict") {
        draft.suggestedEvent = request.event
        return `the suggested verdict ${request.event}`
    }
    if (isObject(draft.agent)) draft.agent.state = "done"
    return "the end of the Agent review"
}
```

- Что делает: `comment` только добавляет запись с `by: 'agent'` и текстом строк на head-е черновика
  (`git show <anchoredOn|startedOn>:<path>`), по которому main найдёт строку после нового push-а; `summary` пишет
  итоговый текст, только пока он пуст или агентский (`bodyBy`); `verdict` ставит `suggestedEvent`, а не
  `payload.event`; `done` ставит `agent.state: 'done'`. Черновик в `submitting` / `submitted` и остановленный
  Agent review — exit 1, ничего не записано. Черновика нет — тоже exit 1: его создаёт только worfy.
- Почему здесь: Ticket называет новый `harness/bin/pr-review-draft`; правила «только записи агента», «итоговый текст —
  только пустой или свой» и «вердикт — только предложение» записаны в spec-е, «Решение», 6, и разделе 8.
- Без него: Session писала бы файл сама — инструментом файлов в Harness home (вопрос разрешения) или поверх правок
  человека; `payload.event` от агента ушёл бы в Submit без выбора человека.
- Требование: [Что делаем, п. 1](../issues/08-agent-review.md#что-делаем)
- Риски и пробелы test-ов: строка за концом файла на head-е отклоняется, только если git знает этот head в папке
  Project-а; иначе текст строк пуст, и после нового push-а комментарий остаётся на старой строке с пометкой «line
  moved». Строка вне diff-а PR не проверяется — это 422 GitHub-а, Ticket 10 показывает такие отдельно.

## 4. Канал запуска: черновик помечен до первого слова Session

Code: `src/main/github/pr-review-agent.ts:88-105` · key lines: 92, 93, 96, 101, 102, 103

```ts
      const current = await this.deps.drafts.draft(root, repo, number)
      if (current.draft === null && current.problem !== null) throw new Error(current.problem)
      const draft = current.draft
      if (draft !== null && draft.state !== 'draft') throw new Error(`This review is ${draft.state}: it is not changed any more`)
      if (draft?.agent?.state === 'writing' && this.live(draft.agent.sessionId)) throw new Error(`Agent review is writing the review of ${repo}#${number} already: Stop it first`)
      if (fill === 'new' && draft !== null && (draft.payload.comments.length > 0 || draft.payload.body !== '')) throw new Error('This pull request has a review draft already: Ask the agent to add comments to it')
      const teamReviewer = await this.teamReviewer(root)
      const view = this.deps.sessions.create(projectId, undefined, AGENT_REVIEW_VENDOR)
      const marked = await this.deps.drafts.setAgent(root, repo, number, { head, agent: { sessionId: view.sessionId, state: 'writing' } })
      // Nothing is sent then: the Session Node stays, idle, and the person may close it.
      if (marked.problem !== null || marked.draft === null) throw new Error(`Agent review did not start: ${marked.problem ?? 'the draft was not written'}`)
      // The commit of the draft, not `head`: after a push since the draft started they differ, and the script reads the
      // commented lines at the draft's commit.
      const text = agentReviewText({ teamReviewer, repo, pr: number, fill, head: marked.draft.anchoredOn ?? marked.draft.startedOn })
      await this.follow({ projectId, root, repo, number }, view.sessionId)
      this.deps.registry.get(view.sessionId).send(text)
      this.deps.changed({ projectId, repo, number })
      return { nodeId: view.nodeId, sessionId: view.sessionId, text, draft: marked.draft }
```

- Что делает: отказывает, если ревью отправляется или отправлено, если Agent review этого PR ещё пишет, и на
  `fill: 'new'` поверх черновика человека. Текст — `/human-review {repo}#{pr}`, когда skill Team reviewer-а собран в
  личной папке Project-а, иначе `/worfy:code-review {repo}#{pr}`, плюс правило черновика и коммит, который ревьюировать
  (`Review the commit <sha>`): коммит черновика (`anchoredOn`, иначе `startedOn`), а не `head` из входа — после push-а
  они расходятся, а строки комментариев считаются на коммите черновика. Session на Claude Code; `setAgent` пишет
  `agent: { sessionId, state: 'writing' }` сразу, мимо 500 ms склейки записей; затем watch файла и первое сообщение.
- Почему здесь: Ticket называет новый `src/main/github/pr-review-agent.ts`; порядок «черновик, потом сообщение» в
  Ticket-е не записан — он следует из того, что скрипт отказывает без черновика.
- Без него: Session, начавшая писать до записи черновика, получила бы «there is no review draft» на первом же
  комментарии.
- Требование: [Что делаем, п. 2 и 3](../issues/08-agent-review.md#что-делаем)
- Риски и пробелы test-ов: если запись черновика не удалась, Session Node уже создан и остаётся пустым; test этого
  случая нет.

## 5. Конец watch-а: агент закончил, остановлен, или его Session кончилась

Code: `src/main/github/pr-review-agent.ts:189-206` · key lines: 191, 192, 195, 201, 204

```ts
      // Gone: its Node closed.
    }
    if (state !== null && IN_TURN.has(state)) entry.turned = true
    const { draft, problem } = await this.deps.drafts.draft(pull.root, pull.repo, pull.number)
    if (this.watches.get(key) !== entry || entry.ending) return
    // Not read this time (a file being replaced, a disk busy for a moment): the next look reads it.
    if (draft === null && problem !== null) return
    const mine = draft?.agent?.sessionId === entry.sessionId
    if (!mine || draft?.agent?.state !== 'writing' || draft.state !== 'draft') {
      await this.end(key)
      return
    }
    const over = state === null || state === 'closed' || state === 'error' ? 'stopped' : entry.turned && state === 'idle' ? 'done' : null
    if (over === null) return
    entry.ending = true
    await this.deps.drafts.setAgent(pull.root, pull.repo, pull.number, { agent: { sessionId: entry.sessionId, state: over } })
    await this.end(key)
    this.deps.changed({ projectId: pull.projectId, repo: pull.repo, number: pull.number })
```

- Что делает: на каждое изменение файла и раз в 500 ms main смотрит черновик и Session. Черновик не прочитался
  (файл заменяют в этот момент) — этот взгляд пропущен, watch идёт дальше. Агент сказал `done` или человек нажал Stop
  — watch закрыт. Ход Session кончился без `done` — черновик помечается `done`; Session закрыта
  или упала — `stopped`. Watch — chokidar с опросом файла (`usePolling`), закрывается только через `closeForGood`.
- Почему здесь: Ticket требует watch на время записи и закрытие через `src/main/chokidar-close.ts`; опрос вместо
  событий ОС выбран без владельца (один файл на время ревью; события ОС на этом Mac сейчас не приходят — fseventsd).
- Без него: Session, кончившая ход без `done`, оставила бы `writing` навсегда — Finish review (Ticket 11) неактивен,
  пока агент пишет.
- Требование: [Что делаем, п. 4](../issues/08-agent-review.md#что-делаем)
- Риски и пробелы test-ов: `done` по концу хода требует, чтобы хоть один взгляд застал ход идущим (`turned`); ход
  короче 500 ms без записи в файл оставит `writing` до Stop. Test-ы есть на все четыре конца: `done` от агента, Stop,
  конец хода, закрытие Session — и на пропуск нечитаемого взгляда.

## 6. Как проверено

- `test/contract/harness-pr-review-draft.test.ts` — 10 test-ов: `comment`, `summary`, `verdict`, `done`, отказы,
  гонка 200 × 200 с main; до скрипта все 7 первых красные, до замка в main гонка теряла 98 записей. Три test-а замка
  при выходе (`flushSync`): свой замок не ждёт (до правки — 10006 ms), чужой ждёт, устаревший забирает.
- `test/contract/pr-review-agent.test.ts` — 12 test-ов на fake agent: команда при Team reviewer-е и без, коммит
  черновика в сообщении, `fill: 'add'`, отказы, `prReview.changed`, Stop, конец хода, закрытие Session, пропуск
  нечитаемого взгляда, Linked machine.
- `test/unit/action-templates.test.ts` — текст «Agent review» и Vendor Claude Code.
- `bash harness/bin/tests/agents-text.test.sh` — раздел в обоих skill-ах и 10 mutant-ов (фраза убрана — красный).
- Eval `harness/evals/agent-review-guards/` (`/worfy:code-review` в режиме Agent review на fixture PR): 2 из 2 run-ов,
  score 1.00, все четыре grader-а — запись только через `bin/pr-review-draft`, ни одной записи на GitHub.

## Проверить себя

1. Почему одного «перечитать файл перед записью» (как в Ticket-е 07) мало, чтобы запись скрипта не терялась?
   Ответ: между чтением и rename-ом в main проходят `await`-ы; скрипт, записавший в это окно, затирается rename-ом
   main. Замок держит чтение, изменение и rename обоих писателей вместе.
   Строки: `src/main/github/pr-review-draft.ts:546-556`
2. Что произойдёт, если агент вызовет `summary`, когда человек уже написал итоговый текст?
   Ответ: exit 1 «the summary is the person's», файл не меняется: `bodyBy` не `agent`, а текст не пуст.
   Строки: `harness/bin/pr-review-draft:193-198`
3. Почему `setAgent` пишет файл сразу, а не через 500 ms, как правки человека?
   Ответ: сразу после него Session получает первое сообщение; `bin/pr-review-draft` отказывает без черновика и
   после остановки, поэтому файл должен быть на диске раньше первого вызова скрипта.
   Строки: `src/main/github/pr-review-agent.ts:96-98`
