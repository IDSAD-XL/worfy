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
  - evidence: gate pass · gate full GATE_SCOPE=all на ПК (простаивал), origin/main a0d72a4f1: EXIT 0, 3875.3 s, [gate] green (full): worfy/.:lint worfy/.:typecheck worfy/.:test worfy/.:test:e2e worfy/.:test:package; vitest 15018 passed 0 failed, e2e 426 passed 0 failed, package 21 passed; run c848baa6/2026-11-06T16-25-37Z-44448 · windows - · a0d72a4f1e5184071b77fbfd0337742b9ba6b977
- [x] Пункт 3: `pnpm test harness-node-only` — код 0 на Mac, на ПК владельца и в CI на Linux. Контрольный шаг: копия `harness/bin` во временной папке с подложенным скриптом `#!/bin/bash` — test называет этот файл и красный. — на Mac вместо прогона на машине владельца: job `macos-tests` в `ci-ok` (ADR-0083, пункт 5) и
  прогон ревью #1231 на macOS, 15/15.
  - evidence: test-run pass · ПК 2026-11-02: test/contract/harness-node-only.test.ts 15 passed, exit 0; мутанты (#!/bin/bash, CRLF, .gitattributes без eol=lf, команды hook-а, сервер на bash) — exit 1 с именем файла · windows - · f6f184e424d756df6c46818ad2d522673b49b198
  - evidence: ci-check pass · CI run 42251826160, job linux-tests (3/4) 128008754459 success: harness-node-only.test.ts 15 tests passed · linux ci · a0d72a4f1e5184071b77fbfd0337742b9ba6b977
  - evidence: ci-check pass · CI run 42251826160, job macos-tests 128008754452 success: harness-node-only.test.ts 15 tests passed (вместо Mac владельца, ADR-0083, пункт 5) · mac ci · a0d72a4f1e5184071b77fbfd0337742b9ba6b977
  - evidence: review pass · ревью #1231 на Mac: 15/15 на macOS, мутанты красные с именем файла (комментарий VERIFIED, 2026-11-02) · - - · f6f184e424d756df6c46818ad2d522673b49b198
- [x] Пункт 3: `git ls-files --eol harness scripts` на Windows-клоне — у каждого скрипта `w/lf`. Вывод — в Итог.
  - evidence: test-run pass · концы строк harness и scripts на Windows-клоне (ls-files --eol, core.autocrlf=true): 373 файла w/lf — `../evidence/16-ls-files-eol.txt` · windows - · c22e29d01a1a116e094c48e4f607cb6230ea3472
- [x] Пункт 1 (шаг владельца): на ПК владельца неподписанный установщик поставил worfy; экран первого запуска — все строки `ok` (`warn` — только PowerShell, архитектура, `jq` или qmd по пути Б Ticket-а 15); после Install `claude plugin list --json` показывает `worfy` включённым и с версией сборки. Снимки — `../evidence/16-установка.png`, `../evidence/16-первый-запуск.png`. Unit-test-ы «голой» машины Ticket-а 13 (`test/unit/first-run-windows.test.ts`) — в `pnpm test`, зелёные. — снимка `16-установка.png` нет: владелец засчитал установку 2026-11-02 без него (2026-11-06,
  шаг 1 гайда, «1-2 да»).
  - evidence: owner-check pass · владелец 2026-11-06, шаг 1 гайда «1-2 да»: установка worfy Setup 0.3.0.exe 2026-11-02 засчитана без снимка установщика · windows installed · c22e29d01a1a116e094c48e4f607cb6230ea3472
  - evidence: screenshot pass · `../evidence/16-первый-запуск.png` — Stable copy с пустой папкой данных: все строки OK · windows stable · 3c9518a6488353e91705b1bea0b1b1a8c3107c64 · scrub: 2026-11-06
  - evidence: screenshot pass · `../evidence/16-первый-запуск-qmd.png` — конец списка: jq OK, Harness plugin 0.3.0+3c9518a6 OK, одно предупреждение — qmd not installed (поиск grep-ом) · windows stable · 3c9518a6488353e91705b1bea0b1b1a8c3107c64 · scrub: 2026-11-06
- [x] Пункт 2: на ПК владельца из Stable copy — Canvas с Epic-ами worfy, ответ Session с вызовом Bash tool, Terminal Node с выводом `$PSVersionTable.PSEdition`, `gate fast` в worktree — код 0. Снимки — `../evidence/16-canvas.png`, `../evidence/16-session.png`, `../evidence/16-terminal-powershell.png`. — Terminal и `gate fast` из установленной копии 2026-11-03 владелец засчитал (2026-11-06, шаг 2
  гайда, «1-2 да»); снимок Terminal — `../evidence/16-terminal-pwsh.webp`.
  - evidence: screenshot pass · `../evidence/16-canvas.png` — Stable copy v0.3.1538, Project worfy-w16 (клон main b624f440), Canvas с Epic-ами и Ticket-ами worfy · windows stable · 3c9518a6488353e91705b1bea0b1b1a8c3107c64 · scrub: 2026-11-06
  - evidence: screenshot pass · `../evidence/16-session.png` — ответ Session с вызовом Bash tool и строкой b624f440 (#1486) · windows stable · 3c9518a6488353e91705b1bea0b1b1a8c3107c64 · scrub: 2026-11-06
  - evidence: screenshot pass · `../evidence/16-stable-canvas-worfy.webp` — Stable copy v0.3.1403, Canvas с Epic-ами worfy (2026-11-04) · windows stable · b09dfab09b4f23ceecaa114c8e34aa6826cb4eeb · scrub: 2026-11-06
  - evidence: gate pass · gate fast в клоне worfy из Stable copy, GATE_SCOPE=all, 1430.7 s, [gate] green (fast): `../evidence/16-gate-fast-stable-b09dfab0.log` · windows - · b09dfab09b4f23ceecaa114c8e34aa6826cb4eeb
  - evidence: owner-check pass · владелец 2026-11-06, шаг 2 гайда «1-2 да»: Terminal pwsh.exe (PSEdition Core) и gate fast из установленной копии 2026-11-03 засчитаны · windows installed · bacbbcef4c8aa4ec1edd07da1e76cfd4b52ed707
- [x] Пункт 2, Wave: выбранный Ticket — `done`, его PR влит. В журнале прогона нет строк `refused-dialog` и `human-input`, последняя строка — `run-stopped`. Вердикт gate full на Windows в этой Wave — «зелено». Номер Ticket-а, PR, путь журнала и вердикт — в Итог. — gate full самой Wave красный только flaky test-ами под
  нагрузкой: засчитано по ADR-0086, пункт 3, и чистому gate full на `a0d72a4f1`; после `run-stopped` по
  ADR-0029 пишется `orchestrator-returned`. Подробно — в Итог.
  - evidence: commit pass · #1500 (worfy-polish 48) влит Wave-ом Autopilot на ПК 2026-11-06T15:09:05Z; docs #1504 e832f0fad; polish 48 done · - - · 022657ee4535ccb1d76c1b63a9ab307a4578feec
  - evidence: owner-check pass · Run 2026-11-06T11-47-32-575Z-bc80b1, журнал на ПК (Stable copy): нет refused-dialog и human-input; run-stopped 16:15:10Z background-stalled (дефект: worfy-polish 61), потом orchestrator-returned по ADR-0029; первый Run 11-46-13-969Z-84de3a остановил владелец (случайно два Ticket-а) · windows stable · 3c9518a6488353e91705b1bea0b1b1a8c3107c64
  - evidence: test-run pass · красные gate full Wave-а на e832f0fad (exit 2, 3725 s, под нагрузкой) — каждый зелёный в одиночку на простаивающем ПК: codex-app-server:304, projects-connect:1387, linked-add-project:207 и :272, linked-machines:417, terminal:667; flaky по ADR-0086, пункт 3 · windows - · e832f0fadfc11c09b7a669ac832db13aa2e8b842
  - evidence: gate pass · gate full GATE_SCOPE=all на ПК (простаивал) после #1500, origin/main a0d72a4f1: EXIT 0, 3875.3 s, [gate] green (full), 0 failed; run c848baa6/2026-11-06T16-25-37Z-44448 · windows - · a0d72a4f1e5184071b77fbfd0337742b9ba6b977
- [x] Пункт 2, путь needs-mac-gate (Q31–Q33, Ticket-ы 07 и 17): отчёт Wave начинается с gate full на свежем main на ПК владельца — вердикт «зелено» стоит раньше раздачи Ticket-ов. Если PR Wave получил метку `needs-mac-gate`: в его описании есть раздел «Mac checks»; влит он Session на Mac через `/worfy:gate-queue` после её отчёта в PR (первая строка `Mac checks report: green`); мерж позже отчёта. Без метки — в Итог причина: все файлы PR — из `exempt`. Строка вердикта, ссылки на раздел и отчёт — в Итог. — заменено ADR-0083, пункт 5
  (решение владельца 2026-10-28; меняет ADR-0069, пункты 1–4), и ADR-0086, пункты 1–2: очереди
  `needs-mac-gate` и поля `cross_machine_gate` нет с 2026-10-28; PR Wave вливается по `ci-ok` и
  `review`, gate full на ПК идёт на `main` после Wave. Причина — в Итог.
  - evidence: review pass · заменено ADR-0083, пункт 5, и ADR-0086, пункты 1–2: очереди needs-mac-gate и cross_machine_gate нет с 2026-10-28; PR Wave #1500 без метки, ci-ok success и review success на head adbf163f7; gate full на ПК на main после Wave зелёный (a0d72a4f1) · - - · adbf163f7dcf3aa475315342594a880e7a1d0d59
  - evidence: ci-check pass · PR Wave #1500 влит по ci-ok и review (ADR-0083, пункт 5): ci-ok success, windows full-suite и windows-e2e success на head adbf163f7 · ci ci · adbf163f7dcf3aa475315342594a880e7a1d0d59
  - evidence: gate pass · gate full на ПК на main после Wave (ADR-0086, пункт 2): origin/main a0d72a4f1, GATE_SCOPE=all, EXIT 0, [gate] green (full), 0 failed; run c848baa6/2026-11-06T16-25-37Z-44448 · windows - · a0d72a4f1e5184071b77fbfd0337742b9ba6b977
- [x] Пункт 4: по пути Ticket-а 15 агент нашёл ADR через qmd или grep-ом в установленном worfy на ПК владельца. Выдержка из транскрипта (вызов инструмента и найденный файл) — в Итог.
  - evidence: screenshot pass · `../evidence/16-adr-grep.png` — Session в Stable copy нашла docs/adr/0054-full-windows-port.md grep-ом (qmd на ПК нет): вызовы Bash profile, Grep windows, Bash head · windows stable · 3c9518a6488353e91705b1bea0b1b1a8c3107c64 · scrub: 2026-11-06
- [x] Пункт 5: `GATE_SCOPE=all` gate full на Mac на коммите main после последнего мержа Epic-а — код 0 и вердикт «зелено». Кто прогнал, коммит и строка `[gate]` — в Итог. — заменён по ADR-0083, п. 5
  (решение владельца 2026-10-28: локального gate full нет): job-ы macOS в CI на `a0d72a4f1` зелёные. Подробно — в Итог.
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/42251826160 на main a0d72a4f1: macos-tests, macos-e2e (1/2), macos-e2e (2/2), macos-package — success (вместо gate full на Mac, ADR-0083, п. 5); ci-ok этого run-а красный из-за job-а windows (1/3), не macOS: упали feature-docs-lag:233 и guide-lag:104 · ci ci · a0d72a4f1e5184071b77fbfd0337742b9ba6b977
- [x] `GATE_SCOPE=all` gate full на ветке с contract test-ом — код 0 на ПК владельца и на Mac (по правилу needs-mac-gate: проверяет и вливает Session на Mac). — заменено ADR-0083, пункт 5: #1231 влит по `ci-ok` 2026-11-02; на ПК зелёный
  чистый gate full на `a0d72a4f1` с этим test-ом, на macOS — ревью #1231 и job `macos-tests`.
  - evidence: gate pass · gate full GATE_SCOPE=all на ПК, origin/main a0d72a4f1 (с test/contract/harness-node-only.test.ts): EXIT 0, 3875.3 s, [gate] green (full), 0 failed; run c848baa6/2026-11-06T16-25-37Z-44448 · windows - · a0d72a4f1e5184071b77fbfd0337742b9ba6b977
  - evidence: ci-check pass · #1231 влит по ci-ok 2026-11-02 (ADR-0083, пункт 5): ci-ok success на head f6f184e4 · ci ci · f6f184e424d756df6c46818ad2d522673b49b198

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

**Приёмка владельцем, 2026-11-06** (ПК владельца, Stable copy `v0.3.1538`, Harness `0.3.0+3c9518a6`; шаги — по
[гайду](../../owner-acceptance-guides.md#worfy-windows-16)). Шаги владельца 1–9 пройдены, планка gate full на Windows
выполнена. Все пункты «Готово, когда» закрыты; три из них — по новым правилам, а не как написаны (ниже). Ниже —
сегодняшние факты; записи
2026-10-31…2026-11-04 после них — история, их «не сделано» закрыто здесь.

- **Планка gate full.** Чистый gate full на ПК: `GATE_SCOPE=all`, `VITEST_MAX_WORKERS=8`, `origin/main` `a0d72a4f1`.
  ПК простаивал: Session-ы Wave `idle`, Run-ов нет, загрузка 28 %. Exit 0, 3875.3 s (16:25:36–17:30:11Z),
  `[gate] green (full): worfy/.:lint worfy/.:typecheck worfy/.:test worfy/.:test:e2e worfy/.:test:package`. Шаги: lint
  47.8 s, typecheck 61.8 s, test 1553.4 s, e2e 2009.5 s, package 201.6 s. vitest 15018 passed / 454 skipped / 0 failed;
  e2e 426 passed / 22 skipped / 0 failed; package 21 passed / 1 skipped. Run gate — `c848baa6/2026-11-06T16-25-37Z-44448`.
- **Шаги 1–2 гайда — ответ владельца «1-2 да» (11:27Z).** Установка 2026-11-02 засчитана без снимка установщика
  (`16-установка.png` нет). Terminal на PowerShell (`pwsh.exe`, `PSEdition` `Core`) и `gate fast` из установленной
  копии 2026-11-03 (`bacbbcef`) засчитаны; повтора в Stable copy не нужно.
- **Шаги 3–4, пункт 1 — первый запуск.** Stable copy `3c9518a6` с пустой папкой данных (`WORFY_DATA_DIR`). Экран
  первого запуска: все строки `OK`, одно предупреждение — qmd не установлен, «Without it the Harness searches with
  grep»; `jq` — `OK`. Снимки: [`../evidence/16-первый-запуск.png`](../evidence/16-первый-запуск.png) и
  [`../evidence/16-первый-запуск-qmd.png`](../evidence/16-первый-запуск-qmd.png). `test/unit/first-run-windows.test.ts`
  идёт в `pnpm test`; шаг test чистого gate full выше — 0 failed.
- **Шаги 5–6 — Canvas.** Project worfy-w16 — чистый клон `main` на ПК (`b624f440`), добавлен через «Add project». Canvas
  с Epic-ами и Ticket-ами worfy: [`../evidence/16-canvas.png`](../evidence/16-canvas.png).
- **Шаг 7 — Session.** На `run git log -1 --oneline in Bash` Session вызвала Bash tool с этой командой и ответила
  `b624f440 epic-status --json: spec status and acceptance date; acceptedEpics (worfy-autopilot-queue 13) (#1486)`:
  [`../evidence/16-session.png`](../evidence/16-session.png). Вызов tool-а на снимке свёрнут, команда видна в его строке.
- **Шаг 8, пункт 4 — поиск ADR.** На «Find the ADR about the full Windows port» агент вызвал Bash
  `…/worfy-stable/resources/harness/bin/profile --field docs.adr_dir`, Grep `windows` и Bash
  `head -n 25 docs/adr/0054-full-windows-port.md` и ответил: «The ADR is `docs/adr/0054-full-windows-port.md`. It's
  ADR-0054, accepted on 2026-10-07». Путь — grep: qmd на ПК не установлен, первый запуск так и говорит; агент пишет «I
  found it with a text search of `docs/adr`»: [`../evidence/16-adr-grep.png`](../evidence/16-adr-grep.png).
- **Шаг 9, пункт 2 — Wave Autopilot.** Epic worfy-polish, Ticket 48 «Шапка на узком окне».
  - Первый Run `2026-11-06T11-46-13-969Z-84de3a` владелец остановил через 27 s (`human-input`, потом `run-stopped`
    `interrupted`): «случайно запустил два тикета вместо одного». Не дефект.
  - Засчитан второй Run `2026-11-06T11-47-32-575Z-bc80b1`. Журнал на ПК: `%APPDATA%\worfy\autopilot\` (папка данных
    Stable copy), `2026-11-06T11-47-32-575Z-bc80b1.jsonl`.
  - Wave сама влила PR #1500 (`022657ee4`, 15:09:05Z): на head `adbf163f7` `ci-ok` — success, отметка `review` —
    success, меток нет. Docs PR #1504 — `e832f0fad`. polish 48 — `done`.
  - Строк `refused-dialog` и `human-input` во втором Run-е нет.
  - Последняя строка Run-а — `run-stopped` в 16:15:10Z, причина `background-stalled`, задача «Run full gate on main
    merge commit». gate full самой Wave шёл дольше часа, и Run принял живую задачу за зависшую
    (`src/shared/autopilot/cycle.ts:80`). Это дефект: Ticket worfy-polish 61, заведён в #1515.
  - После неё, в 16:19:47Z, — строка `orchestrator-returned`. Так задумано (ADR-0029): Orchestrator возвращается
    человеку, когда живые задачи остановленного Run-а кончились.
  - Строка `ticket-status 48 open` в 15:15:04 — замечание, не дефект. Корень Project-а на ПК (`F:\SWE\worfy-w16`) стоял
    на `b624f440`: `origin/main` получен fetch-ем, а checkout не сдвинут, и в этом файле Ticket-а `Status: open`.
    В worktree Wave — `done`.
  - gate full самой Wave (`GATE_SCOPE=all`, `e832f0fad`) — exit 2, 3725 s, на нагруженном ПК (Run и ещё две
    Session-ы Claude). Упали: vitest `test/contract/codex-app-server.test.ts:304`,
    `test/contract/projects-connect.test.ts:1387`; e2e `linked-add-project.spec.ts:207` и `:272`,
    `linked-machines.spec.ts:417` (в подготовке test-а не сработал `icacls /remove:d`), `terminal.spec.ts:667`.
    Каждый — зелёный в одиночку на простаивающем ПК; `linked-machines:417` зелёный и до #1500 (`ceb9435e4`), и
    после. По ADR-0086, пункт 3, это flaky под нагрузкой, `main` красным не считается. Регрессии от #1500 нет;
    чистый gate full на `a0d72a4f1` (после #1500) зелёный.
- **Путь needs-mac-gate — заменён.** Очередь `needs-mac-gate` (ADR-0069, ответы владельца Q30–Q33) снята ADR-0083,
  пункт 5: решение владельца 2026-10-28 о мерже по `ci-ok`. Причина: CI на GitHub-runner-ах идёт у каждого PR, и
  то, что проверял gate full на Mac, проверяют job-ы `ci-ok` на macOS. PR с ПК вливается по `ci-ok` и отметке
  `review`, как любой PR, без раздела «Mac checks» и отчёта по нему. Переход — 2026-10-28 около 07:00 UTC, с
  первым зелёным `ci-ok` на `main` (`c43e9648`). Тогда же поле `cross_machine_gate` снято из Profile-а worfy на Mac
  (ADR-0069, Amendments 2026-10-28). gate full на ПК в начале каждой Wave (Q31) заменён ADR-0086, пункты 1–2:
  gate full на ПК идёт на `main` после Wave. Поэтому пункт сделан по новым правилам, а не как написан: #1500 —
  без метки, `ci-ok` и `review` — success на head; gate full на ПК на `main` после Wave — чистый прогон на
  `a0d72a4f1` выше.
- **Пункт 3 на Mac и в CI.** Job-ы CI run 42251826160 на `a0d72a4f1`: `linux-tests (3/4)` и `macos-tests` — success,
  в обоих `test/contract/harness-node-only.test.ts (15 tests)` ✓. Своего прогона на Mac владельца нет; вместо него —
  `macos-tests` (ADR-0083, пункт 5) и ревью #1231 на macOS (15/15, мутанты красные). #1231 влит 2026-11-02 по `ci-ok`
  с меткой `needs-mac-gate`; отчёта gate full на ветке в PR нет — правило к тому времени уже заменил ADR-0083.
- **Пункт 5, gate full на Mac — заменён по ADR-0083, п. 5** (решение владельца 2026-10-28: локального gate full
  нет, его проверки делают job-ы `ci-ok` на macOS). `GATE_SCOPE=all` gate full на Mac не гоняли. Вместо него — CI
  run [42251826160](https://github.com/IDSAD-XL/worfy/actions/runs/42251826160) на `main` `a0d72a4f1`: `macos-tests`,
  `macos-e2e (1/2)`, `macos-e2e (2/2)` и `macos-package` — success. Сам `ci-ok` этого run-а красный из-за job-а
  `windows (1/3)`, а не macOS: упали `test/unit/feature-docs-lag.test.ts:233` и `test/unit/guide-lag.test.ts:104`.
  Решил Orchestrator, 2026-11-06.
- Снимки с ПК — копии снимков владельца. Закрашены сплошными прямоугольниками: email входа и git identity, имя ПК в
  списке Projects, `C:\Users\<имя>` в путях, обрезанная полоска текста у верхнего края окна. Метаданных в PNG нет.
  Снимок Welcome-экрана в репозиторий не вошёл.

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

Пункт 2, повтор в Stable copy (2026-11-04, ПК; снимок делал владелец, computer use выключен):
- Копия: Stable copy (`%LOCALAPPDATA%\worfy-stable`), `v0.3.1403`, Harness `0.3.0+b09dfab0`.
- Canvas с Epic-ами worfy в своём Project worfy на ПК (клон `main`, ветка `main` в шапке): Epic-и worfy-terminal-ssh и
  worfy-throughput на Canvas, список Epic-ов слева. Имена машин закрашены:
  [`../evidence/16-stable-canvas-worfy.webp`](../evidence/16-stable-canvas-worfy.webp). Эта часть пункта закрыта.
- `gate fast` в этом клоне на `b09dfab0` (`GATE_SCOPE=all`; без него на чистом `main` gate пишет «nothing ran»): зелёный,
  1430.7 s, `[gate] green (fast): worfy-app/.:lint worfy-app/.:typecheck worfy-app/.:test`:
  [`../evidence/16-gate-fast-stable-b09dfab0.log`](../evidence/16-gate-fast-stable-b09dfab0.log).
- Не сделано в Stable copy: снимки Session с вызовом Bash tool и Terminal `pwsh.exe` с `$PSVersionTable.PSEdition`;
  Wave polish 48 «Шапка на узком окне» (Run wave жмёт владелец); пункт 4 (Session находит ADR через qmd или grep).
- Не сделано: экран первого запуска и снимки установщика — нужна пустая папка данных или новый пользователь Windows.
