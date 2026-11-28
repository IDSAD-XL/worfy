# Code story — worfy-harness-guarantees 04: `land`: пути проверок, draft, `land --check`

Kind: pr · Epic: worfy-harness-guarantees · Ticket: 04 · PR: - · Language: ru

## 1. Что было не так

`land` сливал PR по зелёному CI и отметкам и не смотрел, какие файлы PR правит: PR мог сделать `ci-ok` зелёным,
поменяв сам workflow или Quarantine. Draft с зелёным CI тоже сливался, а имя check-а CI приходило из state file.

- Требование: [Что происходит](../issues/04-land-пути-проверок-draft-land-check.md#что-происходит)

## 2. Draft не сливается

Code: `harness/bin/land:987-996` · key lines: 990, 992

```js
        } else {
            if (v.state !== "OPEN") throw new Wait(`the PR is ${v.state}`)
            // a draft is not for merging, whatever its CI and review say
            if (v.isDraft) throw new Wait("draft")
            const head = v.headRefOid
            note = ready(st, pr, head, true, v)
            sha = await mergeOne(st, pr.number, head, () => ready(st, pr, head, false, v))
            log(`#${pr.number}: merged at ${head} as ${sha}`)
        }
        pr.result = { status: "merged", sha, head: v.headRefOid, ...(note ? { verification: note } : {}), at: now() }
```

- Что делает: draft ждёт с причиной `draft` до любого другого условия; то же чтение под замком main branch в
  `mergeOne`. Записанная заметка о путях проверок (`note`) идёт в `prs[].result.verification` и в строку PR.
- Почему здесь: Ticket называет `PR_FIELDS` и `isDraft`; почему draft не сливается — «Что строить».
- Без него: draft с зелёным CI и `review` сливался (test «draft» красный на старом коде).
- Требование: [Готово, когда, п. 1](../issues/04-land-пути-проверок-draft-land-check.md#готово-когда)
- Риски и пробелы test-ов: PR, ставший draft-ом между двумя чтениями, ловит только чтение под замком; отдельного test-а
  на это нет.

## 3. Пути проверок против trail-а Ticket-а

Code: `harness/bin/land:867-892` · key lines: 868, 872, 876, 879, 881, 885

```js
function verified(st, pr, head, view) {
    const profile = profileOf(st)
    const list = verificationPaths(profile)
    if (!haveCommit(st, head, pr.number)) throw unread(`the head ${short(head)} is not in the checkout: its verification paths cannot be read`)
    const ref = `refs/remotes/${st.remote || "origin"}/${st.branch}`
    const base = git(["merge-base", head, ref], st.repo)
    const paths = changedPaths(st, base, head)
    // an absolute root: a relative one would resolve from the working directory (a realpath on macOS)
    const root = path.resolve(st.repo)
    const touched = paths.filter((p) => isVerificationPath(p, list, { root }))
    const notes = []
    if (touched.length) {
        const tickets = field(profile, "tickets") || {}
        const t = readTrail({ repo: st.repo, ref, branch: view && view.headRefName, tickets, git: GIT, folder: ticketsRoot(st) ? null : ticketsFolder(st) })
        if (t.unread) throw unread(`the trail of the PR's ticket could not be read: ${t.reason}`)
        if (!t.ticket) throw new Wait(`verification paths, and the PR has no ticket (${t.reason}): ${touched.join(", ")} — the owner decides`)
        const name = `${t.ticket.epic} ${t.ticket.nn}`
        if (!t.trail) throw new Wait(`verification paths outside the trail of ${name} (${t.reason}): ${touched.join(", ")}`)
        const outside = touched.filter((p) => !namedByTrail(p, t.trail, { root }))
        if (outside.length) throw new Wait(`verification paths outside the trail of ${name}: ${outside.join(", ")}`)
        notes.push(`${touched.join(", ")} (trail of ${name})`)
    }
    for (const e of trailExtensions(st, profile, list, paths, base, head, root)) notes.push(`added to the trail of ${e.file}: ${e.paths.join(", ")}`)
    if (notes.length) log(`#${pr.number}: verification paths: ${notes.join("; ")}`)
    return notes.length ? `verification paths: ${notes.join("; ")}` : null
}
```

- Что делает: берёт список из Profile-а (никогда из state file), пути diff-а от merge-base, Ticket по ветке PR и его
  trail на вершине base branch (`ref`), а не на merge-base; путь вне trail-а — ждёт, PR без Ticket-а — ждёт владельца.
- Почему здесь: Ticket называет шаг `verified(st, pr, head)` в `ready()` и чтение trail-а на вершине base branch
  (решение владельца по возражению 2 critic-а).
- Без него: PR правил бы workflow CI или Quarantine без разрешения trail-а; при чтении на merge-base ветка, старше
  documents PR-а с расширением trail-а, ждала бы rebase.
- Требование: [Готово, когда, п. 2](../issues/04-land-пути-проверок-draft-land-check.md#готово-когда)
- Риски и пробелы test-ов: `root` абсолютный (`path.resolve`), иначе путь через symlink на macOS считался бы вне
  репозитория. Silent mode (trail из папки Ticket-ов) проверен только unit test-ом helper-а.

## 4. PR, который расширяет trail

Code: `harness/bin/land:852-860` · key lines: 855, 856

```js
    const out = []
    for (const file of paths) {
        if (!file.startsWith(`${tickets}/`) || !/\.md$/i.test(file)) continue
        const before = at(base, file)
        const added = at(head, file).filter((g) => !before.includes(g) && isVerificationPath(g, list, { root }))
        if (added.length) out.push({ file, paths: added })
    }
    return out
}
```

- Что делает: для каждого файла Ticket-а под `tickets.root`, который правит PR, сравнивает trail на head и на
  merge-base и называет добавленные записи, которые сами — пути проверок.
- Почему здесь: Ticket требует, чтобы строка `land` называла такой PR; отметку `owner` для него ставит Ticket 10
  (возражение 1 critic-а).
- Без него: расширение trail-а на `.github/workflows/ci.yml` прошло бы молча, и владелец не знал бы, куда смотреть.
- Требование: [Готово, когда, п. 3](../issues/04-land-пути-проверок-draft-land-check.md#готово-когда)
- Риски и пробелы test-ов: запись шире пути проверки (`.github/`) не называется — отмечено `shortcut:` в коде.

## 5. Имя check-а CI — из Profile-а

Code: `harness/bin/land:1429-1442` · key lines: 1437, 1439

```js
function ciCheckAgrees(file, st) {
    let profile
    try {
        profile = profileOf(st)
    } catch (e) {
        if (!(e instanceof Wait)) throw e
        return // every PR waits on the same reason in verified()
    }
    const named = field(profile, "workflow", "ci_check")
    if (typeof named === "string" && named.trim() !== "") {
        if (named !== st.ci_check)
            fail(`${file}: "ci_check" is ${JSON.stringify(st.ci_check)}, but the profile's workflow.ci_check is ${JSON.stringify(named)}: land merges on the check the profile names`)
    } else log(`the profile names no workflow.ci_check: the state file's ${st.ci_check} is the merge condition`)
}
```

- Что делает: state file с `ci_check`, отличным от `workflow.ci_check`, — отказ с обоими именами; без поля в
  Profile-е остаётся имя state file-а и строка в log.
- Почему здесь: Ticket: «Имя check-а CI — из `workflow.ci_check` Profile-а; state file с другим `ci_check` `land`
  отказывает». Почему без поля — не отказ: у worfy поля пока нет (команда владельцу из Ticket-а 02 не выполнена).
- Без него: Orchestrator мог бы назвать в state file check, который всегда зелёный.
- Требование: [Готово, когда, п. 4](../issues/04-land-пути-проверок-draft-land-check.md#готово-когда)
- Риски и пробелы test-ов: случай «в Profile-е нет `workflow.ci_check`» test-ом не покрыт.

## 6. `land --check <N>`: ответ за один PR

Code: `harness/bin/land:1502-1515` · key lines: 1503, 1508, 1512, 1514

```js
        const v = prView(st, Number(n))
        if (v.state !== "OPEN") return say(1, `waits: the PR is ${v.state}`)
        if (v.isDraft) return say(1, "waits: draft")
        const head = v.headRefOid
        const ticket = ticketOfBranch(v.headRefName, field(profile, "tickets", "branch"))
        const pr = { number: Number(n), checks, ...(ticket ? { epic: ticket.epic, ticket: ticket.nn } : {}) }
        st.ci_workflow = ciWorkflowOf(st, head)
        const note = ready(st, pr, head, false, v)
        if (v.mergeable === "CONFLICTING" || v.mergeStateStatus === "DIRTY") return say(1, `waits: conflict: rebase (mergeable ${v.mergeable}, mergeStateStatus ${v.mergeStateStatus})`)
        return say(0, `ready${note ? ` — ${note}` : ""}`)
    } catch (e) {
        if (!(e instanceof Wait)) throw e
        return e.unread ? say(2, `unverified: ${firstLine(e.message)}`) : say(1, `waits: ${firstLine(e.message)}`)
    }
```

- Что делает: собирает условие из Profile-а (ветка, check CI, Check-и Pipeline-а), читает то же, что проход `land`,
  и отвечает одной строкой: exit 0 — готов, 1 — ждёт, 2 — нет ответа `gh`, git или Profile-а (`unread`).
- Почему здесь: Ticket называет новый режим и коды выхода; guard Ticket-а 05 зовёт его перед `gh pr merge`.
- Без него: guard не мог бы спросить условие merge без state file.
- Требование: [Готово, когда, п. 5](../issues/04-land-пути-проверок-draft-land-check.md#готово-когда)
- Риски и пробелы test-ов: workflow CI выводится из `details_url` check-а — форма URL GitHub на настоящем API не
  проверена; время ответа с настоящим `gh` не мерилось (311 ms со stand-in).

## 7. Один helper trail-а для `land` и guard-а

Code: `harness/lib/ticket-trail.cjs:140-158` · key lines: 141, 145, 151, 156

```js
    // the names are relative; the root is absolute, so the match never depends on the working directory
    const hits = names.filter((n) => isVerificationPath(n, [pattern], { root: path.resolve(folder || repo) }))
    const where = folder ? "the tickets folder" : ref
    // the branch names a ticket, but its file cannot be told: the ticket is known, its trail is not
    const none = { ...ticket, path: null }
    if (!hits.length) return { ticket: none, trail: null, reason: `${pattern} is not in ${where}` }
    if (hits.length > 1) return { ticket: none, trail: null, reason: `${hits.length} files in ${where}: ${hits.join(", ")}` }
    const file = hits[0]
    let text
    if (folder) text = fs.readFileSync(path.join(folder, file), "utf8")
    else {
        const show = spawnSync(git, ["show", `${ref}:${file}`], { cwd: repo, encoding: "utf8", windowsHide: true, maxBuffer: 64 << 20 })
        if (show.error || show.status !== 0) return { ticket: { ...ticket, path: file }, trail: null, reason: `git show ${ref}:${file} could not be read`, unread: true }
        text = show.stdout
    }
    const found = { ...ticket, path: file }
    if (!t.trail_section) return { ticket: found, trail: null, reason: "the profile has no tickets.trail_section" }
    const trail = trailPaths(text, t.trail_section)
    return trail ? { ticket: found, trail, reason: null } : { ticket: found, trail: null, reason: `${file} has no section ${JSON.stringify(t.trail_section)}` }
```

- Что делает: находит файл Ticket-а по `tickets.path` на `ref`, читает его через `git show <ref>:<путь>`, не из
  working tree, и отдаёт trail или причину, почему его нет.
- Почему здесь: Ticket: helper в `harness/lib/`, guard Ticket-а 03 читает trail тем же кодом.
- Без него: guard и `land` читали бы trail разным кодом и могли бы разойтись.
- Требование: [Готово, когда, п. 6](../issues/04-land-пути-проверок-draft-land-check.md#готово-когда)
- Риски и пробелы test-ов: записи trail-а проекта с несколькими репозиториями сравниваются как написаны — `shortcut:`.

## 8. Как проверено

`bash harness/bin/tests/land-verification.test.sh` — exit 0 (19 проверок; на старом `land` — 16 FAIL);
`land.test.sh`, `land-story.test.sh`, `land-epic-story.test.sh` — exit 0; `test/unit/ticket-trail.test.ts` —
exit 0; `pnpm lint`, `pnpm typecheck` — exit 0.

## Проверить себя

1. Почему PR, который сам дописал `.github/workflows/ci.yml` в свой trail, всё равно ждёт?
   - Ответ: trail читается на вершине base branch (`ref`), а правки самого PR-а там нет.
   - Строки: `harness/bin/land:871-880`
2. Чем `land --check` отличает «ждёт» от «не может сказать»?
   - Ответ: Wait с флагом `unread` (сбой `gh`, git или Profile-а) даёт exit 2, любой другой Wait — exit 1.
   - Строки: `harness/bin/land:1514`
