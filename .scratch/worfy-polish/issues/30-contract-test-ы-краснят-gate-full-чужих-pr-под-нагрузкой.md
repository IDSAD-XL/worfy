# 30 — Contract test-ы с timeout-ом под нагрузкой краснят gate full чужих PR: постоянные stub-ы вместо новых исполняемых файлов

Type: task
Status: claimed — 2026-10-16
Branch: worfy-polish/30
Blocked by: —
Source: решение владельца 2026-10-16 — открыть Ticket и поставить первым в следующую Wave; «Итог»
[20](20-два-flaky-contract-test-а-harness.md) («Timeout в `harness-script-wiring.test.ts`»,
«Кандидаты с той же причиной», долг [low] о `{ shuffle: false }`); «Gate оркестратора»
[worfy-throughput 03](../../worfy-throughput/issues/03-implementer-гоняет-только-свои-e2e.md) (PR #385).

## Что происходит

- **Причина timeout-а найдена в Ticket-е 20.** macOS проверяет каждый новый исполняемый файл при
  первом запуске (`XprotectService`), по одному файлу на всю машину. Test, который пишет stub-скрипт
  заново в каждом test-е, под нагрузкой ждёт эту очередь секундами. Ticket 20 перевёл stub-ы
  `harness-script-wiring` на постоянные файлы `test/fixtures/harness-stub/`. Кандидаты с той же
  причиной остались: `harness-qmd`, `docs`, `github-prs`, `workflow-reader`.
- **2026-10-16 gate full PR, которые этих test-ов не трогали, краснел раз за разом.** Ticket
  worfy-throughput 03 (PR #385, только `.md` и `.sh`) — пять красных gate full подряд, зелёный с шестой
  попытки; ещё раз — Linux CI. Отдельно каждый упавший файл зелёный.
  - `workflow-reader`, `github-prs`, `harness-qmd`, `docs` — `Test timed out in 15000ms` (предел
    `testTimeout: 15_000`, `vitest.config.ts:50`);
  - `harness-script-env.test.ts` — `expected '/private/var/folders/…' to be null` в test-е «"Check
    again" with node added since the start» (`:264`, проверка `:276`);
  - один раз в Linux CI — `terminal-ai-zle.test.ts`, Alt+→ (`:338`): `expected 1 to be greater than 1`.
- **Где пишутся исполняемые файлы на каждый test.** Пути и коды выхода вписаны в текст скрипта, поэтому
  файл каждый раз новый.
  - `workflow-reader.test.ts`: `makeClaudeHome` (`:79-91`), `makePluginHome` (`:98-116`), `stubHarness`
    (`:498-512`), разовый `epic-status` (`:427-428`); около 40 вызовов.
  - `github-prs.test.ts`: `accountWorld` — `bin/profile` (`:513`) и stub `gh` (`:516`). Основной stub
    `gh` уже постоянный: `test/fixtures/gh/gh` (`:19`).
  - `harness-qmd.test.ts`: helper `stub` (`:33-36`) и `qmd-collections` (`:266-267`).
  - `docs.test.ts`: `bin/profile`, `bin/ticket` в `beforeEach` блока «a Silent Project» (`:365-367`).
    Какой test `docs` упал — по логу не установлено.
  - `harness-script-env.test.ts`: `login-shell` (`:269-270`).
- **`harness-script-env` и `terminal-ai-zle` — причина может быть другой.** Проверка `:276` ждёт, что
  после `recaptureAgentEnv()` в PATH нет node. Снимок shell-а, который упал (`fallback`), не заменяет
  прежний удачный (`src/main/agent/env.ts:556-559`); предел shell — 10 s (`env.ts:37`). Если shell не
  успел, остаётся снимок прошлого test-а, где node есть. Не проверено. В `terminal-ai-zle` сообщение —
  из helper-а `run` (`:213-216`): следующий prompt не пришёл за `WAIT` = 10 s (`:25`).
- **Долг Ticket-а 20.** Пара test-ов на протечку (`harness-script-wiring.test.ts:357`, `:362`) зависит
  от порядка и падает при `--sequence.shuffle.tests`. Порядок у `describe` (`:345`) не закреплён.

## Что делаем

1. **`workflow-reader`, `github-prs`, `harness-qmd`, `docs`** — как Ticket 20: постоянный stub в
   `test/fixtures/` (свой или общий `harness-stub/answer`), test ставит на него symlink. Что сейчас
   вписано в текст скрипта, stub берёт из env или из файла рядом. Где нельзя — причина в «Итог».
2. **`harness-script-env`** — сначала причина: под нагрузкой записать, что вернул `recaptureAgentEnv()`
   (`from`, время shell-а). Очередь `XprotectService` на `login-shell` — лечение пункта 1. Другая
   причина — лечить её; файл приложения дописывается в «Где в коде» при claim.
3. **`terminal-ai-zle`** — сначала причина: какой `run` не дождался prompt-а и почему. Падал только в
   Linux CI, где `XprotectService` нет.
4. **`{ shuffle: false }`** у `describe` в `harness-script-wiring.test.ts:345`.
5. **`testTimeout`, `WAIT` и пределы в файлах не поднимать** как лечение.

## Готово, когда

- [x] В `workflow-reader`, `github-prs`, `harness-qmd`, `docs`, `harness-script-env` test не пишет
      новых исполняемых файлов, или в «Итог» названа причина.
- [x] Причины падений `harness-script-env` и `terminal-ai-zle` — в «Итог» с выводом красного прогона до
      правки. Не воспроизвелось — так и записано, с числом прогонов.
- [ ] Замер способом Ticket-а 20: два прогона `--project contract` разом под `yes > /dev/null` на
      половине ядер (load около 15). До правки — до первого красного; после — 0 красных в N прогонах,
      N не меньше числа прогонов до первого красного × 3. Время самых долгих test-ов — в «Итог».
- [ ] Мутанты, где они что-то значат: stub снова пишется в каждом test-е; без `{ shuffle: false }` пара
      краснеет при `--sequence.shuffle.tests`, с ним — зелёная.
- [x] `testTimeout` в `vitest.config.ts`, `WAIT` и пределы в файлах не подняты.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; Linux CI зелёный. gate full — шаг
      Orchestrator-а перед merge.

## Тесты

- `node scripts/vitest-electron.mjs --project contract <файл>` в цикле shell, под нагрузкой и без; у
  каждого прогона — код выхода.
- Нагрузка — только когда других агентов Wave нет: она краснит gate соседей.

## Где в коде

- `test/contract/workflow-reader.test.ts`, `github-prs.test.ts`, `harness-qmd.test.ts`, `docs.test.ts`,
  `harness-script-env.test.ts`, `terminal-ai-zle.test.ts`
- `test/fixtures/harness-stub/` — новые постоянные stub-ы, если нужны
- `test/contract/harness-script-wiring.test.ts` — только строка `{ shuffle: false }`

Только читать: `src/main/agent/env.ts`, `vitest.config.ts`. Не платформенный PR по ADR-0056, пункт 2:
скрипты Harness, код с ветками по платформе и упаковку он не трогает. Заденет `harness/` — нужен
вердикт Windows.

## Вне скоупа

- Другие кандидаты Ticket-а 20 (`harness-install`, `workflow-profile`, `projects` и т. д.) — только если
  краснят gate; иначе — запись в «Итог».
- e2e из тех же gate full (`session-back.spec.ts`, `harness-install.spec.ts`).
- ENOTEMPTY в `harness-drift` — решено в Ticket-е 20.

## Итог

PR — ветка `worfy-polish/30`. Замер под нагрузкой и gate full — за Orchestrator-ом (ниже, «Что не
сделано»).

### 1. Постоянные stub-ы вместо нового исполняемого файла в каждом test-е

Test-ы ставят symlink на файл из `test/fixtures/`; то, что раньше вписывалось в текст скрипта, stub
берёт из файлов рядом со своей ссылкой или из env.

- `test/fixtures/harness-stub/canned` — общий stub `profile`, `ticket`, `epic-status`: печатает
  `<ссылка>.out` и `<ссылка>.err`, выходит с кодом из `<ссылка>.code`, пишет журнал
  `<имя> <аргументы> in <cwd>` в файл, путь к которому лежит в `<ссылка>.log`. Его берут
  `workflow-reader` (`stubHarness`, 682 Ticket-а Auction), `github-prs` (`accountWorld` → `bin/profile`),
  `docs` (блок «a Silent Project»).
- `test/fixtures/workflow-stub/` — `epic-status` и `plugin-epic-status` (sh) запускают
  `epic-status.mjs` (бывшая строка `STUB_JS`) под Node test-а; путь к Node и к `.mjs` — в env
  (`WORKFLOW_STUB_NODE`, `WORKFLOW_STUB_JS`), журнал `HARNESS_HOME` плагина — `STUB_HARNESS_ENV`.
  `bin-gone` — разовый старый `epic-status` из test-а «the move of ticket 14»: удаляет папку своей
  ссылки и выходит с 1 (только через ссылку, сам файл fixtures не удаляет).
- `test/fixtures/gh/gh-account` — бывший `GH_ACCOUNT_STUB` из `github-prs` (текст не зависел от
  test-а; тело совпадает побайтно, проверено сравнением).
- `test/fixtures/qmd-stub/` — `node`, `npm`, `qmd`, `qmd-collections` для `harness-qmd`; версия, код
  выхода и URI моделей — из env, который test и так передаёт модулю (`stubVars`). На PATH test-а
  только папка ссылок, поэтому stub-ы — на встроенных командах shell, как раньше.
- `test/fixtures/harness-stub/login-shell` — login shell test-а «"Check again" with node added»
  (`harness-script-env`), счётчик запусков — `<ссылка>.runs`.

Чего test-ы больше не делают: `chmod`/`0o755`/`#!` в этих пяти файлах нет (grep пуст). Формат журнала
`profile` стал общим: `profile -C <root> --json in <cwd>` в `workflow-reader` и
`profile -C <root> --field github.account in <root>` в `github-prs` — ожидания test-ов обновлены, проверка
стала строже (видно cwd).

Почему это лечит: замер на этой машине 2026-10-16 ~21:00, без искусственной нагрузки (load 6 от
соседнего Autopilot), 15 запусков подряд:

```
new file each run: median 2565.6 ms, max 4920.4 ms
link to one file:  median 2.5 ms,    max 3.4 ms
```

Остаток: файл fixture-а тоже новый для macOS один раз на свежем checkout-е (новый worktree) — первый
запуск каждого из ~10 файлов ждёт очередь один раз за прогон, а не в каждом test-е.

### 2. `harness-script-env` — механизм подтверждён, красный прогон до правки не воспроизведён

- Чтение `src/main/agent/env.ts`: `captureLoginShellEnv` убивает shell через `SHELL_TIMEOUT_MS` = 10 s
  и отдаёт `fallback`; `recaptureAgentEnv` (`:556-559`) не меняет удачный снимок на `fallback`. Значит,
  если login shell не уложился в 10 s, остаётся снимок прошлого test-а, где PATH ведёт в
  `<tmp>/node-bin` — отсюда `expected '/private/var/folders/…' to be null`.
- Мутант (в своём worktree, файл восстановлен из копии): `.profile` с `sleep 12` перед `PATH=…` —
  красный ровно с сообщением gate full:
  `AssertionError: recapture took 10003 ms, from login-shell, the login shell started 1 times: expected '/private/var/folders/3c/vgccn1z92czdr…' to be null`.
- Причина «shell не уложился» в gate full — первый запуск нового файла `login-shell` в очереди
  `XprotectService` (пункт 1 замера: до 4,9 s на файл при load 6; при load ~15 и нескольких test-файлах
  с новыми скриптами разом 10 s правдоподобны). Лечение — пункт 1. В test добавлено сообщение к
  проверке: время `recaptureAgentEnv()`, `from` и число запусков shell. При следующем красном оно
  разделит причины: «started 0 times» — exec ждал очередь, «started 1 times» и ≥ 10 000 ms — сам shell
  медленный.
- Не воспроизведено без нагрузки: 2 прогона файла после правки, оба зелёные (exit 0). Прогона под
  нагрузкой не было (запрет брифа: рядом живой Autopilot).

### 3. `terminal-ai-zle` — какой `run`, установлено чтением; почему — не установлено

- Сообщение `expected 1 to be greater than 1` — вторая проверка `run` (`count('prompt')`), значит
  первая (`command-finished` = было + 1) уже прошла: маркер D пришёл, следующего B за `WAIT` = 10 s нет.
  `prompts` = 1 бывает только у первого `t.run('echo worfy-zle-1 second third')` в test-е Alt+→: к
  последнему `t.run('')` prompt-ов уже не меньше двух.
- Между D и B: `__worfy_precmd` (последний в `precmd_functions`) печатает D и P, потом zsh запускает zle
  (`line-init` hook-и `rc.d/10-assist.zsh`, `30-next-command.zsh`) и рисует PS1 с B. Что из этого
  ждало 10 s в Linux CI (2 vCPU, параллельные test-файлы) — не установлено. `XprotectService` тут ни при
  чём (Linux), исполняемых файлов test не пишет.
- Не воспроизведено: 3 прогона файла без нагрузки, 36/36 зелёные, exit 0 каждый (25–27 s).

### 4. `{ shuffle: false }` и мутанты

- `harness-script-wiring.test.ts`: `describe(..., { shuffle: false }, ...)` у «what each run of a script gets».
- Мутант порядка: до правки `--sequence.shuffle.tests --sequence.seed=5` — exit 1,
  `FAIL … the run a test left behind still logs into that test's calls file … (the second of two)`
  (seed 1–4 — зелёные: порядок пары совпал случайно). После правки seed 5–9 — exit 0, 23/23.
- Мутант «stub снова пишется в каждом test-е» без нагрузки ничего не значит: test зелёный и с ним.
  Его проверяет только замер ниже.

### Что не сделано

- **Замер (чекбокс не отмечен)** — отложен Orchestrator-у на тихое окно: рядом шёл Autopilot Epic-а
  `worfy-link`, нагрузка краснит его gate. Команды — в отчёте PR и ниже.
- Мутант «stub в каждом test-е» под нагрузкой — часть того же замера.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` локально — в отчёте PR; Linux CI — в PR.

Команды замера. «До» — в worktree на `origin/main` до merge-а этого PR (`git worktree add --detach
<путь> origin/main`, `pnpm install --frozen-lockfile`), «после» — в worktree ветки; только когда других
агентов на машине нет. Один круг — два прогона `--project contract` разом под `yes` на половине ядер:

```sh
M=$(mktemp -d); N=$(( $(sysctl -n hw.ncpu) / 2 )); YES=""
for i in $(seq $N); do yes > /dev/null & YES="$YES $!"; done
for r in $(seq 1 10); do   # «до»: до первого красного; «после»: N ≥ 3 × (число кругов «до»)
  node scripts/vitest-electron.mjs --project contract --reporter=default --reporter=json --outputFile.json=$M/$r-a.json > $M/$r-a.log 2>&1 & A=$!
  node scripts/vitest-electron.mjs --project contract --reporter=default --reporter=json --outputFile.json=$M/$r-b.json > $M/$r-b.log 2>&1 & B=$!
  wait $A; echo "round $r a EXIT=$? load=$(sysctl -n vm.loadavg)"; wait $B; echo "round $r b EXIT=$?"
done
kill $YES
# десять самых долгих test-ов по всем прогонам
node -e 'const fs=require("fs"),d=process.argv[1];const t=[];for(const f of fs.readdirSync(d).filter(f=>f.endsWith(".json")))for(const x of JSON.parse(fs.readFileSync(d+"/"+f)).testResults)for(const a of x.assertionResults)t.push([a.duration??0,a.status,x.name.split("/test/")[1]+" > "+a.title]);t.sort((p,q)=>q[0]-p[0]);for(const r of t.slice(0,10))console.log(Math.round(r[0])+" ms",r[1],r[2])' $M
```
