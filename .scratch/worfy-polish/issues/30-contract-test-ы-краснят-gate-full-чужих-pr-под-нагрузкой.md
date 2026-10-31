# 30 — Contract test-ы с timeout-ом под нагрузкой краснят gate full чужих PR: постоянные stub-ы вместо новых исполняемых файлов

Type: task
Status: done 2026-10-23T21:53Z
PR: #815
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
- [x] Замер способом Ticket-а 20: два прогона `--project contract` разом под `yes > /dev/null` на
      половине ядер (load около 15). До правки — до первого красного; после — 0 красных в N прогонах,
      N не меньше числа прогонов до первого красного × 3. Время самых долгих test-ов — в «Итог».
      2026-10-23 — раздел 6: для файлов Ticket-а 0 красных в 6 прогонах после; весь набор красный по
      другим причинам (там же).
- [x] Мутанты, где они что-то значат: stub снова пишется в каждом test-е; без `{ shuffle: false }` пара
      краснеет при `--sequence.shuffle.tests`, с ним — зелёная.
- [x] `testTimeout` в `vitest.config.ts`, `WAIT` и пределы в файлах не подняты.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; Linux CI зелёный. gate full — шаг
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
- 2026-10-23 (бриф Orchestrator-а, новые кандидаты): `test/shell-stub.ts`, `test/fixtures/shell-stub/stub`,
  `test/unit/shell-stub.test.ts` — общий stub shell-а; `test/unit/first-run-windows.test.ts`,
  `test/contract/harness-evals.test.ts`, `e3-sandbox.test.ts`, `harness-install.test.ts`,
  `terminal-ai-zle.test.ts`; красные в замере под нагрузкой этого дня — `terminal-ai-zle-prompt.test.ts`,
  `statusline-bridge.test.ts`, `workflow-profile.test.ts`, `postinstall.test.ts`, `first-run-checks.test.ts`,
  `harness-evals-outcome.test.ts`, `harness-migrate-harness.ts`

Только читать: `src/main/agent/env.ts`, `vitest.config.ts`. Не платформенный PR по ADR-0056, пункт 2:
скрипты Harness, код с ветками по платформе и упаковку он не трогает. Заденет `harness/` — нужен
вердикт Windows.

## Вне скоупа

- Другие кандидаты Ticket-а 20 (`harness-install`, `workflow-profile`, `projects` и т. д.) — только если
  краснят gate; иначе — запись в «Итог».
- e2e из тех же gate full (`session-back.spec.ts`, `harness-install.spec.ts`).
- ENOTEMPTY в `harness-drift` — решено в Ticket-е 20.

## Итог

PR #401 (squash `20aa1a9a`, 2026-10-16), Linux CI `check` — success. Замер под нагрузкой — раздел 5
(2026-10-17/18): пять файлов Ticket-а после правки — 0 красных в 12 прогонах, но `--project contract`
целиком краснеет по другой причине (`wave-gate.test.sh`), поэтому Ticket — `blocked`.

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
  `AssertionError: recapture took 10003 ms, the login shell started 1 times: expected '/private/var/folders/3c/vgccn1z92czdr…' to be null`.
- Причина «shell не уложился» в gate full — первый запуск нового файла `login-shell` в очереди
  `XprotectService` (пункт 1 замера: до 4,9 s на файл при load 6; при load ~15 и нескольких test-файлах
  с новыми скриптами разом 10 s правдоподобны). Лечение — пункт 1. В test добавлено сообщение к
  проверке: время `recaptureAgentEnv()` и число запусков shell. При следующем красном оно разделит
  причины: «started 0 times» — exec ждал очередь, «started 1 times» и ≥ 10 000 ms — сам shell
  медленный. `from` в сообщение не входит: после `fallback` `recaptureAgentEnv` отдаёт прежний удачный
  снимок с его `from` = `login-shell` (ревью PR #401).
- Красного прогона до правки нет и в замере (раздел 5): 4 прогона `--project contract` до правки под
  нагрузкой — `harness-script-env` зелёный в каждом (самый долгий test 6,2 s); после правки — 12 из 12
  зелёные (2,5 s). Не воспроизвелось, причина в gate full 2026-10-16 остаётся выводом из чтения кода
  и мутанта выше.

### 3. `terminal-ai-zle` — какой `run`, установлено чтением; почему — не установлено

- Сообщение `expected 1 to be greater than 1` — вторая проверка `run` (`count('prompt')`), значит
  первая (`command-finished` = было + 1) уже прошла: маркер D пришёл, следующего B за `WAIT` = 10 s нет.
  `prompts` = 1 бывает только у первого `t.run('echo worfy-zle-1 second third')` в test-е Alt+→: к
  последнему `t.run('')` prompt-ов уже не меньше двух.
- Между D и B: `__worfy_precmd` (последний в `precmd_functions`) печатает D и P, потом zsh запускает zle
  (`line-init` hook-и `rc.d/10-assist.zsh`, `30-next-command.zsh`) и рисует PS1 с B. Что из этого
  ждало 10 s в Linux CI (2 vCPU, параллельные test-файлы) — не установлено. `XprotectService` тут ни при
  чём (Linux), исполняемых файлов test не пишет.
- Не воспроизведено: 3 прогона файла без нагрузки, 36/36 зелёные, exit 0 каждый (25–27 s). В замере
  (раздел 5) — 4 прогона до правки и 12 после под нагрузкой, все зелёные (файл 26–27 s до, 41–45 s после).

### 4. `{ shuffle: false }` и мутанты

- `harness-script-wiring.test.ts`: `describe(..., { shuffle: false }, ...)` у «what each run of a script gets».
- Мутант порядка: до правки `--sequence.shuffle.tests --sequence.seed=5` — exit 1,
  `FAIL … the run a test left behind still logs into that test's calls file … (the second of two)`
  (seed 1–4 — зелёные: порядок пары совпал случайно). После правки seed 5–9 — exit 0, 23/23.
- Мутант «stub снова пишется в каждом test-е» без нагрузки ничего не значит: test зелёный и с ним.
  Его проверяет только замер ниже.
- Повтор 2026-10-18 на `origin/main` `90c5e724` (без нагрузки, файл восстановлен из копии): без
  `{ shuffle: false }` seed 1–10 — exit 1 у seed 5, 6, 7, 10 (`FAIL … the run a test left behind still
  logs into that test's calls file, not into the next test's (the second of two)`), у остальных exit 0;
  с ним seed 1–10 — exit 0, 23/23 каждый. Мутант убит.

### 5. Замер под нагрузкой (2026-10-17/18, Orchestrator)

Способ — «Команды замера» ниже. «До» — detached worktree на `66499375` (`20aa1a9a^`, main перед
#401), «после» — на `origin/main` `90c5e724`; `pnpm install --frozen-lockfile` в каждом (exit 0). Круг —
два прогона `--project contract` разом под 9 `yes > /dev/null` (18 ядер). Фазы — одна за другой; перед
каждой 5-минутный load ниже 3 (2,93; 2,98; 2,96), после каждой `pgrep -x yes` пуст. Других агентов и
Autopilot на машине не было. Load — `vm.loadavg` в конце прогона `a`.

| Фаза | Круг | a | b | load (1/5/15 мин) | Что красное |
| --- | --- | --- | --- | --- | --- |
| до | 1 | 0 | 0 | 12,67 / 10,33 / 7,18 | — |
| до | 2 | 1 | 1 | 13,35 / 12,92 / 9,40 | оба: `docs` «follows edits in the Workflow folder and writes nothing there or in the repository» — `Test timed out in 15000ms` |
| после | 1 | 0 | 0 | 12,77 / 10,79 / 8,16 | — |
| после | 2 | 0 | 0 | 13,07 / 13,71 / 10,63 | — |
| после | 3 | 1 | 1 | 12,80 / 14,14 / 12,13 | оба: `harness-scripts` > `bin/tests/wave-gate.test.sh` — `spawnSync bash ETIMEDOUT` |
| после | 4 | 1 | 1 | 12,55 / 14,09 / 12,98 | оба: то же |
| после | 5 | 0 | 0 | 12,64 / 14,47 / 13,80 | — |
| после | 6 | 0 | 1 | 13,29 / 14,97 / 14,52 | b: то же |

- **До:** первый красный — круг 2, значит N ≥ 6. Первый запуск «до» не в счёте: прогон `a` не начался —
  два прогона разом скачивали бинарник Electron в свежем worktree (`failed to create directory …
  Electron.app/…/sv.lproj: File exists (os error 17)`); после этого Electron поставлен заранее в обоих
  деревьях.
- **После:** 6 кругов, 12 прогонов, 5 красных — все в одном test-е вне Ticket-а:
  `test/contract/harness-scripts.test.ts` гоняет `harness/bin/tests/wave-gate.test.sh` с пределом
  `FILE_TIMEOUT_MS` = 120 000 (`:22`). Под нагрузкой он идёт 118,7–120 s и упирается в предел; до правки
  — 68 s. После `66499375` в файл добавлено 252 строки, убрано 19 (#428, #433, #444). Ticket 30 его не трогал.
- **Пять файлов Ticket-а после правки — 0 красных в 12 прогонах.** Самый долгий test файла, до → после:

| Файл | До, ms | После, ms | Время файла, s, до → после |
| --- | --- | --- | --- |
| `docs` | 15 112 (timeout) | 1 931 | 45–49 → 10–12 |
| `github-prs` | 13 678 | 2 380 | 115 → 5–8 |
| `harness-qmd` | 13 501 | 3 361 | 67–71 → 0–9 |
| `workflow-reader` | 8 873 | 6 279 | 151–154 → 30–36 |
| `harness-script-env` | 6 163 | 2 479 | 10–11 → 5–9 |
| `terminal-ai-zle` | 1 952 | 4 836 | 26–27 → 41–45 |

- **Самые долгие test-ы по всем прогонам** (максимум каждого):
  - до: `wave-gate.test.sh` 68 646 ms; `harness-home.test.sh` 53 148; `gate-verdict.test.sh` 30 912;
    `silent-mode.test.sh` 24 080; `profile.test.sh` 19 532; `project-connect.test.sh` 19 115;
    `decision-log.test.sh` 15 382; `docs` «follows edits in the Workflow folder…» 15 112; `github-prs`
    «gh sees from worfy only `auth token -u <account>`…» 13 678; `docs` «lists and reads HANDOFF.md…»
    13 589.
  - после: `wave-gate.test.sh` 120 006 (timeout); `harness-home.test.sh` 33 469; `gate-verdict.test.sh`
    31 216; `gh-override.test.sh` 26 592; `silent-mode.test.sh` 23 978; `profile.test.sh` 22 537;
    `decision-log.test.sh` 13 939; `project-connect.test.sh` 12 095; `guard-silent.test.sh` 11 449;
    `harness-migrate` «node restore.mjs, a separate process…» 10 894.
  - Все `*.test.sh` — test-ы `harness-scripts.test.ts` («exits 0 with an empty HOME»).
- **Мутант «stub снова пишется в каждом test-е» — выжил.** В дереве «после» пять файлов вместо symlink
  писали в каждом test-е новый исполняемый файл с уникальной строкой-комментарием (`bin-gone` остался
  ссылкой: он удаляет папку своей ссылки); без нагрузки файлы зелёные (exit 0). Под нагрузкой 3 круга
  (load в конце 13,29 / 13,46 / 15,03): 4 прогона exit 0, 2 — exit 1 только от `wave-gate.test.sh`;
  пять файлов — 0 красных в 6 прогонах. Заметно дороже стал только `harness-qmd` (время файла 33–46 s,
  самый долгий test 8,6 s). Файлы восстановлены из копии, сравнение `diff -rq` пустое. Вывод: на этой
  машине 2026-10-18 новый исполняемый файл на test к timeout-у не приводит; почему `docs`,
  `github-prs`, `workflow-reader` после правки быстрее в разы, а с мутантом — нет, замер не
  устанавливает. Вероятная часть ответа: `profile`, `ticket`, `epic-status` worfy запускает как
  `node <script>`, если первая строка файла называет node (`harnessScriptCommand`,
  `src/main/workflow/profile.ts:189`): новый stub `canned` — Node-скрипт, файл читается node, а не
  запускается сам, и проверка нового исполняемого файла macOS к нему, вероятно, не относится. Не
  проверено.

### Что не сделано

- **Замер «после — 0 красных» не выполнен:** 5 красных из 12, причина — `wave-gate.test.sh` против
  предела 120 s в `harness-scripts.test.ts`, вне следа Ticket-а. Лечение — Ticket
  [32](32-wave-gate-test-sh-дольше-предела-harness-scripts-под-нагрузкой.md), после него — повтор замера.
  До тех пор Ticket — `blocked`.
- Мутант «stub в каждом test-е» выжил (раздел 5): test-ы Ticket-а его не ловят ни без нагрузки, ни под ней.

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

### 6. Новые кандидаты, 2026-10-23

Ticket снят с `blocked`: worfy-polish 32 влит, worfy-browser 08 закрыт. Кандидаты — из брифа Orchestrator-а
(красные в gate full этого дня) и красные в замере ниже.

**Сколько стоит первый запуск нового файла** (эта машина, `node`-скрипт: 10 новых файлов подряд, затем
ссылка на уже запущенный):

| Load | Новый `#!/bin/sh` скрипт | Тот же текст, новый файл | Копия `git` (Mach-O) | Ссылка |
| --- | --- | --- | --- | --- |
| 2,5 | медиана 400 ms, max 1435 | 258 ms, max 540 | 150–210 ms | 4 ms |
| ~30 | медиана 1243 ms, max 1868 | 962 ms, max 1063 | 260–600 ms | 8 ms |

Повторный запуск того же файла — 5 ms: проверяется файл, а не текст.

**Общий stub shell-а.** `test/shell-stub.ts`, `shellStub(path, lines)`: тело пишется в `<path>.sh`, `path` —
symlink на `test/fixtures/shell-stub/stub`, который читает тело командой `.` — `$0`, `$@`, `$$`, `$PPID`
те же, что у скрипта с этим телом. Запущенный через ещё одну ссылку (ссылки `tools/` у
`scripts/e3-sandbox.sh`), stub идёт по ссылкам назад до той, у которой есть тело. На Windows (ссылке на
файл нужна привилегия, проверки нет) — прежний скрипт целиком. `test/unit/shell-stub.test.ts`: ссылка
на один файл, аргументы и код выхода, второй вызов меняет тело, запуск через ссылку на ссылку.

| Файл | Что было новым исполняемым файлом | Что теперь |
| --- | --- | --- |
| `test/unit/first-run-windows.test.ts` | `hang` в каждом запуске test-а | `shellStub` |
| `harness-evals.test.ts` | `fake-git/git`, `failing-git/git`, `claude-by-path.mjs` | `shellStub` |
| `e3-sandbox.test.ts` | `gh` в каждом `beforeEach`, `stubCommand` (`sleep`, `touch`, `rmdir`, …) | `shellStub` |
| `harness-install.test.ts` | `claude` в каждом `beforeEach` | `shellStub` |
| `terminal-ai-zle-prompt.test.ts` | обёртка `zsh -o allexport` | `shellStub` |
| `statusline-bridge.test.ts` | stub-ы `node` | `shellStub` |
| `workflow-profile.test.ts` | `profile` старого Harness | `shellStub` |
| `postinstall.test.ts` | `electron-rebuild` | `shellStub` |
| `first-run-checks.test.ts` | `qmd-collections` | `shellStub` |
| `harness-migrate-harness.ts` | `claude` каждой песочницы | `shellStub` |
| `harness-evals-outcome.test.ts` | `claude` (`#!/usr/bin/env node`) в каждом запуске | один файл на test-файл, в запусках — ссылки |

- Остались файлами: `machineTools` в `e3-sandbox.test.ts` — `e3-sandbox.sh` оставляет ссылку `tools/`
  как есть, если найденный инструмент — тот же файл (`-ef`), а ссылки на один stub — один файл (проверено:
  4 test-а красные); комментарий в коде. Запускается из них только `node`, в трёх test-ах.
- Копия git, которую делает сам `scripts/eval-run-env.mjs` (`gitCopy`): обёртка `<…>-git/git` и
  `git-core/git` — новые в каждом запуске `eval-harness.mjs`, две проверки на запуск. Это поведение
  скрипта (песочница `claude plugin eval` не читает git Command Line Tools), test-ами не обходится; HOME у
  каждого test-а свой, так что и кэш копии в скрипте test-ам не помог бы.
- `terminal-ai-zle.test.ts` — причина другая, не `XprotectService`. В `run` добавлено сообщение: сколько
  ms прошло и что shell напечатал. Красный прогон до правки (под нагрузкой ниже, «до» и первый круг
  «после»), test «a program the shell starts finds no connection to the socket on any descriptor»:
  `the end of the command 9982 ms after the line, in "…echo checked'\u0007checked\r\n[1] 91045\r\n"` —
  первая программа напечатала `checked`, вторая, `( … ) & wait`, за `WAIT` = 10 s не кончила. Проверка
  `( : >&$n ) 2>/dev/null` запускала subshell на каждый дескриптор: 253 процесса на программу, 506 на
  команду. Теперь `[ -e /dev/fd/$n ]` в том же zsh — без процессов; дескрипторы 3–9 она видит так же
  (сравнено на socketpair, pipe и открытом файле), отличие — только внутренний дескриптор 10 самого zsh.
  В test «what worfy's own widget starts at the prompt finds 3 to 9 closed» добавлена проверка
  `open:<fd>`: проверка видит открытый дескриптор (мутант `if false` вместо `[ -e … ]` — красный).
- `terminal.test.ts` «open starts $SHELL -l …» — исполняемых файлов не пишет (`/bin/sh`, `ps` системы).
  Не воспроизвелось: 0 красных в 4 прогонах «до» и в 12 «после», test целиком 264–566 ms при пределе
  каждого `run` 5 s. Причина красного в gate full этого дня не найдена.

**Замер.** Способ Ticket-а 20 (`--project contract --project node`, чтобы попал `first-run-windows`):
два прогона разом под 9 `yes > /dev/null` (18 ядер), под `/tmp/worfy-e2e.lock`. «До» — detached worktree
на `origin/main` `a6d54252`, «после» — ветка. После каждой фазы `pgrep -x yes` пуст, замок снят.
В «до» и в первом «после» на машине шли test-ы ещё одного агента (worktree 38); второе «после» ждало
замок 13 минут, пока шёл чужой gate full.

| Фаза | Круг | a / b | Load (1/5/15 мин) | Красные из файлов Ticket-а |
| --- | --- | --- | --- | --- |
| до | 1 | 1 / 1 | 19,8 / 26,1 / 16,1 | оба: `harness-evals` «exits 1 … does not answer --version» — `Test timed out in 15000ms` |
| до | 2 | 1 / 1 | 23,8 / 29,4 / 20,8 | оба: `terminal-ai-zle` «finds no connection to the socket…» — 10 s |
| после, все правки | 1 | 1 / 1 | 26,1 / 23,5 / 19,9 | — |
| после, все правки | 2 | 1 / 1 | 29,2 / 31,7 / 24,7 | — |
| после, все правки | 3 | 1 / 1 | 31,0 / 35,5 / 28,2 | — |

До первого красного — 1 круг; после — 3 круга, 6 прогонов, 0 красных в файлах Ticket-а. Промежуточный
замер (правки только первых четырёх файлов, 3 круга) показал, почему в след вошли остальные: во втором
его круге по timeout-у упали 14 и 16 test-ов, почти все — test-ы, которые пишут новый исполняемый файл
(`statusline-bridge`, `workflow-profile`, `postinstall`, `first-run-checks`, `harness-evals-outcome`,
`harness-migrate`, `terminal-ai-zle-prompt`). Очередь проверки одна на машину: чужие новые файлы задерживают
каждый test, который запускает свой.

Время одного прогона: до 264–345 s, после 203–211 s. Test-ы, ms (каждый прогон):

| Test | До | После |
| --- | --- | --- |
| `harness-evals` «exits 1 … does not answer --version» | 15 687 F, 15 567 F, 9 649, 9 615 | 685–1 525 |
| `first-run-windows` «… the tool is ended with its tree» (предел 5 s) | 1 876–4 618 | 1 060–1 098 |
| `terminal-ai-zle` «finds no connection to the socket…» | 4 744, 4 762, 10 079 F, 10 084 F | 935–1 290 |
| `terminal-ai-zle-prompt` «under `allexport` from the start…» | 529–3 858 | 89–164 |
| `workflow-profile` «an older Harness's shell profile is started by itself…» | 2 798–3 882 | 10–22 |
| `postinstall` «passes the exit code of electron-rebuild on» | 4 131–5 022 | 143–209 |
| `e3-sandbox` «40 runs each end within 15 s…» | 18 963–20 609 | 17 282–17 719 |

Время файла, s, до → после: `e3-sandbox` 190–245 → 53–54; `harness-install` 160–204 → 111–116 (самый
долгий test 9,5 → 5,4 s); `harness-evals` 263–345 → 202–210 (самый долгий 15,7 → 11,1 s);
`harness-evals-outcome` 132–169 → 121–126 (23,8 → 12,6 s).

**Красные по другим причинам, вне Ticket-а** (в обеих фазах или только под этой нагрузкой):
- `login-shell-capture.test.ts` «keeps nothing of what that process writes after the answer» — красный в
  каждом прогоне под нагрузкой, до и после, и в `pnpm test` при чужом gate full; отдельно зелёный.
  100 MB через pipe (`head -c 100000000 | tr`) не проходят за предел `spawnSync` 20 s: `status` null.
  Исполняемых файлов test не пишет.
- `harness-scripts.test.ts` `*.test.sh` против своего предела 120 s (`skill-blocks`, `gate-verdict`,
  `profile`, `guard-silent`, `wave-gate-heartbeat`) — в «до» и в промежуточном «после»; во втором «после» —
  только `wave-gate-heartbeat` (exit 1, не timeout), в двух прогонах из шести.
- Пределы времени в самих test-ах: `workflow-reader` «… 682 Tickets in ≤ 300 ms» (310, 317 ms),
  `search-index` «… at most 100 ms» (143, 159 ms), `terminal-ai-suggest` «a timer that ran out…».
- `e3-sandbox` «says where the sandbox went…» — предел одного запуска скрипта 10 s, один раз, в круге,
  где упало всё.
- Не тронуты (пишут исполняемый файл, красными в замере не были): `harness-script-command`, `shell`,
  `agent-env-recapture`, `trash`, `projects`, `link-access`, `layout-archive`, `e3-owner-check`,
  `test/unit/remove-tree`, `shell-integration-dispose`, `harness-locate`, `agent-env`.

Пределы (`testTimeout`, `WAIT`, предел `run` в `terminal-harness.ts`, `sandbox()` в `e3-sandbox`) не
менялись.

### Windows: test-ы, которым worfy-windows 14 (срез 3l) поднял timeout на win32 (2026-10-19)

**Итог (2026-10-19, решение владельца).** Пределы по одному test-у сняты. Вместо них на Windows все пределы
vitest по умолчанию умножены на 3, в одном месте — `vitest.config.ts` (`timeScale`): `node` и `jsdom` 15 s,
`contract` 45 s, hook-и 30 s. На macOS и Linux значения прежние. Остались только два отдельных предела больше
45 s: `harness-evals` «reviewer-simplification…» 53 s и `harness-migrate` «the qmd group…» 60 s. Причина —
в полном run-е на Windows короткие test-ы идут в 4–5 раз дольше, чем в одиночку, и каждый раз другие
упираются в предел (раздел «Одна проблема нагрузки» ниже); меньше worker-ов не помогает. Таблица ниже —
история замеров, по которой это видно.

Поправка 2026-10-31: предел 60 s у `harness-migrate` «the qmd group…» снят в #1146 — перенос спрашивает git о путях одним вызовом, а не по одному на путь; test идёт с default 45 s.

Цель среза 3l — `pnpm test` с exit code 0 на Windows. Test-ы ниже краснели по timeout-у на PC.
Предел поднят только на win32 и только у одного test-а: третий аргумент
`it(…, fn, process.platform === 'win32' ? N : undefined)`, над test-ом — комментарий с замером.
На других системах предел прежний (5 s у `node`/`jsdom`, 15 s у `contract` из `vitest.config.ts`);
общий timeout файла, `describe` или конфига не менялся.

Правило (решение оркестратора, 2026-10-19):
- новый предел на win32 — примерно 2× самой долгой завершённой длительности test-а в полном run-е;
- vitest останавливает асинхронный test на пределе, поэтому записанная длительность асинхронного
  test-а, упавшего по timeout-у, — не замер;
- синхронный код vitest остановить не может: синхронный test доходит до конца, и его длительность —
  замер, даже если она больше предела;
- без завершённого замера предел не поднимается;
- если 2× не больше предела файла по умолчанию, отдельного предела нет.

Замеры — JSON-отчёты vitest двух полных `pnpm test` на PC:
- R1 — `main` `a3514683`, 2026-10-19 18:49;
- R2 — ветка среза, `32438dc3`, 2026-10-19 21:33, PC без другой нагрузки;
- R3 — `main` `aa27fa89` (после PR #541), 2026-10-19 22:55–23:20, PC без другой нагрузки: 10 failed —
  8 `.test.sh` в `harness-scripts.test.ts` (Ticket 71) и 2 timeout-а на 15 s (ниже, «Одна проблема нагрузки»).

Run-ы файлов по одному и run семи файлов разом в расчёт не идут: это не полный run. Исключение —
два test-а `harness-migrate*`: в R2 они упали по timeout-у на 15 s, завершённого замера в полном run-е
у них нет, и оркестратор решил мерить их в одиночку (`-t`, `--testTimeout=120000`, `main` `046b086c`,
PC, 2026-10-19, с обычным TEMP и с TEMP=W:\). Их предел временный — 60 s: в R2 оба шли дольше 15 s, а
полный run бывает в разы медленнее, чем в одиночку (`github-prs` «starts at most 10 branch lookups»: 1.2 s
в одиночку, 6.9 s в R1). 2× времени в одиночку (17 s и 20 s) мог не хватить полному run-у (ревью PR #541, круг 1).
- [x] Перемерено в R3: 15.5 s и 29.9 s, оба завершены. Пределы — 31 s и 60 s (2×), комментарии называют R3. После Итога 31 s снят: его покрывает default 45 s.

| Файл | Test | Было → стало (win32) | Замер |
|---|---|---|---|
| `test/unit/check-handoff.test.ts:89` | «passes exactly 15360 bytes and fails on 15361» | 5 s → 13 s | R1: 6.2 s, синхронный, завершён (вышел за предел 5 s); R2: 0.3 s, завершён |
| `test/unit/check-lessons.test.ts:65` | «fails «проверки нет:» with an empty or blank reason…» | 5 s → 12 s | R1: 5.9 s, синхронный, завершён (вышел за предел 5 s); R2: 0.2 s, завершён |
| `test/unit/canvas.test.tsx:50` | «collectNodeTypes > maps each kind to its component…» | 5 s → 7 s | R2: 3.4 s, асинхронный, завершён; R1: timeout на 5 s — не замер |
| `test/contract/harness-evals.test.ts:155` | «the cases > <case> > builds its fixture with exit code 0 in a temporary HOME» (все 10 случаев `describe.each`, один предел) | 15 s → 24 s | R2: 11.7 s у `reviewer-intended-breakage`, завершён; R1: 11.6 s, завершён |
| `test/contract/harness-evals.test.ts:408` | «reviewer-intended-breakage is the diff the case describes > removes the check the ticket removes on purpose…» | 15 s → 27 s | R1: 13.4 s, синхронный, завершён; R2: 6.3 s, завершён |
| `test/contract/harness-evals.test.ts:451` | «reviewer-simplification is the diff the case describes > adds a thin wrapper…» | 15 s → 53 s | R1: 26.5 s, синхронный, завершён (вышел за предел 15 s) |
| `test/contract/projects-connect.test.ts:1354` | «the GitHub account … > after the account step the draft carries the chosen account…» | 15 s → 26 s | R2: 12.7 s, асинхронный, завершён; R1: timeout — не замер |
| `test/contract/harness-install.test.ts:277` | «the state > with the plugin folder reads `plugin list` once…» | 15 s → 33 s | R2: 16.2 s, асинхронный, завершён; R1: timeout — не замер |
| `test/contract/harness-install.test.ts:722` | «errors > a non-zero exit of `claude plugin update`…» | 15 s → 26 s | R1: 12.9 s, завершён; R2: 9.1 s, завершён |
| `test/contract/harness-install.test.ts:796` | «errors > a copy that fails half way…» | 15 s → 27 s | R2: 13.4 s, завершён; R1: 10.1 s, завершён |
| `test/contract/harness-install.test.ts:816` | «errors > a copy interrupted between its two renames…» | 15 s → 27 s | R1: 13.5 s, завершён; R2: 5.8 s, завершён |
| `test/contract/harness-migrate-boundaries.test.ts:80` | «a second restore.mjs keeps what the first one saved in after/…» | 15 s → 31 s → снят (default 45 s после Итога) | R3: 15.5 s, завершён; в одиночку 8.3 s и 7.7 s; R2: timeout на 15 s — не замер |
| `test/contract/harness-migrate.test.ts:459` | «the qmd group: "Remove" takes the three scripts…» | 15 s → 60 s | R3: 29.9 s, завершён; в одиночку 9.9 s и 9.8 s; R2: timeout на 15 s — не замер |

Поправка 2026-10-31: предел 60 s у `harness-migrate` «the qmd group…» снят в #1146 — перенос спрашивает git о путях одним вызовом, а не по одному на путь; test идёт с default 45 s.

Предел снят — 2× завершённого замера не больше 15 s (первая версия среза ставила его по длительности
асинхронного test-а, упавшего по timeout-у, а это не замер):
- `test/contract/github-prs.test.ts:314` «PrTracker over the gh stub > with 150 PRs, finds the PR of a
  branch outside the first 100…» — было 34 s по 16.6 s в R1 (timeout). R2: 4.6 s, завершён; 2× = 9.2 s.
- `test/contract/harness-install.test.ts:673` «errors > a first `install` of worfy that records the
  plugin and exits non-zero…» — было 31 s по 15.2 s в R1 (timeout). R2: 5.4 s, завершён; 2× ≈ 11 s.
- `test/contract/harness-install.test.ts:850` «a rename refused by a held-open file (Windows) > EBUSY
  twice, then free…» — было 46 s по 22.6 s в run-е файла отдельно (timeout, и не полный run).
  R2: 3.7 s, R1: 3.6 s, оба завершены; 2× = 7.4 s.

**Одна проблема нагрузки, а не зависание отдельного test-а** (решение оркестратора после R3). Короткие
test-ы — 1–4 s в одиночку — в полном run-е на Windows идут в 4–5 раз дольше и иногда упираются в 15 s.
В каждом run-е упирается другой набор, поэтому пределы по одному test-у здесь не сходятся.

| Test | В одиночку (TEMP / W:\) | R1 | R2 | R3 |
|---|---|---|---|---|
| `github-prs.test.ts:344` «starts at most 10 branch lookups in one read…» | 1.2 s / 1.1 s | 6.9 s | timeout 15 s | 6.2 s |
| `harness-evals.test.ts` «the fixture is a project the Harness recognises > epic-wave-tickets: a scaffold without EVAL_*…» | 3.2 s / 3.4 s | skipped | 5.1 s | timeout 15 s |
| `workflow-reader.test.ts` «workflow watcher > reads during a steady stream of saves…» | 3.8 s / 3.7 s | 5.0 s | 5.4 s | timeout 15 s |

В одиночку — `-t` и `--testTimeout=120000` на PC: github-prs на `main` `046b086c`, два других на `aa27fa89`.
- [x] Эксперимент: полный run `aa27fa89` с `--maxWorkers=8` (vitest 5.0.3 по умолчанию берёт 15 на 16
  логических ядрах), 2026-10-19 23:22–23:47. Время 1462 s против 1521 s; timeout-ов вне Ticket 71 — 4 против 2,
  у других test-ов: `process-boundary` (`node`), `linked-read-only` (`jsdom`), `canvas` collectNodeTypes,
  `harness-migrate` «the toolbar offer» (9.6–12.7 s в одиночку). Меньше worker-ов не лечит.
- [x] Решение владельца: множитель ×3 на Windows для всех project-ов, без новых замеров (Итог в начале раздела).
- [x] Контрольный полный run `main` `2af91b51` (после PR #544), свободный PC, 2026-10-20 00:29–00:54, 1485 s:
  9 failed — 8 `.test.sh` в `harness-scripts.test.ts` (Ticket 71) и 1 разовый сбой ниже; timeout-ов vitest нет; `wave-gate.test.sh` — по пределу файла, Ticket 71; ×3 хватает.
- Разовый сбой, не timeout (в 4 прошлых полных run-ах и в одиночку — зелёный): `terminal-windows.test.ts` «closing a
  Terminal on Windows, on a real pty > endDescendants ends what is under the shell and leaves the shell» —
  `expected 'gone' to be 'ended'` за 2.2 s. `descendantsScript` (`src/main/terminal/pty.ts:280`) отвечает `gone`, если
  оболочки нет в запросе `Win32_Process`, у неё пуст `CreationDate` или она новее `startedBy` + запас; test за миг до
  этого видел оболочку живой. Похоже на сбой WMI или времени под нагрузкой; причина не найдена, исследовать — если
  повторится.

«the state > a build whose Harness names no dependency has none to report»
(`harness-install.test.ts`) в R1 упал на сравнении списка вызовов `claude`
(`expected [ …(3) ] to deeply equal [ 'plugin list --json', …(3) ]`). Это не своя ошибка, а след
test-а перед ним («with the plugin folder reads `plugin list` once…»), упавшего по timeout-у. `sb` —
переменная модуля, `beforeEach` переписывает её для следующего test-а. Тело упавшего test-а
продолжает работать: когда его `install` заканчивается, его `clearCalls()` удаляет журнал вызовов уже
нового test-а. Проверено мутантом: предыдущему test-у — timeout 500 ms и пауза перед `clearCalls()`,
чтобы удаление пришлось на `install` следующего test-а. При паузе 200 ms следующий test падает с тем
же сообщением, при 400 и 600 ms — с двумя и одним вызовом. Без timeout-а у предыдущего test-а этого
нет: пока он укладывается в предел (33 s, с Итога — 45 s по умолчанию), сбоя нет и у следующего. Предел прячет
утечку, но не лечит её: test, упавший по timeout-у, продолжает работать и чистит журнал вызовов
следующего (`harness-install.test.ts:176`, `:223`, ревью PR #541). Открыто.

Корневая причина в этом тикете не устранена: почему эти test-ы на Windows идут в разы дольше, чем на
Mac (запуск процессов, `git`, stub-ы `claude`/`gh` под Node Electron-а, нагрузка полного run-а), здесь
не исследовано. Новые пределы — обход на win32, а не лечение. В R1 близко к пределу 15 s завершились
и другие test-ы этих файлов, которым timeout не поднимали: один в `harness-evals.test.ts` (12.2 s) и
три в `projects-connect.test.ts` (до 11.4 s).
