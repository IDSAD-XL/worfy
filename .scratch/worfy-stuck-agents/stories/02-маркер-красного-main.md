# Code story — worfy-stuck-agents 02: Маркер красного main: `land` пишет `main-red-<key>.json`, worfy его читает

Kind: pr · Epic: worfy-stuck-agents · Ticket: 02 · PR: - · Language: ru

## 1. Что было не так

`land` узнавал красный main из push run-ов CI и держал строку `mainRed` только в памяти своего процесса. Файла, который
мог бы прочитать worfy, не было, а свой `gh run list` Run-у Autopilot запрещён инвариантом И2. Пока Orchestrator
повторял упавшие job-ы красного run-а, `land` обнулял `mainRed`, хотя main всё ещё красный.

- Требование: [Что происходит](../issues/02-маркер-красного-main.md#что-происходит)

## 2. Где лежит маркер: ключ registry gate-а и папка состояния gate-а

Code: `harness/bin/land:483-495` · key lines: 486, 488, 492

```js
let markerFile
function mainMarkerFile(st) {
    if (markerFile !== undefined) return markerFile
    const r = run([process.execPath, [path.join(__dirname, "..", "hooks", "gate-resolve.mjs")]], ["--which", st.repo], st.repo)
    const key = r.code === 0 ? r.out.split(/\r?\n/)[0].split("\t")[0] : ""
    if (!key || /[\\/]|^\.\.?$/.test(key)) {
        log(`main-red marker: no gate key for ${st.repo} (gate-resolve.mjs --which exit ${r.code}${key ? `, key ${JSON.stringify(key)}` : ""}${r.err ? `: ${firstLine(r.err)}` : ""}) — no marker`)
        markerFile = null
    } else {
        markerFile = path.join(process.env.CLAUDE_GATE_STATE || path.join(harnessHome(st.repo), "gate", "state"), `main-red-${key}.json`)
    }
    return markerFile
}
```

- Что делает: один раз за run спрашивает `gate-resolve.mjs --which <checkout>` о ключе registry gate-а и строит путь
  `<папка состояния gate-а>/main-red-<key>.json`. Папка — `CLAUDE_GATE_STATE`, иначе `<HARNESS_HOME>/gate/state`, как в
  `hooks/gate-paths.mjs`. Нет ключа (registry не знает checkout, registry не читается) или ключ похож на путь —
  строка в log и никакого маркера.
- Почему здесь: Ticket называет и файл, и ключ: `key` — запись `<gate>/config.json`, чей `match` — самый длинный
  префикс корня репозитория (`gate-resolve.mjs --which`), тот же, по которому worfy читает маркеры `red-<key>-<tag>`.
- Без него: `land` и worfy могли бы назвать файл разными ключами, и worfy не нашёл бы маркер.
- Требование: [Что делаем, пункт 1](../issues/02-маркер-красного-main.md#что-делаем)
- Риски и пробелы test-ов: `land` — CommonJS, а `gate-paths.mjs` — ES-модуль, поэтому правило папки состояния
  повторено одной строкой, а не импортировано; разойдутся — test-ы этого не поймают. `gate-resolve.mjs` запускается
  отдельным процессом node один раз за run.

## 3. Запись атомарная, удаление — когда main не красный

Code: `harness/bin/land:496-522` · key lines: 502, 509, 512, 513

```js
// red: the marker's fields, or null — the branch is not red.
function markMain(st, red) {
    const file = mainMarkerFile(st)
    if (!file) return
    if (!red) {
        try {
            fs.unlinkSync(file)
            log(`main-red marker: main is not red, removed ${file}`)
        } catch (e) {
            if (e.code !== "ENOENT") log(`main-red marker: ${file} cannot be removed: ${e.message}`)
        }
        return
    }
    const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}`)
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(tmp, `${JSON.stringify({ ...red, at: now() })}\n`)
        fs.renameSync(tmp, file)
        log(`main-red marker: wrote ${file}`)
    } catch (e) {
        log(`main-red marker: ${file} cannot be written: ${e.message}`)
        try {
            fs.unlinkSync(tmp)
        } catch {}
    }
}
// The state of the main branch: throws Wait when a PR with code may not merge now. The culprit is the first red push
```

- Что делает: `null` — main не красный: файл удаляется, отсутствие файла — не ошибка. Поля маркера — запись во
  временный файл в той же папке и `rename` поверх маркера, плюс поле `at` — время записи. Ошибка записи или удаления
  только пишется в log и не меняет решение о merge.
- Почему здесь: Ticket требует атомарную запись (временный файл и rename), «как у других файлов состояния gate-а»;
  `gate.mjs` так пишет `verdict-<tag>.json`.
- Без него: worfy мог бы прочитать полузаписанный JSON; читатель вернул бы `null` и не увидел красный main.
- Требование: [Что делаем, пункт 1](../issues/02-маркер-красного-main.md#что-делаем)
- Риски и пробелы test-ов: на Windows `rename` поверх файла, который другой процесс держит открытым, может не пройти;
  тогда остаётся прошлый маркер и строка в log. `gate.mjs` в таком случае повторяет попытку полсекунды, `land` — нет.
  Ни один test этот случай не гоняет.

## 4. Когда `mainGreen` пишет, удаляет и не трогает маркер

Code: `harness/bin/land:534-572` · key lines: 536, 557, 564, 572

```js
        if (r.status !== "completed") {
            if (!first && Number(r.attempt) > 1) {
                // the main-red marker stays: a red run is what gets rerun, the branch is red until its verdict
                mainRed = null
                throw mainWait(`the push run ${r.url || r.databaseId} on ${st.branch} (${short(r.headSha)}) is being rerun (attempt ${r.attempt}): code PRs wait for its verdict`, "ci")
            }
            if (!first) running = true
            continue
        }
        const verdict = VERDICT[r.conclusion]
        if (!verdict) continue
        if (documentsCommit(st, r.headSha)) {
            log(`push run ${r.databaseId} on ${short(r.headSha)} (${r.conclusion}): documents only, no verdict on the code`)
            continue
        }
        if (verdict === "green") {
            green = true
            break
        }
        first = r
    }
    if (!first) {
        mainRed = null
        markMain(st, null)
        return
    }
    const url = first.url || null
    if (!green && runs.length >= MAIN_RUNS) {
        const since = first.updatedAt || first.createdAt
        mainRed = `${st.branch} red since before ${short(first.headSha)} (no green push run among the newest ${MAIN_RUNS}, the oldest red one ${since}) — code PRs wait; the culprit is older than these runs: find it by hand`
        markMain(st, { sha: first.headSha, pr: null, since, url, line: mainRed })
        throw mainWait(`${mainRed.replace(" — ", `, run ${first.url || first.databaseId} — `)}`, running ? "ci" : "waits")
    }
    const pr = culpritPr(st, first.headSha)
    const since = first.updatedAt || first.createdAt
    const head = `${st.branch} red since ${short(first.headSha)} (${pr || "no PR"}, ${since})`
    const tail = `code PRs wait; fix forward until ${plusHour(since)}, then revert ${pr || short(first.headSha)}`
    mainRed = `${head} — ${tail}`
    markMain(st, { sha: first.headSha, pr: pr ? Number(pr.slice(1)) : null, since, url, line: mainRed })
```

- Что делает: после разбора push run-ов: красного run-а нет — маркер удаляется; красный run есть — маркер пишется с
  sha, номером PR-виновника (или `null`, когда PR нет или виновник старше 50 прочитанных run-ов), временем, URL run-а и
  той же строкой `mainRed`. Повтор красного run-а (`attempt > 1`, не завершён) выходит раньше и маркер не трогает.
  Неудачное чтение `gh` бросает `Wait` ещё до этого цикла — маркер тоже остаётся.
- Почему здесь: Ticket называет `mainGreen` и строки повтора (`land:485–487` до правки); critic 2026-11-17,
  возражение 2: если бы маркер уходил вместе с `mainRed`, Run отложил бы невиновные Ticket-ы.
- Без него: маркер исчезал бы во время повтора упавших job-ов и появлялся бы снова после него.
- Требование: [Что делаем, пункт 1](../issues/02-маркер-красного-main.md#что-делаем); [Риски: «Маркер снят раньше времени»](../spec.md#риски)
- Риски и пробелы test-ов: `land` снимает маркер, только когда сам читает push run-ы, — то есть когда в state-файле
  есть PR с кодом без `main_fix`. Устаревший маркер возможен; spec это принимает (риск «Устаревший маркер `main-red`»).

## 5. worfy читает маркер по корню Project-а и ничего не пишет

Code: `src/main/gate/state.ts:525-534` · key lines: 526, 529, 530

```ts
export async function readMainRed(gateDir: string, root: string, platform: NodeJS.Platform = process.platform): Promise<MainRedMarker | null> {
  const key = await gateKey(await readGateConfig(gateDir), root, platform)
  if (key === null) return null
  try {
    const parsed = mainRedSchema.safeParse(JSON.parse(await readFile(join(gateDir, 'state', mainRedFileName(key)), 'utf8')))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
```

- Что делает: находит ключ registry так же, как для маркеров `red-<key>-<tag>` (`gateKey`), читает
  `<gate>/state/main-red-<key>.json` и проверяет форму схемой zod. Нет ключа, нет файла, не JSON или не та форма —
  `null`. `GateReader.mainRed(root)` зовёт её с папкой gate-а Harness-а, найденной на машине сейчас.
- Почему здесь: Ticket называет `src/main/gate/state.ts` и требует `null` без файла или при нечитаемом JSON, иначе
  поля файла.
- Без него: Ticket 05 (остановка Run-а с причиной `main-red`) не смог бы узнать о красном main без своего `gh`.
- Требование: [Что делаем, пункт 2](../issues/02-маркер-красного-main.md#что-делаем)
- Риски и пробелы test-ов: пока функцию никто в приложении не вызывает — это делает Ticket 05. Файл, чья форма
  не совпала со схемой (например, `pr` строкой), читается как «маркера нет».

## 6. Что сознательно не меняли

Строку `mainRed`, которую `land` печатает Orchestrator-у, во время повтора красного run-а `land` по-прежнему не
печатает: Ticket меняет только файл. Русский перевод страницы `docs/features/ru/gate-and-github.md` — Ticket 10.
Тестовый мир `harness/bin/tests/land-world.sh` не тронут: registry и папку состояния gate-а для test-ов задаёт
`land.test.sh`, а `land-story.test.sh` маркер не проверяет.

## 7. Как проверено

`bash harness/bin/tests/land.test.sh` — exit 0, 123 проверки, из них 7 о маркере: запись с sha, PR и URL; запись без
временного файла; маркер остаётся при ошибке `gh` и во время повтора с `attempt: 2`; удаляется после зелёного
вердикта и при зелёном main; без ключа registry маркера нет. `test/unit/gate-state.test.ts` — exit 0: поля прочитаны,
`null` без файла, при битом JSON, не той форме и без ключа; чтение ничего не пишет. Новые проверки сначала были
красными. `pnpm lint && pnpm typecheck && pnpm test` — exit 0 (18829 test-ов), `gate fast` — exit 0, `[gate] green (fast)`.

## Проверить себя

1. Почему маркер не удаляется, пока новейший push run main идёт с `attempt: 2`?
   - Ответ: повторяют только завершённый красный run; до его вердикта main красный, и Run не должен откладывать
     невиновные Ticket-ы.
   - Строки: `harness/bin/land:535-538`
2. Как `land` и worfy приходят к одному имени файла, не договариваясь напрямую?
   - Ответ: оба берут ключ записи registry gate-а с самым длинным `match`-префиксом корня репозитория: `land` — через
     `gate-resolve.mjs --which`, worfy — через `gateKey`.
   - Строки: `harness/bin/land:486-492`, `src/main/gate/state.ts:526`
3. Что случится с маркером, если `gh run list` упал?
   - Ответ: `ghJson` бросает `Wait` до разбора run-ов, `markMain` не вызывается, маркер остаётся как был.
   - Строки: `harness/bin/land:527`
