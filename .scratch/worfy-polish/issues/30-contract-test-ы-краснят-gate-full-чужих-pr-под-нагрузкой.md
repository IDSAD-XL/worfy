# 30 — Contract test-ы с timeout-ом под нагрузкой краснят gate full чужих PR: постоянные stub-ы вместо новых исполняемых файлов

Type: task
Status: blocked 2026-10-17T22:29Z
Blocked reason: ждёт worfy-polish 32: wave-gate.test.sh под нагрузкой дольше предела 120 s в harness-scripts.test.ts (5 красных из 12 в замере после #401); после 32 — повтор замера
Waits: agent
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

### Windows: test-ы, которым worfy-windows 14 (срез 3l) поднял timeout на win32 (2026-10-19)

Цель среза 3l — `pnpm test` с exit code 0 на Windows. Test-ы ниже краснели по timeout-у на PC.
Каждому поднят timeout только на win32 и только у одного test-а: третий аргумент
`it(…, fn, process.platform === 'win32' ? N : undefined)`, над test-ом — комментарий с замером.
На других системах предел прежний (5 s у `node`/`jsdom`, 15 s у `contract` из `vitest.config.ts`);
общий timeout файла, `describe` или конфига не менялся. Новое значение — примерно 2× самого долгого
замера, округлено вверх до секунды. Замеры: полный `pnpm test` на `main` `a3514683` на PC (JSON-отчёт
vitest), повторы файлов по одному (2 из 2) и один run семи файлов разом на ветке среза («с шестью
другими файлами»). У test-а, упавшего по timeout-у, vitest пишет длительность вместе с работой после
timeout-а, поэтому она может быть больше предела.

| Test | Файл | Было → стало (win32) | Замер |
|---|---|---|---|
| «passes exactly 15360 bytes and fails on 15361» | `test/unit/check-handoff.test.ts:89` | 5 s → 13 s | полный run: 6.2 s, timeout; с шестью другими файлами: 0.8 s |
| «fails «проверки нет:» with an empty or blank reason…» | `test/unit/check-lessons.test.ts:65` | 5 s → 12 s | полный run: 5.9 s, timeout; с шестью другими: 0.8 s |
| «collectNodeTypes maps each kind to its component…» | `test/unit/canvas.test.tsx:50` | 5 s → 11 s | полный run: 5.0 s, timeout; с шестью другими: 5.1 s, timeout; по одному — зелёный 2 из 2 |
| «PrTracker over the gh stub with 150 PRs, finds the PR of a branch outside the first 100…» | `test/contract/github-prs.test.ts:315` | 15 s → 34 s | полный run: 16.6 s, timeout; с шестью другими: 2.2 s |
| «reviewer-simplification is the diff the case describes…» | `test/contract/harness-evals.test.ts:451` | 15 s → 54 s | полный run: 26.5 s, timeout; с шестью другими: 12.7 s |
| «the cases > <case> > builds its fixture with exit code 0 in a temporary HOME» (все 10 случаев `describe.each`) | `test/contract/harness-evals.test.ts:155` | 15 s → 32 s | с шестью другими: 15.5 s у `reviewer-simplification`, timeout; полный run: 11.6 s. В список оркестратора не входил — найден run-ом среза |
| «reviewer-intended-breakage is the diff the case describes > removes the check the ticket removes on purpose…» | `test/contract/harness-evals.test.ts:408` | 15 s → 33 s | с шестью другими: 16.2 s, timeout; полный run: 13.4 s. В список оркестратора не входил — найден run-ом среза |
| «the GitHub account … after the account step the draft carries the chosen account…» | `test/contract/projects-connect.test.ts:1354` | 15 s → 31 s | полный run: 15.1 s, timeout; с шестью другими: 9.7 s |
| «the state > with the plugin folder reads `plugin list` once…» | `test/contract/harness-install.test.ts:277` | 15 s → 31 s | полный run: 15.2 s, timeout |
| «errors > a first `install` of worfy that records the plugin and exits non-zero…» | `test/contract/harness-install.test.ts:674` | 15 s → 31 s | полный run: 15.2 s, timeout |
| «errors > a non-zero exit of `claude plugin update`…» | `test/contract/harness-install.test.ts:723` | 15 s → 26 s | полный run: 12.9 s |
| «errors > a copy that fails half way…» | `test/contract/harness-install.test.ts:797` | 15 s → 21 s | полный run: 10.1 s |
| «errors > a copy interrupted between its two renames…» | `test/contract/harness-install.test.ts:817` | 15 s → 27 s | полный run: 13.5 s |
| «a rename refused by a held-open file (Windows) > EBUSY twice, then free…» | `test/contract/harness-install.test.ts:852` | 15 s → 46 s | по одному: 22.6 s, timeout (1 из 2 повторов); полный run: 3.6 s |

«the state > a build whose Harness names no dependency has none to report»
(`harness-install.test.ts`) в полном run-е упал на сравнении списка вызовов `claude`
(`expected [ …(3) ] to deeply equal [ 'plugin list --json', …(3) ]`). Это не своя ошибка, а след
test-а перед ним, упавшего по timeout-у. `sb` — переменная модуля, `beforeEach` переписывает её для
следующего test-а. Тело упавшего test-а продолжает работать: когда его `install` заканчивается, его
`clearCalls()` удаляет журнал вызовов уже нового test-а. Проверено мутантом: предыдущему test-у —
timeout 500 ms и пауза перед `clearCalls()`, чтобы удаление пришлось на `install` следующего test-а.
При паузе 200 ms следующий test падает с тем же сообщением, при 400 и 600 ms — с двумя и одним
вызовом. Без timeout-а у предыдущего test-а этого нет, так что новый предел 31 s лечит и его.

Корневая причина не устранена: почему эти test-ы на Windows идут в разы дольше, чем на Mac
(запуск процессов, `git`, stub-ы `claude`/`gh` под Node Electron-а, нагрузка полного run-а), здесь не
исследовано. Новые пределы — обход на win32, а не лечение. В том же полном run-е близко к пределу
15 s шли и другие test-ы этих файлов, которым timeout не поднимали: один в `harness-evals.test.ts`
(12.2 s) и три в `projects-connect.test.ts` (до 11.4 s); в run-е семи файлов разом у
`harness-evals.test.ts` дольше 10 s шли 20 test-ов из 128.
