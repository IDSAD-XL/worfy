# 02 — Экран не гаснет, пока Orchestrator вливает PR вне Autopilot; заблокированный экран перед gate full — одна строка, а не красный e2e

Type: task
Status: open
Blocked by: 01
Source: [spec.md](../spec.md), решение владельца 2026-10-16, пункт 1, и «Решено без владельца»
(Ticket сужен); ночь 2026-10-16 — мержи стояли около 5,5 h;
[ADR-0034](../../../docs/adr/0034-autopilot-keeps-display-awake.md); урок
`docs/lessons/agents.md:47-54`.

## Что происходит

- **Autopilot уже держит экран.** Прогон берёт `powerSaveBlocker` типа `prevent-display-sleep`
  (`src/main/autopilot/power.ts:19`, `src/main/autopilot/run.ts:566-567`) и отпускает на остановке и
  на `will-quit` (`power.ts:10-12`). Подсказки кнопки и строки статуса Autopilot это говорят:
  «The display stays on until the run ends» (`src/renderer/canvas/actions/AutopilotAction.tsx:60`,
  `:263`, `:305`; e2e — `test/e2e/autopilot.spec.ts:268`). Так решил ADR-0034.
- **Переключатель worfy-link — другое.** «Keep this computer awake while linked machines are
  connected» держит blocker типа `prevent-app-suspension` (`src/main/link/keep-awake.ts:4-5`, `:20`), и
  только пока подключена Linked machine и включён доступ к Project-ам (`:6-11`). Это запрет сна
  **системы**: экран при нём гаснуть может. Три разных состояния:
  - сон системы — Mac спит, ничего не идёт; от него защищают оба blocker-а;
  - сон экрана — система работает, экран погас; от него защищает только `prevent-display-sleep`;
  - блокировка — macOS блокирует экран, когда он погас или включилась заставка (настройка «Require
    password after screen saver begins or display is turned off», ADR-0034, «Контекст»). Пока экран
    заблокирован, Electron не показывает окно, и каждый e2e падает на первом окне.

  Для gate full нужен экран, поэтому переключатель worfy-link здесь не помогает, а дублировать его
  незачем.
- **Дыра — мержи вне прогона Autopilot.** Ночью 2026-10-16 прогон Autopilot `worfy-polish`
  остановился в 04:39 по местному времени (`run-stopped`, `blocked-tickets`). Оставшиеся PR (#372,
  #378, #345) вливала Session Orchestrator-а в Claude Code — не прогон worfy, blocker-а нет. Экран погас
  и заблокировался; следующий мерж — в 10:09.
- **Проверки заблокированного экрана нет ни в одном скрипте.** Есть только урок
  (`docs/lessons/agents.md:52-53`: `ioreg -n Root -d1`, `IOConsoleLocked`) — агенты делали цикл
  ожидания сами, каждый раз заново. В `harness/`, `scripts/` и `rules.md` Profile-а `IOConsoleLocked`
  не встречается.

## Что делаем

1. **`wave-gate` (Ticket 01) на macOS проверяет экран перед gate full:** `ioreg -n Root -d1`, поле
   `IOConsoleLocked`. `Yes` — одна строка `screen locked: gate full waits` и ожидание разблокировки
   (опрос раз в 30 s, Bash timeout 600000, повтор той же команды), а не запуск e2e. Экран
   заблокировался посреди gate full и e2e упали на первом окне — прогон «не удалось проверить:
   экран заблокирован», не красный, и повторяется после разблокировки. Вне macOS проверки нет.
2. **Экран держит весь процесс мержа, а не только Autopilot.** Блок «Gate before merge» skill
   `epic-wave` (Ticket 01) на macOS берёт `caffeinate -d` на время от сбора набора до последнего мержа:
   `caffeinate -d -w <pid>` с pid процесса, который живёт весь блок, — завершится сам, фоновый процесс
   не остаётся. Какой pid брать в Bash tool Claude Code, Ticket проверяет замером (`pmset -g assertions`
   — `PreventUserIdleDisplaySleep` от `caffeinate` есть во время блока и нет после). Внутри прогона
   Autopilot это ничего не меняет: blocker прогона уже держит экран.
3. **Правило в `rules.md` Profile-а worfy** (шаг Orchestrator-а после мержа, diff — в «Итог»): перед
   любым gate full и e2e на Mac — проверка `IOConsoleLocked`; при `Yes` — строка «экран заблокирован»
   и ожидание, прогон не начинается. Это правило заменяет ручной цикл каждого агента.
4. **Урок `docs/lessons/agents.md`, раздел «Ночной прогон Autopilot»** дополняется: прогон держит экран,
   а мержи вне прогона — `caffeinate` блока мержа (пункт 2); источник — ночь 2026-10-16.

## Готово, когда

- [ ] Test `wave-gate` со stub-ом `ioreg`: `IOConsoleLocked = Yes` — строка `screen locked`, gate не
      запускается; `No` — gate идёт; stub `ioreg` нет (Linux) — проверки нет, gate идёт.
- [ ] Test: красный gate, в выводе которого `the window was not shown within 30 s` при заблокированном
      экране (stub), — вердикт «не удалось проверить: экран заблокирован», не красный.
- [ ] Блок мержа skill `epic-wave` берёт `caffeinate -d -w` на macOS и не оставляет процесса после
      блока (test блока, как `harness/bin/tests/skill-blocks.test.sh`, со stub-ом `caffeinate`).
- [ ] (вручную) На Mac: во время блока мержа `pmset -g assertions` показывает
      `PreventUserIdleDisplaySleep` от `caffeinate`, после блока — нет. Вывод — в «Итог».
- [ ] (вручную, Orchestrator) правило в `rules.md` Profile-а — diff в «Итог».
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; shell test-ы Harness — exit 0; gate full —
      шаг Orchestrator-а перед merge; Linux CI зелёный.

## Тесты

- `harness/bin/tests/wave-gate.test.sh` — stub-ы `ioreg` и `caffeinate` в `PATH`.
- Сначала красный: test «экран заблокирован — gate не запускается» до правки.
- Мутанты: не проверять экран; считать падение первого окна при заблокированном экране красным; не
  передавать `-w` в `caffeinate`. Каждый краснит свой test.

## Где в коде

- `harness/bin/wave-gate`
- `harness/bin/tests/wave-gate.test.sh`
- `harness/skills/epic-wave/SKILL.md`
- `docs/lessons/agents.md`

Только читать: `src/main/autopilot/power.ts`, `src/main/link/keep-awake.ts`,
`docs/adr/0034-autopilot-keeps-display-awake.md`.
Вне репозитория (шаг Orchestrator-а): `~/.claude/worfy-harness/projects/worfy/rules.md`.

## Вне скоупа

- Код worfy: keep-awake Autopilot и переключатель worfy-link не меняются.
- Закрытая крышка и экран, заблокированный вручную, — worfy их не обходит (ADR-0034, пункт 3).
- Настройки macOS (заставка, пароль после сна экрана) — worfy и Harness их не трогают.
- Keep-awake самого Claude Code desktop: по его описанию он защищает от idle sleep; держит ли он
  экран, не проверено, поэтому на него не опираемся.

## Итог
