# Code story — worfy-code-stories 07: Story Epic-а: последний PR Epic-а с кодом узнаётся до `land`, `story.md` едет в documents PR

Kind: pr · Epic: worfy-code-stories · Ticket: 07 · PR: - · Language: ru

## 1. Что было не так

Признака «в state-файле `land` лежит последний PR Epic-а с кодом» не было. `land` за один run вливает PR, сам создаёт
documents PR и сам его вливает, поэтому `Status: done` последнего Ticket-а появляется только внутри этого documents PR.
По строке `PR:` открытый Ticket с кодом не отличить от приёмки владельца. И у documents PR не было входа для лишнего
файла: только `prs[].evidence` и `prs[].verdict`.

- Требование: [Что происходит](../issues/07-story-epic-а-и-land.md#что-происходит)

## 2. Приёмка владельца — по строке `Who:` шапки

Code: `harness/bin/land:995-1006` · key lines: 1002, 1003

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

Code: `harness/bin/land:1041-1057` · key lines: 1048, 1050, 1051, 1054

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

Code: `harness/bin/land:1083-1101` · key lines: 1085, 1099

```js
            const step = appendReviewStep(st, p, tree, root)
            if (step) appended.push(step)
            for (const f of putFiles(st, p, tree, root, st.branch)) log(`${f} of #${n} written into the documents`)
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

## 5. Story ждёт остальные PR своего Epic-а

Code: `harness/bin/land:929-933` · key lines: 931, 932

```js
function putFiles(st, p, base, prefix, where) {
    if (!Array.isArray(p.files) || !p.files.length) return []
    const behind = st.prs.filter((x) => x !== p && x.epic === p.epic && !(x.result && x.result.status === "merged")).map((x) => `#${x.number}`)
    if (behind.length) throw new Wait(`the files of #${p.number} wait for ${behind.join(", ")} of epic ${p.epic}, not merged yet`)
    const written = []
```

- Что делает: пока другой PR того же Epic-а в state-файле не влит, файлы PR ждут: в Full режиме вместе с documents PR,
  в Silent — строкой `files of #N wait`. Следующий run `land` после merge того PR кладёт story вместе с обоими
  Ticket-ами.
- Почему здесь: ждущий PR не держит следующий (правило merge в комментарии `land`), поэтому без проверки story Epic-а
  легла бы на main раньше PR, о котором она рассказывает (находка 1 review, раунд 1).
- Без него: story описывала бы как влитой PR, которого на main нет, а после его merge путь был бы уже занят.
- Требование: [Что делаем, пункт 4](../issues/07-story-epic-а-и-land.md#что-делаем)
- Риски и пробелы test-ов: PR, который не вольётся никогда, держит documents PR своего Epic-а; тогда Orchestrator
  убирает запись из `files`. Test-ы — «an earlier PR waits» в Full и Silent режимах.

## 6. Story не перезаписывается и не пишется через symbolic link

Code: `harness/bin/land:937-965` · key lines: 947, 960, 964

```js
        let at = base
        for (const part of parts) {
            at = path.join(at, part)
            let info
            try {
                info = fs.lstatSync(at)
            } catch (e) {
                if (e.code === "ENOENT") break
                throw new Wait(`${f.path} of #${p.number}: ${parts.slice(0, parts.indexOf(part) + 1).join("/")} cannot be read (${e.code || e.message})`)
            }
            if (info.isSymbolicLink()) throw new Wait(`${f.path} of #${p.number}: ${path.relative(base, at).split(path.sep).join("/")} is a symbolic link, nothing is written through it`, "red")
        }
        let bytes
        try {
            bytes = fs.readFileSync(f.from)
        } catch (e) {
            throw new Wait(`the file ${f.path} of #${p.number} cannot be read: ${f.from} (${e.code || e.message})`)
        }
        if (fs.existsSync(target)) {
            let there = null
            try {
                there = fs.readFileSync(target)
            } catch {}
            if (there && there.equals(bytes)) {
                log(`${f.path} of #${p.number} is in ${where} already, the same bytes: not written again`)
                continue
            }
            throw new Wait(`${f.path} of #${p.number} differs from the one in ${where}: not overwritten (change it there by a PR of its own, or drop the entry from "files")`, "red")
        }
```

- Что делает: путь цели и каждая папка на нём проверяются через `lstat`: symbolic link — красный `Wait`, ничего не
  записано. Файл уже на месте: те же байты — пропуск со строкой в log, другие байты — красный `Wait`, файл не
  перезаписан.
- Почему здесь: файл мог положить прошлый documents PR (Full) или его правили в папке Workflow (Silent); якорь story —
  commit, который её добавил (`bin/TICKETS.md`, «Story anchor»).
- Без него: другая `story.md` на main молча осталась бы старой при зелёном `LAND`, правка в папке Workflow была бы
  затёрта, а через symbolic link запись ушла бы за пределы корня Ticket-ов.
- Требование: [Готово, когда](../issues/07-story-epic-а-и-land.md#готово-когда)
- Риски и пробелы test-ов: прерванный run в Full режиме сюда не доходит с готовым файлом: test убивает `land` до
  сохранения `d.pr`, и повторный run строит documents PR заново от main, где story ещё нет. Где система не создаёт
  symbolic link (Git Bash на Windows копирует цель), оба случая со ссылкой пропускаются: проверку `lstat` там не
  гоняет ни один test.

## 7. Silent: файл в папку Workflow, documents PR нет

Code: `harness/bin/land:974-986` · key lines: 977, 979, 982

```js
function filesOutside(st) {
    const lines = []
    let kind = null
    for (const p of st.prs.filter((x) => st.tickets_root === null && x.result && x.result.status === "merged" && Array.isArray(x.files) && x.files.length))
        try {
            for (const f of putFiles(st, p, ticketsFolder(st), "", "the tickets folder")) lines.push(`${f} of #${p.number} written into the tickets outside the repository`)
        } catch (e) {
            if (!(e instanceof Wait)) throw e
            kind = kind === "red" ? kind : e.kind
            lines.push(`files of #${p.number} wait: ${e.message}`)
        }
    return { lines, kind }
}
```

- Что делает: при `tickets_root` null для каждого влитого PR с `files` кладёт их по тем же правилам в папку, которую
  печатает `ticket root`, и печатает строку `<path> of #N written into the tickets outside the repository`. Если файл
  ждёт — строка `files of #N wait: <причина>`, и run не зелёный, а при красной причине красный.
- Почему здесь: в Silent режиме documents PR нет, `story.md` ложится в папку Workflow (пункт 5 «Что делаем»).
- Без него: в Silent режиме `files` молча терялся бы.
- Требование: [Что делаем, пункт 5](../issues/07-story-epic-а-и-land.md#что-делаем)
- Риски и пробелы test-ов: не записано

## 8. Что сознательно не меняли

- `epic-status` и его `--json` не тронуты: поле «кто делает» в JSON поменяло бы байты вывода для всех читателей,
  поэтому строку `Who:` читает `land`.
- Без нового поля documents PR тот же, байт в байт: test сверяет файл Ticket-а, сообщение commit-а, заголовок и текст PR.
- Toast «Story Epic-а готова» — Ticket 10; story по кнопке — Ticket 11.

## 9. Как проверено

- `bash harness/bin/tests/land-epic-story.test.sh` (HOME — временная папка) — exit 0, 32 проверки; восемь мутантов
  в отдельной копии `harness/` (слово `owner`, блоки кода, первый `## `, Silent-ожидание, ждущий PR, symbolic link,
  сравнение байтов, проверка «уже есть») — каждый роняет от 1 до 4 проверок.
- `land.test.sh`, `land-story.test.sh`, `story-check.test.sh`, `epic-status.test.sh`, `silent-mode.test.sh`,
  `epic-wave-ship-ticket.test.sh`, `agents-text.test.sh`, `plugin-neutral.test.sh` — exit 0 (в раунде 2 — `land`,
  `land-story`, `story-check`, `agents-text`, `plugin-neutral` снова).
- `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate fast — exit 0, `[gate] green (fast)`, в обоих раундах.
