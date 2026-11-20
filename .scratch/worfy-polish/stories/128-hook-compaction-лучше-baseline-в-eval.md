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

Code: `harness/hooks/after-compact.mjs:229-280` · key lines: 253, 268, 271, 275, 276, 279

```js
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
    const statusText =
        status.code !== 0
            ? `(git status failed: ${why(status)})`
            : lines.length
              ? capped(lines.join("\n"), STATUS_LIMIT, "… more lines: run git status --short")
              : "(clean)"
    const section = doneLines(text, doneSection)
    const done = section ? section.heading : "of done items"
    const diffText = diff.code === 0 ? diff.out.replace(/\n+$/, "") : `(git diff failed: ${why(diff)})`
    const ends = FINISH[finish]
    const note = `… cut to fit the hook limit; the whole ticket: ${file}; the diff: git diff HEAD`
    const head = [
        `Context compacted. You are the implementer of ticket ${id}: worktree ${slashes(top)}, branch ${branch}. The Harness read the state of that work for you right after the compaction: the commits of the branch, the changes not committed yet, and the ticket file. Together with the summary above, this is where the work stands now.`,
        ...(ends ? [`The ticket ${ends} (workflow.finish ${finish} of the profile).`] : []),
        "",
        "## Not committed: git status --short",
        statusText,
        "",
        `## Ticket ${file}`,
        `An empty box in its section ${done} is the usual state while the ticket is in work; the commits and the changes below show which items hold now. Before your report, check each done item against the work.`,
        "",
    ].join("\n")
    const ticketText = fittedTicket(text, section, (t) => fits(`${head}\n${t}\n${note}`), file)
    const body = [
        head,
        ticketText,
        ...(commits ? ["", `## Commits of ${branch} since ${base}`, commits] : []),
        ...(diffText ? ["", "## Not committed: git diff HEAD", capped(diffText, DIFF_LIMIT, "… the diff is cut; the whole of it: git diff HEAD")] : []),
    ].join("\n")
    // What has no fixed size comes after the ticket, so this cut takes the commits and the diff first.
    return cut(body, note, fits)
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

## 3. Ticket больше лимита теряет середину, но не раздел «Готово, когда»

Code: `harness/hooks/after-compact.mjs:284-318` · key lines: 285, 300, 306, 309

```js
function doneLines(text, doneSection) {
    const items = parseDoneSection(text, { doneSection })
    if (!items.length) return null
    const lines = text.split("\n")
    const isHeading = (line) => /^#{1,6}\s/.test(line)
    let from = items[0].line - 1
    while (from > 0 && !isHeading(lines[from])) from--
    let to = items[items.length - 1].end - 1
    while (to + 1 < lines.length && !isHeading(lines[to + 1])) to++
    return { heading: lines[from].trim(), from, to }
}

/** `text` when `fits` takes it; otherwise its first lines that fit, a line that names the cut, and the whole done
 * section after it: the description in the middle gives way, the done items never do. Without a done section,
 * `text` as it is; a done section over the limit by itself comes without the lines before it, and the last cut
 * takes its tail. */
function fittedTicket(text, section, fits, file) {
    if (fits(text) || !section) return text
    const lines = text.split("\n")
    const after = section.to + 1 < lines.length ? [`… the rest of the ticket after this section is cut; the whole ticket: ${file}`] : []
    const build = (k) => {
        const skipped = section.from - k
        const gap = skipped > 0 ? [`… ${skipped} lines of the ticket cut here; the whole ticket: ${file}`, ""] : []
        return [...lines.slice(0, k), ...gap, ...lines.slice(section.from, section.to + 1), ...after].join("\n")
    }
    if (!fits(build(0))) return build(0)
    let lo = 0
    let hi = section.from
    while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2)
        if (fits(build(mid))) lo = mid
        else hi = mid - 1
    }
    return build(lo)
}
```

- Что делает: `doneLines` находит раздел «Готово, когда» так же, как `bin/ticket` (`parseDoneSection` из
  `lib/evidence.cjs`: заголовок профиля, заголовок по умолчанию и старый русский), от его заголовка до следующего.
  Когда Ticket сам не влезает в лимит, `fittedTicket` оставляет столько первых строк, сколько влезает, строку о
  вырезанной середине и весь раздел; разделы после него заменяет одна строка. `git status` перед Ticket-ом ограничен
  1500 символами (шаг 2, строка 253).
- Почему здесь: находка review, раунд 2: в этом репозитории 596 из 1126 Ticket-ов длиннее 8000 символов, и
  последний `cut` оставлял начало Ticket-а без пунктов. Резать середину (описание), а не хвост, и искать раздел так,
  как его ищет Harness, предложил тот же review.
- Без него: при `git status` на 20 файлов и Ticket-е в 9000 символов агент получает начало Ticket-а и ни одного пункта.
- Требование: [Что делаем, п. 3](../issues/128-hook-compaction-лучше-baseline-в-eval.md#что-делаем)
- Риски и пробелы test-ов: `session-hooks.test.sh` проверяет Ticket в 12 000 символов с разделом в конце и с
  разделом перед «Итог», `git status` в 56 строк и commit из 45 файлов; mutant-ы без обрезки середины и без лимита
  `git status` — красные. Раздел, который сам длиннее лимита, режется с хвоста.

## 4. Правила summary: следующий шаг с проверкой, пункты дословно, последняя упавшая команда

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

## 5. Кейс сжимает разговор ровно один раз

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

## 6. Каждый ответ — в свой файл, и судья читает только его

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

## 7. Что сознательно не меняли

- Пункт «After a compaction…» в `harness/hooks/rules/common.md`: он нужен, когда hook не сработал.
- Последнюю упавшую команду hook не читает из transcript-а: у Subagent-а `transcript_path` — transcript главной
  Session. Её хранит summary (шаг 4).
- Русский перевод `docs/features/ru/`: по правилу проекта правится английская страница.

## 8. Как проверено

- Eval, Claude Code 2.1.322, агент `claude-sonnet-5`, судья `claude-haiku-4-5`: окончательный вариант дважды по шесть
  run-ов — overallScore с hook-ом 0,955 и 0,985, без hook-а 0,924 и 0,924. Пункты «Готово, когда» с hook-ом 5/6 и 6/6,
  без hook-а 1/6 и 2/6; Ticket и следующий шаг — 6/6 в обоих вариантах. Все прогоны и цена (16,96 USD) — в «Итог».
- `bash harness/hooks/tests/session-hooks.test.sh` (63), `bash harness/hooks/tests/rules-hooks.test.sh` (331),
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
   - Строки: `harness/hooks/after-compact.mjs:271-279`
3. Что теряет Ticket, который сам длиннее лимита?
   - Ответ: строки середины (описание) между первыми строками и разделом «Готово, когда»; вместо них — строка с
     числом вырезанных строк и путём к файлу. Раздел целиком остаётся; разделы после него заменяет одна строка.
   - Строки: `harness/hooks/after-compact.mjs:303-317`

## 9. Что нашёл review и что осталось

> VERIFIED — worfy-polish 128 (the after-compaction hook: eval `compaction-state` with the hook beats the baseline), head 49f2d68e486aa3005c3b6cfdc54d6e57a986ed4e
>
> Gate (depth medium, three rounds, cap reached): verifier (lens: implementer's report, eval integrity) — all four run pairs on disk, numbers match, case edits act on both variants and fix real case defects (repeated compaction, a question contradicting its grader); reviewer (lens: correctness) round 1 one med (commits before the ticket pushed its done items out of the 10 000-char limit) + three low; round 2 one med (header + long git status + long ticket still cut the done items); round 3 one low. Both med fixed test-first.
>
> - Hook (harness/hooks/after-compact.mjs): after compaction the implementer gets the finish line, git status (≤ 50 lines, ≤ 1 500 chars, core.quotePath=false), the ticket — a ticket that does not fit keeps its first lines and its whole done section (found via parseDoneSection, as bin/ticket does), the middle replaced by one line naming the count and the file — then the branch commits since worktree.base (≤ 40 lines, ≤ 2 000 chars) and `git diff HEAD` (≤ 3 000 chars, a failure printed); «Before your report, check each done item against the work.»; output ≤ 10 000 chars, exit 0 always.
> - Eval compaction-state, hook vs baseline (all runs reported): run 0 old code 0.667/0.697; run 1 0.927/0.945; run 2 0.955/0.924; run 3 0.985/0.924; round 4 0.955/0.894; round 5 0.955/0.909. Done-items group: 4/5·3/5, 5/6·1/6, 6/6·2/6, 5/6·0/6, 5/6·2/6. Ticket and next-step groups 100 % in both variants since run 1. Total eval cost 26.16 USD (pre-approved, under 100).
> - Tests: session-hooks.test.sh 63 passed EXIT=0 (new cases red before each round; mutants: no middle cut, no status char cap, no quotePath → red), rules-hooks 331, plugin-neutral 37, agents-text 495, harness-evals*.test.ts 351 passed, lint, typecheck, story-check, evidence-check EXIT=0. Local gate fast not run: file-watcher tests red on this Mac (fseventsd); CI is the verdict.
> - CI fix: b7971e1f7 was red on harness-home.test.sh (Cyrillic outside the allowed substrings in session-hooks.test.sh fixtures); 49f2d68e4 changes only that test file (allowed headings, Cyrillic file names built from printf octal escapes); harness-home 46 passed, session-hooks 63 (mutants red), plugin-neutral, rules-hooks, agents-text, lint, typecheck EXIT=0; the hook text the agent sees is unchanged, no new eval.
>
> Owner decision required before merge: «Готово, когда» item 2 («above baseline in every probe group») is not literally met — Ticket and next-step groups are 100 % in both variants, «above» is impossible; recommendation: accept «not worse» for those two groups.
>
> Decided without the owner (to confirm): eval case edits (compaction at 50 %, BASE_TOKENS 38000, exactly one compaction, per-probe answer files, max_turns 12 with Write, question 6 asks for the verification); confirming eval rounds 4 and 5 after the review fixes; git status stays before the ticket as on main.
>
> Consider [low]: doneLines finds headings with /^#{1,6}\s/ ignoring code fences (parseDoneSection skips fenced lines) — a fenced `# comment` inside or after the done section can mislabel the section or cut the prose after the last item; scripts/eval-harness.mjs — two eval:harness runs started in the same millisecond share a git cache folder name (EEXIST).
