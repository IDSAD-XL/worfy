# Code story — worfy-acceptance 04: Skill Harness `owner-check`: строка `owner-check` через `ticket evidence`, Pass отмечает пункт, Fail заводит доработку

Kind: pr · Epic: worfy-acceptance · Ticket: 04 · PR: - · Language: ru

## 1. Что было не так

Строку `owner-check` Orchestrator писал руками по шагу 6 skill-а `ship-ticket`. Skill-а, который принимает решение
владельца в одной форме, не было: worfy-шаблону `ownerCheck` (Ticket 03) нечего вызывать. Этот PR даёт skill
`harness/skills/owner-check/SKILL.md`: проверка, что пункт ручной, одна строка на решение через `ticket evidence`,
`[x]` на Pass, Ticket доработки на Fail, privacy check слов владельца.

- Требование: [Что происходит](../issues/04-skill-harness-owner-check.md#что-происходит)

## 2. Сначала пункт: ручной пункт этого Ticket-а, иначе отказ до любой записи

Code: `harness/skills/owner-check/SKILL.md:104-113` · key lines: 107, 110, 113

```js
const itemOf = (e, n, k) => {
    const file = ticketFile(e, n)
    if (!file) return { why: `no single ticket ${n} in epic ${e}` }
    const items = parseDoneSection(fs.readFileSync(file, "utf8"), opts)
    const it = items.find((x) => x.index === k)
    if (!it) return { why: `${e} ${n} has no item ${k}: its "done" section has ${items.length} checkbox item(s)` }
    if (!it.manual) return { why: `item ${k} of ${e} ${n} is not a manual item: an owner check proves only a manual item` }
    return { file, it }
}
const first = itemOf(epic, nn, Number(itemArg))
```

- Что делает: читает раздел «done» тем же разбором `parseDoneSection` и с теми же `done_section` и `manual_mark` Profile-а,
  что `ticket evidence`; пункт, которого нет или который не ручной, — `refused:` и exit 1, раньше любой записи.
- Почему здесь: Ticket, «Что делаем», пункт 2, требует отказ с причиной. Матрица `ticket evidence <epic> <NN>` не печатает,
  ручной ли пункт, поэтому проверка берёт её парсер, а не её вывод.
- Без него: строка `owner-check` легла бы под автоматический пункт, где она ничего не доказывает и путает матрицу.
- Требование: [Что делаем, пункт 2](../issues/04-skill-harness-owner-check.md#что-делаем)
- Риски и пробелы test-ов: пока `worfy-polish` 132 не влит, пункт с меткой `(manual)` в Project-е с меткой `вручную` не
  считается ручным — skill откажет ему так же, как `ticket evidence` не считает его ручным.

## 3. Одна строка на решение, через `ticket evidence`

Code: `harness/skills/owner-check/SKILL.md:137-148` · key lines: 140, 143, 144

```js
    done.add(key)
    const { file, it, why } = itemOf(e, n, k)
    if (why) return console.log(`note: not recorded: ${why}`)
    if (it.evidence.some((x) => x.kind === "owner-check" && x.verdict === verdict && x.ref === lineRef && x.platform === platform && x.copy === copy))
        console.log(`already recorded: ${e} ${n} item ${k}, owner-check ${verdict}, nothing added`)
    else {
        const args = ["evidence", e, n, String(k), "owner-check", verdict, "--ref", lineRef, "--platform", platform, "--copy", copy]
        if (sha !== "-") args.push("--sha", sha)
        try { process.stdout.write(script("ticket", args)) } catch (err) {
            process.stdout.write(String(err.stdout || "")); process.stderr.write(String(err.stderr || "")); process.exit(err.status || 1)
        }
    }
```

- Что делает: та же строка (вердикт, ref, платформа, копия) уже есть — `already recorded`, ничего не пишется; иначе
  строку пишет `ticket evidence`, и при `sha` = `-` флаг `--sha` не передаётся, `ticket` берёт `HEAD`.
- Почему здесь: Ticket, «Что делаем», пункт 3. Сам `ticket evidence` повторы не отсекает. `sha` в сравнение не входит:
  при `-` он равен `HEAD`, а `HEAD` между двумя Send again может сдвинуться.
- Без него: повторное Send again добавило бы вторую строку; при `sha` = `-` строку отверг бы `ticket` (`sha is 7 to 40 hex digits`).
- Требование: [Что делаем, пункт 3](../issues/04-skill-harness-owner-check.md#что-делаем)
- Риски и пробелы test-ов: решение с теми же словами в тот же день, но на другом commit-е, считается повтором — так задумано.

## 4. Слова владельца — текстом, без личных данных

Code: `harness/skills/owner-check/SKILL.md:116-131` · key lines: 117, 121, 125, 129

```js
let words = wordsFile === "-" ? "" : fs.readFileSync(wordsFile, "utf8")
words = words.split(/\r?\n/).map((l) => l.replace(/^\s*>\s?/, "")).join(" ").replace(/·/g, "-").replace(/\s+/g, " ").trim()
const STAND_IN = { "home-path": "<home>", host: "<host>", "tailscale-ip": "<ip>", uuid: "<uuid>", email: "<email>", token: "<token>", deny: "<private>" }
const privacyOptions = { hostname: os.hostname(), deny: privacy.personal(harnessHome()).deny }
const replaced = []
for (const f of privacy.findings(words, privacyOptions).reverse()) {
    let start = f.index
    // A home folder path goes whole up to the user name: the root, the home folder and the name become <home>.
    if (f.rule === "home-path") while (start > 0 && !/[\s"`(<]/.test(words[start - 1])) start--
    words = words.slice(0, start) + (STAND_IN[f.rule] || "<private>") + words.slice(f.index + f.length)
    replaced.push(f.rule)
}
const left = privacy.findings(words, privacyOptions)
if (left.length) stop(`the owner words still hold personal data after the stand-ins (${left.map((f) => f.rule).join(", ")}): rewrite them`)
if (replaced.length) console.log(`owner words: replaced by a stand-in: ${[...new Set(replaced)].join(", ")}`)
const ref = `${date}: ${words || `${verdict}, no words`}`
```

- Что делает: слова приходят файлом (skill велит записать цитату Write-ом), склеиваются в одну строку без ` · `; правила
  `harness/lib/privacy.cjs` — те же, что у `evidence-check`, — находят путь с именем, хост, email и прочее, и найденное
  заменяется на `<home>`, `<host>`, `<email>`…; skill говорит владельцу, какие виды заменены, без значений.
- Почему здесь: Ticket, «Что делаем», пункт 5, и spec, «Риски» → «Слова владельца в публичном репозитории».
  Слова не идут в shell-команду: backtick или `$(` в них выполнились бы.
- Без него: слова с путём или email застряли бы на `evidence-check --changed` перед push documents PR (или ушли бы в
  публичный репозиторий, будь push руками без проверки).
- Требование: [Что делаем, пункт 5](../issues/04-skill-harness-owner-check.md#что-делаем)
- Риски и пробелы test-ов: test проверяет `home-path` и `email`; остальные правила — те же функции `privacy.cjs`, их
  проверяет `evidence-check.test.sh`.

## 5. Fail заводит Ticket доработки; Pass на нём закрывает исходный пункт

Code: `harness/skills/owner-check/SKILL.md:169-189` · key lines: 173, 175, 177, 183, 188

```js
if (verdict === "fail") {
    // The rework ticket: same epic, next free number, no blockers, the same manual item with its needs line.
    const dir = issues(epic)
    const nnPad = String(Number(nn)).padStart(2, "0")
    const source = `Source: owner-check fail ${date} of ${epic} ${nnPad}, item ${itemArg}`
    const names = fs.readdirSync(dir).filter((f) => f.endsWith(".md"))
    const there = names.find((f) => fs.readFileSync(path.join(dir, f), "utf8").split(/\r?\n/).some((l) => l === source || l.startsWith(`${source} `)))
    if (there) { console.log(`rework ticket already there: ${there}`); process.exit(0) }
    const next = String(Math.max(0, ...names.map((f) => Number((/^(\d+)-/.exec(f) || [])[1] || 0))) + 1).padStart(2, "0")
    const heading = (prof?.tickets?.done_section || "## Done when").replace(/^(?!#)/, "## ")
    const it = first.it
    const body = [
        `# ${next}: Rework of ${epic} ${nnPad}, item ${itemArg}`, "",
        "Type: task", "Status: open", "Blocked by: None — can start immediately",
        `${source} — ${path.basename(first.file)}`, "",
        `**What to build:** the owner checked item ${itemArg} of ${epic} ${nnPad} on ${platform} ${copy} and it failed. In the words of the owner:`, "",
        `> ${words || "(no words)"}`, "",
        heading, "",
        `- [ ] ${it.text}`,
        ...(it.needs ? [`${it.indent}- needs: ${it.needs.platform}${it.needs.copy ? ` ${it.needs.copy}` : ""}`] : []), "",
    ]
```

- Что делает: Ticket доработки — следующий свободный номер того же Epic-а, без блокеров; строка `Source:` в одной форме
  называет Epic, Ticket, пункт и дату; «done» — тот же ручной пункт с его `needs:`. Повторный Fail того же пункта в тот
  же день второго Ticket-а не заводит. Pass на пункте доработки читает этот `Source:` (строки 158-166) и пишет
  `owner-check pass` и `[x]` исходному пункту, если текст пунктов совпадает.
- Почему здесь: решение владельца Q2 (а) spec-а и Ticket, «Что делаем», пункт 4.
- Без него: Fail оставлял бы только строку `fail`, а повторная проверка после доработки не закрывала бы исходный пункт.
- Требование: [Что делаем, пункт 4](../issues/04-skill-harness-owner-check.md#что-делаем)
- Риски и пробелы test-ов: каркас Ticket-а — на английском (Harness нейтрален по языку); разделы проекта на
  `language.docs` дописывает Orchestrator. Если текст ручного пункта доработки переписать, Pass не дойдёт до исходного
  пункта — skill печатает об этом `note:`.

## 6. Путь Ticket-а доработки печатается через `/` на любой ОС

Code: `harness/skills/owner-check/SKILL.md:190-193` · key lines: 193

```js
    const name = `${next}-rework-${nnPad}-item-${itemArg}.md`
    fs.writeFileSync(path.join(dir, name), body.join("\n"))
    // Printed with "/" on every system: path.join would give "\" on Windows, and the owner reads the same form everywhere.
    console.log(`rework ticket: ${epic}/issues/${name}`)
```

- Что делает: файл пишется по пути, собранному `path.join` (так его открывает ОС), а в вывод путь идёт строкой
  `<epic>/issues/<файл>` — с `/` и на Windows.
- Почему здесь: первый CI run PR-а был красным только на Windows (job `windows (harness-scripts 2/2)`): `path.join` под
  Git Bash печатал `f-bash\issues\03-rework-02-item-2.md`, а раздел «What its output means» и test ждут
  `rework ticket: <epic>/issues/…`.
- Без него: на Windows строка вывода расходится с описанием skill-а, и case «Fail writes owner-check fail…» красный.
- Требование: [Что делаем, пункт 4](../issues/04-skill-harness-owner-check.md#что-делаем)
- Риски и пробелы test-ов: на Mac и Linux `path.join` и так даёт `/`, поэтому case с `FENVW` подменяет `path.join` блока
  preload-ом, который соединяет относительный путь через `\`; настоящий Windows проверяет только CI job Windows.

## 7. Что сознательно не меняли

- `harness/bin/ticket` и `harness/lib/evidence.cjs`: только читать по брифу; `lib/evidence.cjs` в этой Wave правит
  `worfy-polish` 132.
- `harness/skills/ship-ticket/step-6-manual-gui-checks.md` всё ещё описывает ручную запись строки `owner-check`; ссылку на
  skill туда не добавляли — файл только читать.
- Fail не снимает `[x]` с уже отмеченного пункта: Ticket этого не просит; состояние пункта по последней строке — failed.

## 8. Как проверено

- `bash harness/bin/tests/owner-check.test.sh` — exit 0 (35 проверок, bash и zsh); без skill-а — exit 1; пять mutant-ов
  блока (без проверки повтора, без проверки ручного пункта, без Ticket-а доработки, `--sha -`, путь доработки снова через
  `path.join`) — каждый красный.
- `bash harness/bin/tests/agents-text.test.sh` — exit 0; mutant-ы без фраз «Never tick an item without the owner's word» и
  «Never write `pass` on a Fail» — красные.
- `pnpm exec vitest run test/contract/codex-parity.test.ts` — exit 0 (16 tests).

## Проверить себя

1. Почему `sha` не входит в сравнение «та же строка»?
   - Ответ: при `sha` = `-` строку привязывает к `HEAD` сам `ticket`, а `HEAD` между двумя Send again может сдвинуться;
     с `sha` в сравнении повтор дал бы вторую строку.
   - Строки: `harness/skills/owner-check/SKILL.md:140-144`
2. Как Pass на пункте доработки находит пункт, который она дорабатывает?
   - Ответ: по строке `Source: owner-check fail <date> of <epic> <NN>, item <k>` в шапке Ticket-а доработки и по
     совпадению текста пунктов.
   - Строки: `harness/skills/owner-check/SKILL.md:158-166`
