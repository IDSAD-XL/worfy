# Code story — worfy-harness-guarantees 03: guard: путь проверки — только по trail-у

Kind: pr · Epic: worfy-harness-guarantees · Ticket: 03 · PR: - · Language: ru

## 1. Что было не так

guard проверял только Bash, а Edit и Write не видел никто: matcher hook-а был `Bash|apply_patch`, и
`if (payload?.tool_name !== "Bash") ok()` пропускал всё остальное. Implementer мог поправить workflow CI или
настройку test-ов своим Edit-ом, и `ci-ok` стал бы зелёным по изменённым правилам; `land` ловил это только при merge.

- Требование: [Что происходит](../issues/03-guard-путь-проверки-только-по-trail-у.md#что-происходит)

## 2. Matcher: guard видит файловые tool-ы

Code: `harness/hooks/hooks.json:186-187` · key lines: 187

```json
      {
        "matcher": "Bash|apply_patch|Edit|Write|MultiEdit|NotebookEdit",
```

- Что делает: Claude Code зовёт guard на Edit, Write, MultiEdit и NotebookEdit, Codex — на `apply_patch`, как раньше.
- Почему здесь: Ticket называет `hooks.json:185-196` и matcher дословно («Что строить»).
- Без него: раздел 4 не получил бы ни одного вызова Edit или Write — test matcher-а в `guard-verification.test.sh`
  и строка `rules-hooks.test.sh` красные.
- Требование: [Что строить](../issues/03-guard-путь-проверки-только-по-trail-у.md#что-строить)
- Риски и пробелы test-ов: `MultiEdit` в Claude Code 2.1.322 нет (spike 01); строка matcher-а нужна новой версии,
  которая его вернёт. Новый tool записи под другим именем guard не увидит — это ловит contract set Ticket-а 08.

## 3. Кто Subagent и какие tool-ы доходят до раздела 4

Code: `harness/hooks/guard.mjs:117-135` · key lines: 123, 131, 133

```js
const agent = codex ? codexAgent(payload) : ""
const tool = payload?.tool_name
// A subagent: Claude Code gives `agent_id` inside a subagent only (`agent_type` is also on the main thread of a
// Session started with --agent, as a recorded run of the pinned Claude Code showed), Codex gives both inside a subagent only.
const agentId = typeof payload?.agent_id === "string" ? payload.agent_id : ""
const agentName = typeof payload?.agent_type === "string" ? payload.agent_type : ""
const subagent = agentId !== "" || (codex && agent !== "")
if (codex && tool === "apply_patch" && READ_ONLY_AGENTS.has(agent))
    deny(
        `${agent} edits no file: on Codex its apply_patch is refused, as Claude Code gives a reviewer and a scout no Edit or Write tool. ` +
            "Name the change in your report instead of making it; shell commands that only read and check stay allowed.",
        "read-only-agent"
    )
// The file tools only meet section 4; a shell command meets every section.
const FILE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit", "apply_patch"])
const bash = tool === "Bash"
if (!bash && !FILE_TOOLS.has(tool)) ok()
const cmd = bash ? String(payload?.tool_input?.command ?? "") : ""
if (bash && !cmd.trim()) ok()
```

- Что делает: Subagent — вызов с `agent_id` (Claude Code) или с `agent_type`/`agent_id` на Codex; файловые tool-ы
  проходят мимо Bash-разделов 0–3 прямо к разделу 4, остальные tool-ы — сразу `ok()`.
- Почему здесь: Ticket велит узнавать Subagent по полю, которое назвал spike 01; spike показал, что `agent_type` есть и
  у главного потока Session с `--agent`, а отличает `agent_id`.
- Без него: главный поток `--agent worfy:implementer` отказывался бы, как Subagent (test «the main thread of a --agent
  Session» красный), а Edit не доходил бы до проверки.
- Требование: [Что строить](../issues/03-guard-путь-проверки-только-по-trail-у.md#что-строить)
- Риски и пробелы test-ов: на Codex `worfy-implementer` в `agent_type` fixture-ы не показывают (spike 01, п. 8) —
  contract test подаёт его сам.

## 4. Решение — правило `land`

Code: `harness/hooks/guard.mjs:1353-1391` · key lines: 1358, 1359, 1371, 1374, 1380, 1389, 1390

```js
function verificationSection() {
    if (bash) marksAndFields()
    if (!subagent) return
    const targets = callTargets()
    for (const t of targets) {
        Object.assign(t, realTarget(t.abs))
        const tree = treeOf(t.dir)
        // the profile of the tree the file is in; a file outside the project's trees (a ticket in the Workflow folder)
        // is read by the profile of the folder the call runs in
        const read = tree ? projectProfile(tree.top) : null
        const own = read?.profile ? read : projectProfile(cwdOf())
        if (own?.profile) {
            const { folder } = ticketsPlace(own.profile, tree?.top || cwdOf())
            if (folder) trailEdit(t, realTarget(folder).real, own.profile.tickets?.trail_section)
        }
        // a folder no profile covers: the section is silent, as section 3 is
        if (!tree || read === null) continue
        const profile = read.profile
        const list = verificationPaths(profile)
        // an absolute root: a relative one would resolve from the working directory (a realpath on macOS)
        const opts = { root: tree.top }
        // the rule of bin/land: a verification path, or any symbolic link; and the folder above one a command removes
        if (!(touchesVerificationPath(t.real, list, { ...opts, symlink: t.symlink === true }) || (t.removes && isVerificationParent(t.real, list, opts)))) continue
        const rel = normalizePath(t.real, opts) + (t.symlink ? " (a symbolic link, which may point anywhere)" : "")
        if (!profile)
            deny(`${rel} is a verification path, and the profile of this project could not be read (bin/profile ${read.unread}), so no trail tells whether this ticket may edit it. ${PATH_STEP}.`, "verification-path-profile")
        const trail = trailOf(profile, tree)
        if (trail.ticket) refusedTicket = `${trail.ticket.epic}/${trail.ticket.nn}`
        if (!trail.ticket)
            deny(
                `${rel} is a verification path, and the branch ${tree.branch} names no ticket (${trail.reason}): a subagent without a ticket edits no verification path. ` +
                    `${PATH_STEP} of a ticket, and the edit is made on that ticket's branch.`,
                "verification-path-no-ticket"
            )
        const name = `${trail.ticket.epic} ${trail.ticket.nn}`
        if (!trail.trail) deny(`${rel} is a verification path, and the trail of ${name} cannot be read at ${trail.where} (${trail.reason}). ${PATH_STEP}.`, "verification-path")
        if (!namedByTrail(t.real, trail.trail, opts)) deny(`${rel} is a verification path, and the trail of ${name} does not name it. ${PATH_STEP}.`, "verification-path")
    }
}
```

- Что делает: для каждого файла вызова — realpath ближайшей существующей папки, дерево git этой папки и его ветка,
  профиль дерева; путь проверки (или любая символическая ссылка, или папка над путём при удалении) сверяется с trail-ом
  Ticket-а ветки на вершине `worktree.base` через `readTrail`/`namedByTrail` — те же helper-ы, что у `land`.
- Почему здесь: Ticket велит переиспользовать `verification-paths.cjs` и helper trail-а Ticket-а 04 («только вызов»);
  корень — дерево файла, потому что worktree лежат в `.claude/worktrees/`, а `.claude/**` — путь проверки по умолчанию.
- Без него: Edit в `.github/workflows/…` вне trail-а проходил (первый test, красный на старом коде); с корнем от cwd
  главного checkout-а любой файл worktree считался бы путём `.claude/**` (test «taken from the worktree's root»).
- Требование: [Готово, когда, п. 1–2](../issues/03-guard-путь-проверки-только-по-trail-у.md#готово-когда)
- Риски и пробелы test-ов: разбор shell-команды лексический — скрипт, который пишет файл сам, guard не видит; это
  закрывает `land`. Чтение, не ответившее за 8 s, пропускает (как упавший hook). Профиль берётся у дерева файла, а не
  у списка репозиториев Project-а: файл в чужом репозитории с веткой без Ticket-а тоже отказан.

## 5. Silent mode: правка trail-а в папке Ticket-ов

Code: `harness/hooks/guard.mjs:1331-1351` · key lines: 1338, 1342, 1343

```js
function trailEdit(t, folder, heading) {
    const rel = normalizePath(t.real, { root: folder })
    if (rel === null || !/\.md$/i.test(rel) || typeof heading !== "string") return
    let text = null
    try {
        text = fs.readFileSync(t.real, "utf8")
    } catch {}
    const before = text === null ? null : trailPaths(text, heading)
    let after
    if ("after" in t) after = t.after
    else if (t.edit && text !== null) after = t.edit(text)
    const afterTrail = after === undefined ? undefined : after === null ? null : trailPaths(after, heading)
    if (afterTrail === undefined ? before === null : JSON.stringify(before) === JSON.stringify(afterTrail)) return
    deny(
        `This edit ${afterTrail === undefined ? "may change" : "changes"} the trail section of ${rel} (${JSON.stringify(heading)}) in the tickets folder: ` +
            "outside the repository the guard and land read the trail from that file, so a subagent does not edit it. " +
            "Write the need into your report; the Orchestrator edits the trail." +
            (afterTrail === undefined ? " Edit the other sections of the ticket with the Edit tool." : ""),
        "ticket-trail-edit"
    )
}
```

- Что делает: файл Ticket-а в папке вне репозитория — trail до и после правки сравнивается так, как его читает
  `trailPaths`; правка, которая меняет пути trail-а, отказана, правка другого раздела проходит; запись, текст которой не
  известен (shell, patch с несошедшимся hunk-ом), отказана, если у Ticket-а есть раздел trail-а.
- Почему здесь: Ticket: «guard читает trail из файла Ticket-а в Workflow folder и отказывает Subagent-у правку раздела
  trail-а»; почему правка остальных разделов разрешена — not recorded (implementer пишет туда «Итог»).
- Без него: Subagent в Silent mode разрешал бы себе путь проверки, дописав его в свой trail (test «adds a path to a
  ticket's trail» красный на мутанте).
- Требование: [Готово, когда, п. 3](../issues/03-guard-путь-проверки-только-по-trail-у.md#готово-когда)
- Риски и пробелы test-ов: слабее Full mode — записано в spec-е («Silent mode слабее»); переименование Ticket-а
  shell-командой не разобрано.

## 6. `ticket mark` и `profile-set`

Code: `harness/hooks/guard.mjs:1160-1172` · key lines: 1164, 1165, 1166

```js
function marksAndFields() {
    for (const words of lex(flattenHeredocs(cmd).flat)) {
        const p = programOf(words)
        if (!p) continue
        if (p.prog === "ticket" && subagent) {
            const positional = operands(p.args, ["--root", "--repo", "--sha", "--waits"])
            if (positional[0] === "mark" && !p.args.includes("--contexts"))
                deny(
                    "`ticket mark` writes the marks the merge condition reads (review, check/*, deploy), and only the main Session writes them. " +
                        "Put the verdict into your report; the Orchestrator marks the head.",
                    "ticket-mark-subagent"
                )
        }
```

- Что делает: `ticket mark` (кроме `--contexts`) из Subagent-а отказан; ниже в той же функции — `profile-set --set` или
  `--reset` полей `verification.*`, `workflow.ci_check`, `workflow.pipeline`, `workflow.merge` (и Pipeline без
  `--field`) отказан любой Session агента.
- Почему здесь: Ticket: «Тот же раздел отказывает…»; поля меняет владелец формой Edit profile или в терминале.
- Без него: Subagent мог бы сам поставить себе `review success`, а агент — выключить условие merge (tests «ticket mark
  from a subagent», «profile-set --field workflow.merge» красные на мутантах).
- Требование: [Готово, когда, п. 4](../issues/03-guard-путь-проверки-только-по-trail-у.md#готово-когда)
- Риски и пробелы test-ов: имя программы — по basename (`ticket`, `profile-set`, через `node <path>`); копия скрипта под
  другим именем не узнаётся.

## 7. Один `deny()` и строка в `WORFY_GUARD_LOG`

Code: `harness/hooks/guard.mjs:88-108` · key lines: 93, 94, 95, 96, 97

```js
let refusedTicket = null
// The one way to refuse: the reason (what and why, then the next step, in English) goes back to the agent, and with
// WORFY_GUARD_LOG set one JSON line is appended to that file (the format is in the header). A log that cannot be
// written changes nothing: the refusal holds.
const deny = (reason, rule) => {
    const log = process.env.WORFY_GUARD_LOG
    if (log)
        try {
            fs.appendFileSync(log, JSON.stringify(denial(rule)) + "\n")
        } catch {}
    process.stdout.write(
        JSON.stringify({
            hookSpecificOutput: {
                hookEventName: "PreToolUse",
                permissionDecision: "deny",
                permissionDecisionReason: reason,
            },
        })
    )
    process.exit(0)
}
```

- Что делает: каждый отказ называет id правила; с `WORFY_GUARD_LOG` дописывается строка JSON (формат — в шапке
  `guard.mjs`), без переменной guard ничего не пишет; файл, который не пишется, отказ не отменяет.
- Почему здесь: Ticket: «Один helper отказа `deny()` в guard.mjs»; строку читает Ticket 10 (Journal и Run history).
- Без него: Ticket 10 не узнал бы, какое правило отказало (tests «WORFY_GUARD_LOG» красные).
- Требование: [Готово, когда, п. 5](../issues/03-guard-путь-проверки-только-по-trail-у.md#готово-когда)
- Риски и пробелы test-ов: `ticket` в строке — только когда раздел 4 читал trail; у остальных правил `null`.

## 8. Как проверено

`bash harness/hooks/tests/guard-verification.test.sh` — exit 0 (89 проверок; на старом guard-е — 57 FAIL из 85);
копия Harness, где `deny()` пропускает одно из шести новых правил, — test красный для каждого; `guard-silent.test.sh`,
`rules-hooks.test.sh`, `session-hooks.test.sh`, `harness-home.test.sh`, `plugin-neutral.test.sh` — exit 0;
`test/contract/harness-codex-hooks.test.ts`, `harness-guarantees.test.ts`, `harness-evals-run.test.ts` и соседние —
exit 0; `pnpm lint`, `pnpm typecheck` — exit 0. Windows и Git Bash — только CI.

## Проверить себя

1. Почему корень пути — `git rev-parse --show-toplevel` папки файла, а не cwd вызова?
   - Ответ: worktree лежит в `.claude/worktrees/` главного checkout-а; от его корня любой файл worktree был бы путём
     `.claude/**`, а ветка — `main` без Ticket-а.
   - Строки: `harness/hooks/guard.mjs:1359-1371`
2. Почему Edit главного потока Session, запущенной с `--agent`, не отказан, хотя в нём есть `agent_type`?
   - Ответ: Subagent на Claude Code узнаётся по `agent_id`, который есть только внутри Subagent-а.
   - Строки: `harness/hooks/guard.mjs:119-123`
