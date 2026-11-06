# 16 — Приёмка worfy-windows

Type: task
Status: open
Blocked by: 15, 17, 106, 109, 110, 111, 112, 116, 117
Source: «Готово, когда» Epic-а — пять пунктов, подтверждены владельцем 2026-10-08; решения владельца 2026-10-07: Q1 (полный порт под Windows), Q18 (Git for Windows обязателен), Q19 (скрипты, которые зовут hooks и worfy, — на Node; bash только в test-ах), Q20 (Terminal на Windows — PowerShell), Q21 (qmd на Windows или grep), Q22 (неподписанный установщик NSIS до E4; если включён Smart App Control — вопрос подписи сразу), Q23 (gate full на ПК владельца перед мержем платформенных PR), Q24 (Windows 10 21H2+ и 11, x64), Q25 (Session-ы Mac и Windows общаются через репозиторий); решения владельца 2026-10-08: Q30–Q33 (метка `needs-mac-gate`, gate full на свежем main в начале Wave на Windows, очередь `/worfy:gate-queue` на Mac, раздел «Mac checks» и отчёт в PR; spec.md, «Соглашения», «Метка needs-mac-gate»); [ADR-0054](../../../docs/adr/0054-full-windows-port.md) «Full Windows port»; [ADR-0055](../../../docs/adr/0055-harness-scripts-in-node.md) «Harness scripts in Node»; [ADR-0056](../../../docs/adr/0056-windows-checks-and-two-sessions.md) «Windows checks and two sessions»; [docs/roadmap.md](../../../docs/roadmap.md), раздел «worfy-windows — Windows-порт»; [spec.md](../spec.md)

## Что происходит

- «Готово, когда» Epic-а:
  1. на Windows-ПК владельца неподписанный установщик ставит worfy; первый запуск проходит
     проверки, установщик E3 ставит Harness plugin. Чистой Windows 11 нет — решение владельца
     2026-10-09 (spec.md, пункт 1; evidence Ticket-а 01, раздел 27): проверки «голой» машины —
     unit-test-ы Ticket-а 13 с подставленными пробами;
  2. на Windows работают Project worfy, Canvas, Session-ы, Terminal на PowerShell, Gate,
     epic-status; одна Wave Autopilot проходит целиком (implementer, gate full на Windows, PR,
     мерж);
  3. скрипты Harness на Node работают на обеих системах, bash — только в test-ах, `.gitattributes`
     держит LF в скриптах;
  4. qmd работает на Windows, или grep — явно запасной путь;
  5. на Mac ничего не сломалось — gate full на Mac зелёный.
- Ticket-ы 01–15 проверяют свои части по отдельности: на ПК владельца, где уже стоят инструменты
  разработки, в dev-сборке, с fake-агентом в e2e (`WORFY_AGENT: 'fake'`, `test/e2e/helpers.ts:130`).
  Целиком — установщик, первый запуск, Wave Autopilot из Stable copy на Windows — никто не
  проверял.
- Autopilot над worfy из dev-сборки worfy отказывает (`selfProjectRefusal`,
  `src/main/autopilot/run.ts:168`). Wave над worfy идёт из Stable copy; на путях Windows её чинит
  Ticket 12 (сборка на Windows).
- Журнал прогона Autopilot — `<папка данных>/autopilot/<run>.jsonl`
  (`src/main/autopilot/journal.ts:1`). Строки `refused-dialog` (Session просила человека) и
  `human-input` (человек вмешался) — дефект прогона (`src/shared/autopilot/journal.ts:35`, `:37`);
  `run-stopped` — прогон закончился (`:42`).
- На Windows-клоне с `core.autocrlf=true` все скрипты Harness — `w/crlf` (evidence Ticket-а 01,
  раздел 03). bash Git for Windows их выполняет (раздел 21), поэтому CRLF сам по себе в Git Bash
  незаметен — его ловит только проверка концов строк.
- Пункт 3 целиком не проверяет ни один test. `test/contract/harness-scripts.test.ts` гоняет
  `.test.sh`, но не смотрит, на чём написаны сами скрипты Harness, как их зовут `hooks.json` и
  `.mcp.json` и какие у них концы строк в рабочем дереве.
- Session на Windows не может прогнать gate full на Mac. Session-ы общаются через репозиторий (Q25,
  ADR-0056). PR с общим кодом Session на Windows помечает `needs-mac-gate` и пишет в нём раздел
  «Mac checks»; вливает такой PR Session на Mac командой `/worfy:gate-queue` после gate full на Mac
  и отчёта в PR (Q30, Q32, Q33; Ticket-ы 07 и 17). Session на Windows в начале каждой своей Wave
  гоняет gate full на свежем main (Q31). Целиком, в одной настоящей Wave, этот путь никто не
  проверял.
- Пометки «агенты этот Ticket не берут» нет: поле `Type` `harness/bin/ticket` читает только как
  строку шапки (`harness/bin/ticket:185`). Приёмка E3
  ([Ticket 26](../../worfy-harness/issues/26-приёмка-e3.md)) записала это правило словами; здесь так
  же.

## Что делаем

**Кто ведёт.** Autopilot этот Ticket не берёт: в нём шаги владельца — установка worfy из
неподписанного установщика (SmartScreen), Install Harness, gate full на Mac. Ведёт Orchestrator Session-и на Windows-ПК владельца. Contract
test и сбор evidence делает implementer по его брифу. На шаге владельца implementer
останавливается и пишет, какой шаг ждёт. Закрывает Ticket Orchestrator, после шагов владельца.

1. **Пункт 3 — contract test** `test/contract/harness-node-only.test.ts` (новый). Идёт в
   `pnpm test`: в CI на Linux, в gate на Mac и на Windows. Проверяет:
   - каждый файл `harness/bin` и `harness/hooks` вне папок `tests` — `.mjs`, `.js`, `.json`, `.md`
     или файл с первой строкой `#!/usr/bin/env node`; shebang с `bash`, `zsh` или `sh` — ошибка с
     именем файла;
   - каждая команда в `harness/hooks/hooks.json` начинается с `node `; сервер в `harness/.mcp.json`
     — с командой `node`;
   - мост Limits (файл Ticket-а 08) — на Node;
   - `git check-attr eol` для этих файлов — `lf`; в рабочем дереве в них нет `\r\n`. На Windows-клоне
     это ловит CRLF, если `.gitattributes` (Ticket 02) что-то пропустил.
2. **Пункт 1 — установщик и первый запуск на ПК владельца.** Чистой Windows нет (решение владельца
   2026-10-09, evidence Ticket-а 01, раздел 27). Session готовит установщик из `pnpm package` на ПК
   владельца (имя файла — Ticket 12) и его SHA-256. Владелец ставит worfy (SmartScreen: More info →
   Run anyway), открывает экран первого запуска и жмёт Install Harness. Проверки «голой» машины
   (нет Git for Windows, node, gh) — unit-test-ы Ticket-а 13 с подставленными пробами; этот Ticket
   сверяет, что они в `pnpm test` и зелёные.

   Если Smart App Control в состоянии «On» блокирует установщик — стоп. Вопрос подписи идёт
   владельцу сразу (Q22). Выключать Smart App Control агенты не предлагают. На ПК владельца он
   выключен (evidence Ticket-а 01, разделы 02 и 27). `jq` на Windows не требуется: строка `jq` на
   экране первого запуска — `warn` (решение владельца 2026-10-09, Ticket 13). Снимки — в Итог.
3. **Пункт 2 — ПК владельца, Stable copy.**
   - Project worfy открыт, Canvas показывает Epic-и и Ticket-ы (epic-status), Session отвечает и
     зовёт Bash tool, Terminal Node на PowerShell, `gate fast` в worktree worfy — код 0.
   - Wave Autopilot над worfy из Stable copy. Ticket для Wave выбирает Orchestrator: открытый
     Ticket с кодом, не платформенный и не из `worfy-link` (его ведёт Session на Mac, ADR-0056). Перед
     Wave — проверка открытых PR `worfy-link` на общие файлы (skill `epic-wave`, Ticket 07). Если
     такого Ticket-а нет — вопрос владельцу, какой Ticket гнать. Свой Ticket агенты не выдумывают.
   - Wave проходит целиком: gate full на свежем main в начале Wave (Q31), implementer, gate full
     на Windows, PR, мерж. PR с меткой `needs-mac-gate` — с разделом «Mac checks»; вливает его
     Session на Mac командой `/worfy:gate-queue` (Autopilot на Mac или «Process gate queue»), с
     отчётом в PR (Q32, Q33).
4. **Пункт 4 — qmd или grep**, по пути, который выбрал Ticket 15 (qmd на Windows). На ПК владельца,
   в установленном worfy из пункта 1, агент Session-а на вопрос об ADR находит файл в `docs/adr`: через
   `mcp__plugin_worfy_qmd__query` или grep-ом, и экран первого запуска говорит, какой путь.
5. **Пункт 5 — Mac.** Session на Windows пишет просьбу в `HANDOFF.md`, раздел «Ждёт владельца»:
   `GATE_SCOPE=all` gate full на Mac на коммите main после последнего мержа Epic-а. Делает Session
   на Mac или владелец. Результат — в Итог.
6. **Закрытие.** Evidence — в `../evidence/16-*`. `HANDOFF.md`: Epic `worfy-windows` закрыт, что
   ушло в долг.

ADR не нужен: Ticket проверяет решения ADR-0054, ADR-0055 и ADR-0056, новых не принимает.

**Не входит:** подпись установщика и репутация SmartScreen (E4); arm64 (Q24 — позже); Linked
machines (`worfy-link`).

## Готово, когда

- [x] Планка (решение владельца 2026-10-23, Q1 «а»): gate full на Windows полностью зелёный, не «нет новых красных против main»; красные пересчёта 2026-10-23, которые повторяются каждый раз, исправлены в Epic-е (106, 109–112), flaky — в `worfy-polish` 41 (Q2).
- [ ] Пункт 3: `pnpm test harness-node-only` — код 0 на Mac, на ПК владельца и в CI на Linux. Контрольный шаг: копия `harness/bin` во временной папке с подложенным скриптом `#!/bin/bash` — test называет этот файл и красный.
- [ ] Пункт 3: `git ls-files --eol harness scripts` на Windows-клоне — у каждого скрипта `w/lf`. Вывод — в Итог.
- [ ] Пункт 1 (шаг владельца): на ПК владельца неподписанный установщик поставил worfy; экран первого запуска — все строки `ok` (`warn` — только PowerShell, архитектура, `jq` или qmd по пути Б Ticket-а 15); после Install `claude plugin list --json` показывает `worfy` включённым и с версией сборки. Снимки — `../evidence/16-установка.png`, `../evidence/16-первый-запуск.png`. Unit-test-ы «голой» машины Ticket-а 13 (`test/unit/first-run-windows.test.ts`) — в `pnpm test`, зелёные.
- [ ] Пункт 2: на ПК владельца из Stable copy — Canvas с Epic-ами worfy, ответ Session с вызовом Bash tool, Terminal Node с выводом `$PSVersionTable.PSEdition`, `gate fast` в worktree — код 0. Снимки — `../evidence/16-canvas.png`, `../evidence/16-session.png`, `../evidence/16-terminal-powershell.png`.
- [ ] Пункт 2, Wave: выбранный Ticket — `done`, его PR влит. В журнале прогона нет строк `refused-dialog` и `human-input`, последняя строка — `run-stopped`. Вердикт gate full на Windows в этой Wave — «зелено». Номер Ticket-а, PR, путь журнала и вердикт — в Итог.
- [ ] Пункт 2, путь needs-mac-gate (Q31–Q33, Ticket-ы 07 и 17): отчёт Wave начинается с gate full на свежем main на ПК владельца — вердикт «зелено» стоит раньше раздачи Ticket-ов. Если PR Wave получил метку `needs-mac-gate`: в его описании есть раздел «Mac checks»; влит он Session на Mac через `/worfy:gate-queue` после её отчёта в PR (первая строка `Mac checks report: green`); мерж позже отчёта. Без метки — в Итог причина: все файлы PR — из `exempt`. Строка вердикта, ссылки на раздел и отчёт — в Итог.
- [ ] Пункт 4: по пути Ticket-а 15 агент нашёл ADR через qmd или grep-ом в установленном worfy на ПК владельца. Выдержка из транскрипта (вызов инструмента и найденный файл) — в Итог.
- [ ] Пункт 5: `GATE_SCOPE=all` gate full на Mac на коммите main после последнего мержа Epic-а — код 0 и вердикт «зелено». Кто прогнал, коммит и строка `[gate]` — в Итог.
- [ ] `GATE_SCOPE=all` gate full на ветке с contract test-ом — код 0 на ПК владельца и на Mac (по правилу needs-mac-gate: проверяет и вливает Session на Mac).

Пошаговый гайд для владельца: [owner-acceptance-guides.md](../../owner-acceptance-guides.md#worfy-windows-16)

## Тесты

Сначала падающий test — контрольный шаг `test/contract/harness-node-only.test.ts`: копия
`harness/bin` с подложенным `#!/bin/bash`. До этого Ticket-а test-а нет — запуск падает; после — он
красный на подложенном файле и зелёный на настоящем `harness/`. В Итог — как он падал.

- `test/contract/harness-node-only.test.ts` — новый: пункт 3; идёт в `pnpm test` везде.

Пункты 1, 2, 4 и 5 — проверка на живых машинах с evidence; в `pnpm test` и CI они не входят: им
нужны вход владельца, настоящий агент и Limits.

## Где в коде

- `test/contract/harness-node-only.test.ts` — новый
- `.scratch/worfy-windows/evidence/16-установка.png` — новый
- `.scratch/worfy-windows/evidence/16-первый-запуск.png` — новый
- `.scratch/worfy-windows/evidence/16-canvas.png` — новый
- `.scratch/worfy-windows/evidence/16-session.png` — новый
- `.scratch/worfy-windows/evidence/16-terminal-powershell.png` — новый
- `HANDOFF.md`

Ticket последний в Epic-е, с другими Ticket-ами он не пересекается. Ticket, который гонит Wave
пункта 2, меняет свои файлы своим PR.

## Итог

Заполняется при закрытии.

Планка gate full (2026-10-31): первый полностью зелёный gate full на ПК — `main` `15932ac9`, exit 0, 3295 s,
`[gate] green (full): worfy/.:lint worfy/.:typecheck worfy/.:test worfy/.:test:e2e worfy/.:test:package`; vitest
10877 passed, e2e 362 passed, package 16 passed, 0 failed. Пропущены по Windows exception (`worfy-windows` 117; решение
владельца Q1/Q9 2026-10-31: зелёный с такими исключениями засчитывается) два test-а: `test/contract/terminal-windows.test.ts`
и `test/contract/workflow-branches-gone.test.ts`, срок до 2026-12-15. Один зелёный прогон: на 8 workers красные раньше
приходили по одному новому test-у, следующие gate full могут снова покраснеть.

Пункт 3 (2026-11-02, ПК): `test/contract/harness-node-only.test.ts`, 15 test-ов, код 0 на ПК. Проверки берут корень, на
который смотрят. Контрольные случаи гоняют их на копии `harness/bin`, `harness/hooks` и `harness/.mcp.json` во временной
папке: подложенный `harness/bin/planted` с `#!/bin/bash` → «harness/bin/planted: a shell script (#!/bin/bash)». Так же
названы `.py` без shebang, CRLF, сервер `.mcp.json` на `bash` и команды hook-а: скрипт по пути, цепочка после node и
после запуска gate, `.sh` за node, черновик `worktree-create.sh`. Мутанты на настоящем дереве ПК, каждый — код 1 с
именем файла: `#!/bin/bash` в `harness/bin`; CRLF в `harness/bin/ticket`; `.gitattributes` без `eol=lf` для `harness/**`
(«eol unspecified»); команда hook-а `stop.mjs` без node; команда hook-а с `worktree-create.sh`; цепочка `; bash x.sh`
после node; сервер qmd в `.mcp.json` на `bash`. До этого Ticket-а файла test-а не было.
- Исключения, решено Orchestrator-ом 2026-11-02, без владельца:
  1. `harness/hooks/gate.sh` остаётся на bash: это запуск gate, который должен сказать «node not found», поэтому
     сам не может зависеть от node (решение 2026-10-14 в шапке файла). Команды `TaskCompleted` и `TeammateIdle` в
     `hooks.json` зовут его — единственная форма команды hook-а не через node.
  2. `harness/hooks/worktree-create.sh` остаётся на bash, пока не зарегистрирован: test красный, если любая команда
     hook-а его запускает.
  3. `.cjs` — Node (`harness/hooks/eval-env.cjs`).
  Список исключений в test-е: у каждой записи причина; test проверяет, что оба файла есть и что без списка оба названы.
- `git ls-files --eol harness scripts` на Windows-клоне (`core.autocrlf=true`, main `c22e29d0`): все 373 файла `w/lf`;
  вывод — [`../evidence/16-ls-files-eol.txt`](../evidence/16-ls-files-eol.txt).
- Вне пункта (находка ревью): в `harness/evals/**` и `harness/evals-outcome/**` вне папок `tests` лежат 17 shell-файлов
  (`scaffold.sh` и другие). Тикет проверяет только `harness/bin` и `harness/hooks`.

Пункт 1 (2026-11-02, ПК): установщик `worfy Setup 0.3.0.exe` из `pnpm package` на main `c22e29d0`, SHA-256
`b222a08b7c6ae11b8efc2d79e422caf773b9fa8a3433a40c21c94ff962c08e94`. Владелец поставил его в `%LOCALAPPDATA%\Programs\worfy`.
После Replace Harness в шапке `claude plugin list --json` показывает `worfy@worfy-harness` `0.3.0+c22e29d0`, enabled:
[`../evidence/16-claude-plugin-list.json`](../evidence/16-claude-plugin-list.json). 2026-11-03 обе копии обновлены до
`bacbbcef`, установщик SHA-256 `d0468532b04da41709e54c28f5683a8d4daf98eeb68a68934e8686e485d8c0f8`; plugin list —
`0.3.0+bacbbcef`, enabled: [`../evidence/16-claude-plugin-list-bacbbcef.json`](../evidence/16-claude-plugin-list-bacbbcef.json).
- Не сделано: экрана первого запуска нет. Установленная копия делит данные пользователя со Stable copy, которая уже
  настроена, поэтому worfy сразу открывает Canvas. Снимков `16-установка.png` и `16-первый-запуск.png` нет.
- `test/unit/first-run-windows.test.ts` лежит в `test/unit` и входит в `pnpm test`. Шаг `test` gate full на ПК зелёный на
  main `9c81e5b0` и `2644e70c`; отдельной строки по этому файлу в выводе gate нет.

Пункт 2 (2026-11-03, ПК; снимки делал владелец, computer use выключен):
- Копия: установленная из `Programs\worfy`, `v0.3.1339`, Harness `0.3.0+bacbbcef`, а не Stable copy, как требует пункт.
- Canvas с Epic-ами worfy (worfy-multi-vendor 36/45, worfy-throughput 57/60, строка Done):
  [`../evidence/16-canvas-worfy-epics.webp`](../evidence/16-canvas-worfy-epics.webp). Это проект Mac, видный через связь машин. Своего Project worfy на ПК нет, поэтому эта часть пункта не закрыта.
- Session в локальном проекте ПК (stolyar) вызвала Bash tool: `MINGW64_NT-10.0-26300`, `/f/SWE/basiz-stolyar/stolyar`,
  `5eb1ff8`. Сам вызов на снимке свёрнут, виден вывод: [`../evidence/16-session-bash.webp`](../evidence/16-session-bash.webp).
- Terminal `pwsh.exe`: `$PSVersionTable.PSEdition` → `Core`:
  [`../evidence/16-terminal-pwsh.webp`](../evidence/16-terminal-pwsh.webp).
- `gate fast` в worktree на main `31ea6aae`: код 0, зелёный, 134.1 s, `[gate] green (fast): worfy/.:lint worfy/.:typecheck`:
  [`../evidence/16-gate-fast.txt`](../evidence/16-gate-fast.txt), [`../evidence/16-gate-fast.log`](../evidence/16-gate-fast.log).
- Сброс GPU: окно установленной копии потеряло картинку после установщика NVIDIA Broadcast и вернулось после перезапуска
  worfy ([`../evidence/16-window-after-restart.webp`](../evidence/16-window-after-restart.webp)). Это наблюдение, а не
  дефект worfy, если без установщика NVIDIA не повторится. Захват экрана computer use зависал до перезагрузки ПК.
- Wave Autopilot не начата: ждёт Project worfy на ПК из чистого клона; добавляет его и жмёт Run wave владелец.
