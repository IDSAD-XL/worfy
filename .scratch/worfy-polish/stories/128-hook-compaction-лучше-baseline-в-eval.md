# Code story — worfy-polish 128: Hook compaction: eval `compaction-state` с hook-ом лучше, чем без него

Kind: pr · Epic: worfy-polish · Ticket: 128 · PR: - · Language: ru

## 1. Что было не так

Eval `compaction-state` (кейс, где агент после compaction отвечает на шесть вопросов о своей работе) показывал, что с
hook-ами compaction агент знает свою работу хуже, чем без них: overallScore 0,64 против 0,73. Повтор с сохранёнными
trace-ами нашёл четыре причины. Две — в механике кейса: порог 5 % сжимал разговор снова на каждом вызове после первой
compaction, а судья, получая весь ответ сразу, проваливал верные разделы. Две — в тексте: hook велел «check each item
… before the next step», и агент читал это как приказ открыть файлы; `compaction.md` и вопрос 6 просили «one step»,
а grader ждал fix и повторный test.

- Требование: [Что происходит](../issues/128-hook-compaction-лучше-baseline-в-eval.md#что-происходит),
  [Откуда был провал](../issues/128-hook-compaction-лучше-baseline-в-eval.md#откуда-был-провал-четыре-причины-все-проверены)

## 2. Hook отдаёт implementer-у состояние работы: финиш, commit-ы, Ticket и diff

Code: `harness/hooks/after-compact.mjs:212-263` · key lines: 214, 219, 246, 250, 256, 259, 260

```js
async function commitsSince(cwd, base) {
    if (typeof base !== "string" || !base.trim()) return ""
    const log = await run(GIT, [...PLAIN_NAMES, "log", "--no-color", "--format=%h %s", "--name-status", `${base}..HEAD`, "--"], cwd)
    if (log.code !== 0) return ""
    let lines = log.out.split("\n").filter(Boolean)
    const more = lines.length - COMMIT_LINES
    if (more > 0) lines = [...lines.slice(0, COMMIT_LINES), `… ${more} more lines: run git log --name-status ${base}..HEAD`]
    return lines.length ? capped(lines.join("\n"), COMMIT_LIMIT, `… the commits are cut; all of them: git log --name-status ${base}..HEAD`) : "(none yet)"
}

async function implementerContext({ cwd, top, branch, ticket, base, finish, doneSection, fits }) {
    const id = `${ticket.epic}/${String(ticket.num).padStart(2, "0")}`
    const [root, status, commits, diff] = await Promise.all([
        node(process.env.CLAUDE_TICKET_BIN || path.join(bin, "ticket"), ["root"], cwd),
        run(GIT, [...PLAIN_NAMES, "status", "--short"], cwd),
        commitsSince(cwd, base),
        run(GIT, [...PLAIN_NAMES, "diff", "--no-color", "--no-ext-diff", "HEAD", "--"], cwd),
    ])
    if (root.code !== 0) throw new Quiet(`bin/ticket root ${why(root)}`)
    const issues = path.join(root.out.trim(), ticket.epic, "issues")
    let name
    try {
        name = fs.readdirSync(issues).find((f) => f.endsWith(".md") && new RegExp(`^0*${ticket.num}-`).test(f))
    } catch {}
    if (!name) throw new Quiet(`no file of ticket ${id} in ${issues}`)
    const file = slashes(path.join(issues, name))
    const text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n").replace(/\n+$/, "")
    let lines = status.code === 0 ? status.out.split("\n").filter(Boolean) : []
    const more = lines.length - STATUS_LINES
    if (more > 0) lines = [...lines.slice(0, STATUS_LINES), `… ${more} more lines: run git status --short`]
    const statusText = status.code !== 0 ? `(git status failed: ${why(status)})` : lines.length ? lines.join("\n") : "(clean)"
    // The heading of the profile, when the ticket has it (a profile without the field gets the default heading).
    const heading = typeof doneSection === "string" ? doneSection.trim() : ""
    const done = heading && text.split("\n").some((line) => line.trim() === heading) ? heading : "of done items"
    const diffText = diff.code === 0 ? diff.out.replace(/\n+$/, "") : `(git diff failed: ${why(diff)})`
    const ends = FINISH[finish]
    const body = [
        `Context compacted. You are the implementer of ticket ${id}: worktree ${slashes(top)}, branch ${branch}. The Harness read the state of that work for you right after the compaction: the commits of the branch, the changes not committed yet, and the ticket file. Together with the summary above, this is where the work stands now.`,
        ...(ends ? [`The ticket ${ends} (workflow.finish ${finish} of the profile).`] : []),
        "",
        "## Not committed: git status --short",
        statusText,
        "",
        `## Ticket ${file}`,
        `An empty box in its section ${done} is the usual state while the ticket is in work; the commits and the changes below show which items hold now. Before your report, check each done item against the work.`,
        "",
        text,
        ...(commits ? ["", `## Commits of ${branch} since ${base}`, commits] : []),
        ...(diffText ? ["", "## Not committed: git diff HEAD", capped(diffText, DIFF_LIMIT, "… the diff is cut; the whole of it: git diff HEAD")] : []),
    ].join("\n")
    return cut(body, `… cut to fit the hook limit; the whole ticket: ${file}; the diff: git diff HEAD`, fits)
}
```

- Что делает: после compaction implementer получает не только файл Ticket-а и `git status`, но и то, чем Ticket
  кончается (`workflow.finish` профиля), строку о том, что пустые флажки «Готово, когда» — обычное состояние в работе,
  а затем commit-ы ветки от `worktree.base` с их файлами (до 40 строк и 2000 символов) и `git diff HEAD` (до 3000
  символов или строка `(git diff failed: …)`). Commit-ы и diff стоят после Ticket-а: когда текст не влезает в лимит
  hook-а, режутся они, а не пункты «Готово, когда» (находка review, раунд 1). Имена файлов git печатает как есть
  (`core.quotePath=false`). Текст не велит запускать команды сейчас: прежнее «check each item of its done section
  against the work before the next step» удалено, проверка пунктов просится «before your report».
- Почему здесь: Ticket называет `after-compact.mjs` (`:195` implementer) в разделе «Где в коде» и предлагает, чтобы
  hook называл следующий шаг из ticket-файла и `git status`. Что агент читал прежнюю фразу как приказ открыть файлы и
  не знал, что закоммичено, — записано в «Итог», причина 3.
- Без него: агент после compaction не знает, какие пункты уже выполнены (файл Ticket-а этого не говорит), и прогон с
  hook-ом набирал 0/3 по пунктам «Готово, когда».
- Требование: [Что делаем, п. 3](../issues/128-hook-compaction-лучше-baseline-в-eval.md#что-делаем)
- Риски и пробелы test-ов: `session-hooks.test.sh` проверяет commit-ы, diff, строку финиша, отсутствие команды на
  сейчас, обрезку длинного diff-а после Ticket-а, длинный Ticket рядом с commit-ом 45 файлов, имена на кириллице и
  упавший `git diff`. `git status` (до 50 строк) по-прежнему стоит перед Ticket-ом, как в main. Качество текста для агента проверяет только платный eval; его прогоны в
  CI не входят.

## 3. Правила summary: следующий шаг с проверкой, пункты дословно, последняя упавшая команда

Code: `harness/hooks/rules/compaction.md:23-41` · key lines: 23, 24, 39, 40, 41

```md
7. **Next action** — the step to take first after compaction, with the exact edit or command, and the check
   that shows it worked: after a fix, the command that failed, run again.

## By role

Put the facts of the role into those sections. The role follows from the conversation: its first
instructions and the task it was given.

**Orchestrator** — a main Session that runs an epic: the epic, the wave number and each ticket of the
wave with its state; every PR in work with its number, branch, CI state and review verdict; the agents
still running, each with its name, ticket and worktree; every decision taken without the owner, one
line each, as in the decision log (`decisions.tsv`, skill `worfy:epic-wave`); the questions waiting for
the owner.

**Implementer** — an agent that ships one ticket (`worfy:implementer`): the ticket file, the worktree
path, the branch and the base commit; every item of the ticket's done section (`tickets.done_section`
of the profile), word for word, each with its mark — done with its evidence, not done, or not verified;
the PR number when there is one; the commands run so far with their exit codes; the last command that
failed, the error it printed and its cause; and what the change removed from existing behaviour.
```

- Что делает: Next action теперь несёт и проверку после шага (упавшую команду снова), implementer хранит пункты
  «Готово, когда» дословно и последнюю упавшую команду с ошибкой и причиной.
- Почему здесь: Ticket предлагает, чтобы `compaction.md` просил сохранить последнюю красную команду и что запустить
  после fix; прежнее «the one step» записано в «Итог», причина 4.
- Без него: summary называет один fix без повторного `node --test`, и агент после compaction считает работу
  законченной на fix-е.
- Требование: [Что делаем, п. 3](../issues/128-hook-compaction-лучше-baseline-в-eval.md#что-делаем)
- Риски и пробелы test-ов: `rules-hooks.test.sh` проверяет три новые фразы текстом; следует ли им модель, видно только
  в eval.

## 4. Кейс сжимает разговор ровно один раз

Code: `scripts/eval-harness.mjs:99-108` · key lines: 102, 107

```js
/**
 * The cases of the tag `alone` and the environment each gets in its call; a case may set only EVAL_*
 * variables itself. compaction-state: exactly one auto compaction, before the first answer. Claude Code
 * 2.1.322 compacts at 50 % of the window less 20000 tokens of output room: 40000. The history counts more
 * (harness/evals/compaction-state/history.mjs); the context after the compaction, about 30500 tokens, stays
 * under it. At 5 % (4000) every call after the first compaction compacted again (worfy-polish ticket 128).
 */
const ALONE = {
  'compaction-state': { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '100000', CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '50' },
}
```

- Что делает: порог compaction кейса — 50 % окна, 40000 токенов, вместо 4000. История кейса (`history.mjs`,
  `BASE_TOKENS` 38000 вместо 21000) считает около 45000 токенов, выше порога, а реальный контекст после compaction
  (около 30500) ниже: разговор сжимается один раз. Grader `compacted` теперь требует ровно одну границу
  (`match: count:1`).
- Почему здесь: Ticket называет `scripts/eval-harness.mjs:105` и `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`. Формулу порога
  Claude Code 2.1.322 и две–три compaction в каждом run-е прогона 0 записывает «Итог», причина 1.
- Без него: вторая summary пишется, когда вопросы `PROBES.md` уже в разговоре, и eval меряет не hook, а случай.
- Требование: [Что делаем, п. 2](../issues/128-hook-compaction-лучше-baseline-в-eval.md#что-делаем)
- Риски и пробелы test-ов: `harness-evals-run.test.ts` проверяет, что порог не ниже 36000 и ниже usage истории.
  Реальный размер контекста после compaction test не меряет: он зависит от версии Claude Code и длины правил.

## 5. Каждый ответ — в свой файл, и судья читает только его

Code: `harness/evals/compaction-state/graders/probe-done-items.md:1-16` · key lines: 3, 6

```md
---
type: llm
focus: { source: file, path: answers/3-done-items.md }
---

Probe 3, the done items. The text is the answer the agent wrote to answers/3-done-items.md, and nothing else of its reply. The ticket's section «Готово, когда» has exactly four items. The answer lists all four, in any language and wording that keeps their meaning, each with
the state below:
1. `double(2)` returns `4`, test in test/alpha.test.mjs — done: `node --test` passed (exit code 0) after
   double was written, and it is committed.
2. `double('2')` throws `TypeError`, test in the same file — done, the same evidence.
3. `import { sum, double } from 'demo'` works, test in test/index.test.mjs — not done: that test fails with
   ERR_MODULE_NOT_FOUND.
4. `node --test` exits with code 0 — not done: the last run exited with code 1.
Pass when all four items are there with these states. Fail when an item is missing, when an item that
is not in the ticket is listed as one of its done items, when item 3 or item 4 is called done, or when
the answer says it does not know the items.
```

- Что делает: агент пишет шесть ответов в файлы `answers/1-goal.md` … `answers/6-next-step.md` (`prompt.md`
  разрешает `Write`), и каждый судья probe-а получает только свой файл. Так же устроены остальные пять probes;
  вопрос 6 спрашивает и о проверке после шага, судья probe-ticket принимает абсолютный путь Ticket-а.
- Почему здесь: Ticket называет `graders/probe-*.md` и критерии судьи. Что судья, получая весь ответ, проваливает
  верный раздел (отдельно PASS ×3, внутри всего ответа FAIL ×3), записывает «Итог», причина 2.
- Без него: оценка зависит от того, как судья читает длинный ответ, и разница между вариантами тонет в его ошибках.
- Требование: [Что делаем, п. 2](../issues/128-hook-compaction-лучше-baseline-в-eval.md#что-делаем)
- Риски и пробелы test-ов: contract test `harness-evals.test.ts` проверяет, что кейс полон и fixture строится;
  правильность критериев судьи проверялась только повтором ответов на настоящем судье (0,94 USD).

## 6. Что сознательно не меняли

- Пункт «After a compaction…» в `harness/hooks/rules/common.md`: он нужен, когда hook не сработал.
- Последнюю упавшую команду hook не читает из transcript-а: у Subagent-а `transcript_path` — transcript главной
  Session. Её хранит summary (шаг 3).
- Русский перевод `docs/features/ru/`: по правилу проекта правится английская страница.

## 7. Как проверено

- Eval, Claude Code 2.1.322, агент `claude-sonnet-5`, судья `claude-haiku-4-5`: окончательный вариант дважды по шесть
  run-ов — overallScore с hook-ом 0,955 и 0,985, без hook-а 0,924 и 0,924. Пункты «Готово, когда» с hook-ом 5/6 и 6/6,
  без hook-а 1/6 и 2/6; Ticket и следующий шаг — 6/6 в обоих вариантах. Все прогоны и цена (16,96 USD) — в «Итог».
- `bash harness/hooks/tests/session-hooks.test.sh` (61), `bash harness/hooks/tests/rules-hooks.test.sh` (331),
  `pnpm exec vitest run test/contract/harness-evals.test.ts test/contract/harness-evals-run.test.ts
  test/contract/harness-evals-story.test.ts` (351), `bash harness/bin/tests/plugin-neutral.test.sh`,
  `bash harness/bin/tests/agents-text.test.sh`, `pnpm lint`, `pnpm typecheck` — exit 0. gate fast не запускался по
  брифу: на этом Mac `fseventsd` делает test-ы watcher-а файлов красными.

## Проверить себя

1. Почему порог кейса 50 %, а не 5 %, и почему пришлось поднять число токенов истории?
   - Ответ: после compaction в контексте около 30500 токенов; порог 4000 ниже этого, и каждый следующий вызов снова
     сжимал разговор. Порог 40000 выше контекста после compaction, а история должна считать больше 40000, чтобы
     первая compaction вообще случилась.
   - Строки: `scripts/eval-harness.mjs:102-104`
2. Почему commit-ы и diff стоят после файла Ticket-а, а не перед ним?
   - Ответ: когда текст не влезает в лимит hook-а, `cut` режет конец; так теряется хвост commit-ов и diff-а, а Ticket
     с пунктами «Готово, когда» доходит целиком, даже если ветка меняет много файлов.
   - Строки: `harness/hooks/after-compact.mjs:255-262`
