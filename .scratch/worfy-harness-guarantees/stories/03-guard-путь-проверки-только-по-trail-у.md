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
  Цена: каждый Edit и Write теперь запускает node с guard-ом (около 30 ms, с чтением профиля и git — около 110 ms;
  feature page `skills-agents-and-hooks.md`).

## 3. Кто Subagent и какие tool-ы доходят до раздела 4

Code: `harness/hooks/guard.mjs:123-141` · key lines: 129, 137, 139

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

Code: `harness/hooks/guard.mjs:1430-1477` · key lines: 1439, 1447, 1453, 1456, 1465, 1475

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
        if (own?.profile && checksPaths(own.profile)) {
            const { folder } = ticketsPlace(own.profile, tree?.top || cwdOf())
            if (folder) trailEdit(t, realTarget(folder).real, own.profile.tickets?.trail_section)
        }
        // a folder no profile covers: the section is silent, as section 3 is; a profile that could not be read (a
        // failure or the end of the budget) lets the call through, and land checks the PR at merge
        if (!tree || !read?.profile || !checksPaths(read.profile)) continue
        const profile = read.profile
        const list = verificationPaths(profile)
        // an absolute root: a relative one would resolve from the working directory (a realpath on macOS)
        const opts = { root: tree.top }
        // the rule of bin/land: a verification path, or any symbolic link; and the folder above one a command may write or remove whole
        if (!(touchesVerificationPath(t.real, list, { ...opts, symlink: t.symlink === true }) || (t.folder && isVerificationParent(t.real, list, opts)))) continue
        const rel = normalizePath(t.real, opts) + (t.symlink ? " (a symbolic link, which may point anywhere)" : "")
        // a detached HEAD is a review tree (worktree.reviewer): no ticket, and a reviewer adds nothing to a trail
        if (tree.branch === "HEAD")
            deny(
                `${rel} is a verification path, and this work tree is on a detached HEAD: a subagent edits no verification path in a review tree. ` +
                    "Mutate a copy outside the repository (copy the folder into a temporary directory and run the test against the copy), " +
                    "or name the change in your report.",
                "verification-path-detached"
            )
        const trail = trailOf(profile, tree)
        // git did not answer (a failure, the end of the budget): the guard cannot tell, land decides at merge
        if (trail.unread) continue
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
  профиль дерева; путь проверки (или любая символическая ссылка, или папка, которую команда пишет или удаляет целиком)
  сверяется с trail-ом Ticket-а ветки на вершине `worktree.base` через `readTrail`/`namedByTrail` — те же helper-ы, что
  у `land`. Дерево на detached HEAD без rebase (дерево reviewer-а) получает свой отказ: мутировать копию вне репозитория.
- Почему здесь: Ticket велит переиспользовать `verification-paths.cjs` и helper trail-а Ticket-а 04 («только вызов»);
  корень — дерево файла, потому что worktree лежат в `.claude/worktrees/`, а `.claude/**` — путь проверки по умолчанию.
  Текст для detached HEAD — решение review round 1 (reviewer-у не нужен trail, ему нужна копия).
- Без него: Edit в `.github/workflows/…` вне trail-а проходил (первый test, красный на старом коде); trail, прочитанный
  на HEAD ветки, разрешал бы Subagent-у путь, который он сам дописал в свой trail (test «the branch's own edit of its
  trail allows nothing (read on origin/main)» краснеет на мутанте, 32 FAIL).
- Требование: [Готово, когда, п. 1–2](../issues/03-guard-путь-проверки-только-по-trail-у.md#готово-когда)
- Риски и пробелы test-ов: разбор shell-команды лексический — скрипт, который пишет файл сам, guard не видит; это
  закрывает `land`. Профиль берётся у дерева файла, а не у списка репозиториев Project-а.

## 5. Какие профили проверяются

Code: `harness/hooks/guard.mjs:1418-1428` · key lines: 1427

```js
// Whether the guard checks verification paths for a project: a ticket branch template (tickets.branch with <epic> and
// <NN>) and one repository.
// shortcut: a project of several repositories is not checked — its trail entries start with the repository's name and
// the guard compares paths from the root of one tree (lib/ticket-trail.cjs, the shortcut on several repositories: redo
// when a project with several repositories gets a verification path check); nor is a profile without a ticket branch
// template, where no branch can name a ticket. bin/land still checks their PRs at merge.
function checksPaths(profile) {
    const template = profile?.tickets?.branch
    const repos = profile?._resolved?.repos
    return typeof template === "string" && template.includes("<epic>") && template.includes("<NN>") && !(Array.isArray(repos) && repos.length > 1)
}
```

- Что делает: пути проверок проверяются только у профиля с шаблоном ветки `tickets.branch` (`<epic>` и `<NN>`) и одним
  репозиторием; у остальных раздел путей молчит, `land` проверяет их PR при merge.
- Почему здесь: review round 1: у профиля с несколькими репозиториями запись trail-а начинается с имени репозитория,
  а у профиля без шаблона ни одна ветка не называет Ticket — без пропуска guard отказывал бы там всем. Условие переделки
  — то же, что у shortcut-а в `lib/ticket-trail.cjs`.
- Без него: test-ы «a profile of several repositories» и «a profile with no tickets.branch template» красные
  (мутанты «шаблон не проверяется» и «несколько репозиториев не проверяются»).
- Требование: [Готово, когда, п. 1](../issues/03-guard-путь-проверки-только-по-trail-у.md#готово-когда)
- Риски и пробелы test-ов: это известный предел, а не защита: Subagent проекта с несколькими репозиториями правит путь
  проверки без отказа до merge.

## 6. Сбой открывает проход

Code: `harness/hooks/guard.mjs:1007-1017` · key lines: 1014, 1017

```js
// The time all the reads of this section share — bin/profile, git rev-parse, git symbolic-ref and the git calls of the
// trail read — well inside the hook's limit with section 3's two tries after it (8 + 2 × 10 s of 30 s). A read that fails
// or runs out of it counts as not answered: the call is let through, as when the hook itself fails (the spec's
// risks: a failure of the guard opens the way; bin/land checks the PR's diff at merge). A test may shorten it, never lengthen it.
const SECTION4_MS = (() => {
    const DEFAULT = 8000
    const v = Number(process.env.CLAUDE_GUARD_READ_MS)
    return Number.isInteger(v) && v > 0 ? Math.min(v, DEFAULT) : DEFAULT
})()
const section4Until = Date.now() + SECTION4_MS
const section4Left = () => Math.max(1, section4Until - Date.now())
```

- Что делает: все чтения раздела 4 — `bin/profile`, `git rev-parse`, `git symbolic-ref`, оба вызова git в `readTrail`
  (новый параметр `timeout`) — делят один бюджет 8 s; чтение, которое упало или не уложилось, пропускает вызов.
  `CLAUDE_GUARD_READ_MS` в test-е только сокращает бюджет. Вызов раздела обёрнут в `try {} catch {}`, раздел 3 после
  него работает.
- Почему здесь: spec, «Риски»: «Сбой guard открывает проход», страховка — `land`; лимит hook-а — 30 s, раздел 3 после
  него берёт до 2 × 10 s.
- Без него: зависший git держал бы каждый Edit до лимита hook-а (test «a git that does not answer the trail read within
  the budget» шёл 20 s и краснел до правки); непрочитанный профиль отказывал бы всем правкам путей проверок.
- Требование: [Готово, когда, п. 1](../issues/03-guard-путь-проверки-только-по-trail-у.md#готово-когда)
- Риски и пробелы test-ов: исключение внутри раздела проверено одним входом (replace_all, результат которого длиннее
  предельной строки node); мутант «исключение → отказ» краснеет. Медленный git проверен только на POSIX (shell-скрипт не запускается как программа на Windows).

## 7. Silent mode: правка trail-а в папке Ticket-ов

Code: `harness/hooks/guard.mjs:1396-1416` · key lines: 1403, 1407, 1408

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
            (afterTrail === undefined ? " Edit the other sections of the ticket with an edit whose old and new text the guard can read (a file edit, not a shell command)." : ""),
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

## 8. `ticket mark` и `profile-set`

Code: `harness/hooks/guard.mjs:1202-1214` · key lines: 1206, 1207, 1208

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
  `--reset` полей `verification`, `verification.*`, `workflow`, `workflow.ci_check`, `workflow.pipeline`,
  `workflow.merge` (и Pipeline без `--field`) отказан любой Session агента. heredoc, где в тексте есть `ticket mark`,
  проходит: тело heredoc-а — данные.
- Почему здесь: Ticket: «Тот же раздел отказывает…»; поля меняет владелец формой Edit profile или в терминале.
- Без него: Subagent мог бы сам поставить себе `review success`, а агент — выключить условие merge (tests «ticket mark
  from a subagent», «profile-set --field workflow.merge», «--field workflow» красные на мутантах).
- Требование: [Готово, когда, п. 4](../issues/03-guard-путь-проверки-только-по-trail-у.md#готово-когда)
- Риски и пробелы test-ов: имя программы — по basename (`ticket`, `profile-set`, через `node <path>`); копия скрипта под
  другим именем не узнаётся.

## 9. Один `deny()` и строка в `WORFY_GUARD_LOG`

Code: `harness/hooks/guard.mjs:94-114` · key lines: 99, 100, 101, 102, 103

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
- Почему здесь: Ticket: «Один helper отказа `deny()` в guard.mjs»; переменную задаёт и строку читает Ticket 10 (Journal
  и Run history).
- Без него: Ticket 10 не узнал бы, какое правило отказало (tests «WORFY_GUARD_LOG» красные).
- Требование: [Готово, когда, п. 5](../issues/03-guard-путь-проверки-только-по-trail-у.md#готово-когда)
- Риски и пробелы test-ов: `ticket` в строке — только когда раздел 4 читал trail; у остальных правил `null`.

## 10. Копия или перенос в папку

Code: `harness/hooks/guard.mjs:1149-1164` · key lines: 1154, 1158, 1160, 1162

```js
            // a folder copy (cp -r, -R, -a), a move and rsync may write a whole folder where a source lands
            const recursive = prog === "mv" || prog === "rsync" || (prog === "cp" && args.some((a) => /^-[a-zA-Z]*[rRa]/.test(a) || a === "--recursive" || a === "--archive"))
            // -T (--no-target-directory) makes the destination the name itself; rsync's -T is its temporary folder
            const noTarget = prog !== "rsync" && args.some((a) => /^-[a-zA-Z]*T/.test(a) || a === "--no-target-directory")
            // a destination that ends in "/" or is a folder now: each source lands in it under its own name
            const intoFolder = !noTarget && (into !== null || /[\\/]$/.test(dest) || isFolder(dest))
            const base = dest.replace(/[\\/]+$/, "")
            for (const s of sources.length ? sources : [""]) {
                // rsync's "src/" copies the folder's contents: they land in the destination itself
                const contents = prog === "rsync" && /[\\/]$/.test(s)
                const name = path.basename(s.replace(/[\\/]+$/, ""))
                const lands = intoFolder && !contents && name ? `${base}/${name}` : dest
                // a source that is a file writes one file; a folder, or one that does not exist yet, may write a whole folder
                add(lands, recursive && !isFile(s), symlink)
            }
            if (prog === "mv") sources.forEach((s) => add(s, true))
```

- Что делает: цель, которая кончается на `/` или уже есть как папка, получает каждый источник под его именем
  (`mv notes.md tools/` пишет `tools/notes.md`); `-T` и `rsync src/` пишут саму цель. Запись всей папки (проверка «папка
  над путём проверки») — только для источника, который не файл: папка или то, чего ещё нет.
- Почему здесь: review round 2: правило round 1 считало любой перенос в `.github/` или `tools/` записью всей папки и
  отказывало `mv CODEOWNERS .github/`, хотя `cp` того же файла проходил.
- Без него: ложный отказ на перенос файла в папку над путём проверки (test-ы «mv of a file into tools/», «mv CODEOWNERS
  .github/» красные на коммите 129ab4b18); без проверки источника-папки `cp -RT tmpl .github` и `mv tmpl/workflows .github/`
  проходили бы (мутанты «цель-папка не распознана», «`-T` не читается», «rsync `src/` не читается» краснят test).
- Требование: [Готово, когда, п. 1](../issues/03-guard-путь-проверки-только-по-trail-у.md#готово-когда)
- Риски и пробелы test-ов: папка или файл решаются по состоянию на момент вызова; команда, которая сначала создаёт
  папку цели и потом копирует в неё в той же строке, читается по старому состоянию. Glob в источнике (`cp -r tmpl/* .github/`)
  не раскрывается — это закрывает `land`.

## 11. Rebase, остановленный на конфликте

Code: `harness/hooks/guard.mjs:1297-1313` · key lines: 1299, 1308, 1310

```js
// The branch a rebase in progress in the work tree of `dir` is rebasing, or null.
function rebasedBranch(dir) {
    const r = spawnSync(GIT, ["-C", dir, "rev-parse", "--git-path", "rebase-merge/head-name", "--git-path", "rebase-apply/head-name"], {
        encoding: "utf8",
        timeout: section4Left(),
        windowsHide: true,
    })
    if (r.status !== 0) return null
    for (const file of r.stdout.split("\n").map((l) => l.trim()).filter(Boolean)) {
        let name = ""
        try {
            name = fs.readFileSync(path.resolve(dir, file), "utf8").trim()
        } catch {}
        if (name.startsWith("refs/heads/")) return name.slice("refs/heads/".length)
    }
    return null
}
```

- Что делает: на detached HEAD guard читает имя ветки, которую двигает rebase (`rebase-merge/head-name` или
  `rebase-apply/head-name`), и решает по trail-у этой ветки; detached HEAD без rebase остаётся деревом reviewer-а.
- Почему здесь: review round 2: skill `epic-wave` велит implementer-у делать rebase при конфликте, и на время rebase HEAD
  detached — правило round 1 отказывало ему с текстом для reviewer-а.
- Без него: Edit пути из trail-а во время rebase отказан «Mutate a copy outside the repository» (test «a rebase in
  progress: a verification path the trail names» красный, мутант «rebase не читается» — 3 FAIL).
- Требование: [Готово, когда, п. 2](../issues/03-guard-путь-проверки-только-по-trail-у.md#готово-когда)
- Риски и пробелы test-ов: имя читается только из `refs/heads/…`; rebase, начатый на detached HEAD (в `head-name`
  тогда `detached HEAD`), остаётся деревом reviewer-а. Rebase через `rebase-apply` test не проверяет.

## 12. Как проверено

`bash harness/hooks/tests/guard-verification.test.sh` — exit 0 (124 проверки; на старом guard-е — 57 FAIL из 85, test-ы
review round 1 до правки — 14–15 FAIL, round 2 — 13 FAIL); копия Harness с мутантом — test красный для каждого нового правила и каждой
правки round 1 и round 2, включая «исключение → отказ» (test с replace_all, результат которого длиннее предельной строки node); `guard-silent.test.sh`, `rules-hooks.test.sh`,
`session-hooks.test.sh`, `harness-home.test.sh`, `plugin-neutral.test.sh`, `land-verification.test.sh` — exit 0;
`test/contract/harness-codex-hooks.test.ts`, `harness-guarantees.test.ts`, `harness-evals-run.test.ts`,
`test/unit/ticket-trail.test.ts`, `verification-paths.test.ts` — exit 0; `pnpm lint`, `pnpm typecheck` — exit 0.
Windows и Git Bash — только CI.

## Проверить себя

1. Почему trail читается на `origin/main`, а не на HEAD ветки дерева?
   - Ответ: trail на ветке пишет сам Subagent; прочитанный там, он разрешал бы путь, который Subagent себе дописал.
   - Строки: `harness/hooks/guard.mjs:1343-1356`
2. Что делает guard, когда git не ответил за бюджет раздела?
   - Ответ: пропускает вызов — сбой открывает проход, путь закрывает `land` при merge.
   - Строки: `harness/hooks/guard.mjs:1462-1465`
3. Почему Edit главного потока Session, запущенной с `--agent`, не отказан, хотя в нём есть `agent_type`?
   - Ответ: Subagent на Claude Code узнаётся по `agent_id`, который есть только внутри Subagent-а.
   - Строки: `harness/hooks/guard.mjs:125-129`
