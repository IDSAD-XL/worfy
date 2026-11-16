# Code story — worfy-code-stories 07: Story Epic-а: последний PR Epic-а с кодом узнаётся до `land`, `story.md` едет в documents PR

Kind: pr · Epic: worfy-code-stories · Ticket: 07 · PR: - · Language: ru

## 1. Что было не так

Признака «в state-файле `land` лежит последний PR Epic-а с кодом» не было. `land` за один run вливает PR, сам создаёт
documents PR и сам его вливает, поэтому `Status: done` последнего Ticket-а появляется только внутри этого documents PR.
По строке `PR:` открытый Ticket с кодом не отличить от приёмки владельца. И у documents PR не было входа для лишнего
файла: только `prs[].evidence` и `prs[].verdict`.

- Требование: [Что происходит](../issues/07-story-epic-а-и-land.md#что-происходит)

## 2. Приёмка владельца — по строке `Who:` шапки

Code: `harness/bin/land:966-977` · key lines: 973, 974

```js
function ownerTicket(text) {
    const isCode = codeFence()
    let status = false
    for (const line of text.split("\n").map((l) => l.replace(/\r$/, ""))) {
        if (isCode(line)) continue
        if (status && line.startsWith("## ")) break
        if (/^Status:/.test(line)) status = true
        const m = /^([^\s:]+):[ \t]*(.*)$/.exec(line)
        if (m && WHO_KEYS.includes(m[1])) return OWNER_WORDS.some((w) => m[2].startsWith(w) && !/[\p{L}\p{N}]/u.test(m[2].charAt(w.length)))
    }
    return false
}
```

- Что делает: читает шапку Ticket-а до первого заголовка `## ` после строки Status, блоки кода пропускает тем же
  правилом `lib/code-fence.cjs`, что `bin/ticket` и `epic-status`. Ticket не с кодом, когда первая строка `Who:`
  (по-русски `Кто:`, слова в `lib/input-words.json`) начинается со слова `owner` (`владелец`): `Кто: владелец, с
  Orchestrator-ом.` — приёмка, `Кто: агент.` и Ticket без такой строки — с кодом. Правило записано в
  `harness/bin/TICKETS.md`, раздел **Ticket with code**.
- Почему здесь: Ticket требует правило по шапке, а приёмку владельца — не в счёт (пункт 1 «Что делаем»); в этом Epic-е
  так помечен Ticket 17 (`Кто: владелец, с Orchestrator-ом.`).
- Без него: открытая приёмка владельца держала бы триггер навсегда, и story Epic-а не собиралась бы никогда.
- Требование: [Что делаем, пункт 1](../issues/07-story-epic-а-и-land.md#что-делаем)
- Риски и пробелы test-ов: других признаков «без кода» правило не знает. Ticket-ы вида замера, где итог — решение, а
  не код (здесь Ticket 16, `Кто: агент.`), считаются Ticket-ами с кодом; тогда триггер ждёт и их.

## 3. Триггер: `land --epic-story` до merge

Code: `harness/bin/land:1012-1028` · key lines: 1019, 1021, 1022, 1025

```js
function epicStory(st) {
    if (ticketsRoot(st)) git(["fetch", "-q", st.remote || "origin", `+refs/heads/${st.branch}:refs/remotes/${st.remote || "origin"}/${st.branch}`], st.repo)
    const two = (n) => String(n).padStart(2, "0")
    const withTicket = st.prs.filter((p) => p.epic && p.ticket)
    if (!withTicket.length) return ["epic story: no PR of the state file has a ticket"]
    const lines = []
    for (const epic of [...new Set(withTicket.map((p) => p.epic))]) {
        const open = openCodeTickets(st, epic)
        const ours = withTicket.filter((p) => p.epic === epic)
        const others = open.filter((n) => !ours.some((p) => Number(p.ticket) === n))
        const last = ours.filter((p) => open.includes(Number(p.ticket))).pop()
        if (others.length) lines.push(`epic story of ${epic} is not due: tickets with code still open: ${others.map(two).join(", ")}`)
        else if (!last) lines.push(`epic story of ${epic} is not due: no PR of the state file is an open ticket with code`)
        else lines.push(`epic story of ${epic} is due: #${last.number} (${epic} ${last.ticket}) is its last PR with code`)
    }
    return lines
}
```

- Что делает: новый режим `land <state> --epic-story` ничего не вливает, не зовёт `gh` и ничего не пишет. После fetch-а
  читает Ticket-ы каждого Epic-а state-файла на `<remote>/<branch>` (статус — через `epic-status --json`, единственного
  читателя строк Status) и печатает одну строку: `is due: #N (<epic> NN)`, когда все незакрытые Ticket-ы с кодом
  стоят в state-файле, N — последний из них по порядку merge; иначе `is not due` с номерами открытых.
- Почему здесь: по Ticket-у триггер берётся из state-файла `land`, и Orchestrator видит его до вызова `land` (пункт 2
  «Что делаем»). Режим `land` уже знает repo, remote, ветку и корень Ticket-ов этого state-файла.
- Без него: Orchestrator узнавал бы о последнем PR только после `land`, а documents PR к тому времени уже влит без
  `story.md`.
- Требование: [Что делаем, пункт 2](../issues/07-story-epic-а-и-land.md#что-делаем)
- Риски и пробелы test-ов: Ticket-ы читаются на ветке origin, не в рабочем дереве checkout-а; test-ы это проверяют.
  В Silent режиме — папка `ticket root`. Ticket со старой шапкой (`epic-status` не дал ему статус) считается открытым.

## 4. Лишний файл ложится в documents PR до `evidence-check`

Code: `harness/bin/land:1054-1072` · key lines: 1056, 1070

```js
            const step = appendReviewStep(st, p, tree, root)
            if (step) appended.push(step)
            for (const f of putFiles(p, path.join(tree, root), st.branch)) log(`${f} of #${n} written into the documents`)
        }
        if (st.docs_check) {
            const r = sh(st.docs_check, tree)
            log(`${st.docs_check} — exit ${r.code}`)
            if (r.code !== 0) throw new Wait(`${st.docs_check} exited ${r.code}: ${firstLine(r.err || r.out)}`, "red")
        }
        git(["add", "-A"], tree)
        if (run([GIT, []], ["diff", "--cached", "--quiet"], tree).code === 0) {
            d.result = { status: "empty", at: now() }
            log(`documents of ${d.prs.map((n) => "#" + n).join(", ")}: nothing to commit`)
            return
        }
        // the privacy check of what this commit adds to the tickets root, before anything leaves the machine
        const ecArgs = ["--changed", "--root", path.join(tree, root), "--base", `refs/remotes/${remote}/${st.branch}`]
        const ec = run(program(process.env.LAND_EVIDENCE_CHECK, [process.execPath, [path.join(__dirname, "evidence-check")]]), ecArgs, tree)
        log(`evidence-check ${ecArgs.join(" ")} — exit ${ec.code}`)
```

- Что делает: после `ticket done` и шага review каждого PR кладёт его `prs[].files` (`{path, from}`: путь в корне
  Ticket-ов и абсолютный путь готового файла) в дерево documents PR. Дальше — тот же путь, что у Evidence-строк:
  `docs_check`, `git add -A`, `evidence-check --changed`; красный — documents PR ждёт красным, ничего не закоммичено и
  не отправлено.
- Почему здесь: Ticket требует класть файл в тот же documents PR до `evidence-check`, чтобы `story.md` прошла privacy
  check публичного репозитория (пункт 4 «Что делаем»).
- Без него: у documents PR не было бы входа для `story.md`, и story Epic-а не попала бы рядом с `Status: done`
  последнего Ticket-а.
- Требование: [Что делаем, пункт 4](../issues/07-story-epic-а-и-land.md#что-делаем)
- Риски и пробелы test-ов: `load` проверяет форму поля (путь внутри корня, без `..`, `from` абсолютный). `story-check`
  на самой story Epic-а `land` не запускает: ему нужен `--pr-head` каждой главы, а их знает агент; это шаг агента в
  skill `epic-wave`.

## 5. Второй раз файл не кладётся

Code: `harness/bin/land:923-942` · key lines: 927, 928, 935

```js
function putFiles(p, dir, where) {
    const written = []
    for (const f of p.files || []) {
        const target = path.join(dir, ...f.path.split("/"))
        if (fs.existsSync(target)) {
            log(`${f.path} of #${p.number} is in ${where} already, not written again`)
            continue
        }
        let bytes
        try {
            bytes = fs.readFileSync(f.from)
        } catch (e) {
            throw new Wait(`the file ${f.path} of #${p.number} cannot be read: ${f.from} (${e.code || e.message})`)
        }
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fs.writeFileSync(target, bytes)
        written.push(f.path)
    }
    return written
}
```

- Что делает: копирует каждый файл; путь, который уже есть (на main или в папке Workflow), не пишет и говорит об этом
  в log. Нечитаемый готовый файл — `Wait`: documents PR ждёт, ничего не отправлено.
- Почему здесь: прерванный run, запущенный снова на том же state-файле, не должен класть `story.md` второй раз (пункт
  «Готово, когда»); якорь story Epic-а — commit, который её добавил (`bin/TICKETS.md`, «Story anchor»).
- Без него: повторный run затирал бы story, уже влитую в main, а в Silent режиме — правку в папке Workflow.
- Требование: [Готово, когда](../issues/07-story-epic-а-и-land.md#готово-когда)
- Риски и пробелы test-ов: test прерывает run сразу после merge documents PR и запускает снова — один documents PR,
  один commit, добавивший `story.md`. Новую версию story поверх старой этот путь не кладёт: такую правку нужно
  делать отдельным PR.

## 6. Silent: файл в папку Workflow, documents PR нет

Code: `harness/bin/land:945-957` · key lines: 948, 950

```js
function filesOutside(st) {
    const lines = []
    let waits = false
    for (const p of st.prs.filter((x) => st.tickets_root === null && x.result && x.result.status === "merged" && Array.isArray(x.files) && x.files.length))
        try {
            for (const f of putFiles(p, ticketsFolder(st), "the tickets folder")) lines.push(`${f} of #${p.number} written into the tickets outside the repository`)
        } catch (e) {
            if (!(e instanceof Wait)) throw e
            waits = true
            lines.push(`files of #${p.number} wait: ${e.message}`)
        }
    return { lines, waits }
}
```

- Что делает: при `tickets_root` null для каждого влитого PR с `files` кладёт их в папку, которую печатает `ticket
  root`, и печатает строку `<path> of #N written into the tickets outside the repository`; ошибка — строка `files of
  #N wait` и run не зелёный.
- Почему здесь: в Silent режиме documents PR нет, `story.md` ложится в папку Workflow (пункт 5 «Что делаем»).
- Без него: в Silent режиме `files` молча терялся бы.
- Требование: [Что делаем, пункт 5](../issues/07-story-epic-а-и-land.md#что-делаем)
- Риски и пробелы test-ов: не записано

## 7. Что сознательно не меняли

- `epic-status` и его `--json` не тронуты: поле «кто делает» в JSON поменяло бы байты вывода для всех читателей,
  поэтому строку `Who:` читает `land`.
- Без нового поля documents PR тот же, байт в байт: test сверяет файл Ticket-а, сообщение commit-а, заголовок и текст PR.
- Toast «Story Epic-а готова» — Ticket 10; story по кнопке — Ticket 11.

## 8. Как проверено

- `bash harness/bin/tests/land-epic-story.test.sh` (HOME — временная папка) — exit 0, 20 проверок; три мутанта
  (правило `Who`, проверка «уже есть», вызов в documents PR) роняют 4, 2 и 6 проверок.
- `land.test.sh`, `land-story.test.sh`, `story-check.test.sh`, `epic-status.test.sh`, `silent-mode.test.sh`,
  `epic-wave-ship-ticket.test.sh`, `agents-text.test.sh`, `plugin-neutral.test.sh` — exit 0.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate fast — exit 0, `[gate] green (fast)`.
