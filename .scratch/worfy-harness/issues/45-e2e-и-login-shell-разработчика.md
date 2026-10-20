# 45 — e2e запускают login shell разработчика при каждом старте приложения; вызов `profile` под `WORFY_GH` идёт с окружением процесса worfy

Type: task
Status: claimed 2026-10-20T01:09Z
Branch: worfy-harness/45
Blocked by:
Source: ревью PR #305 (Ticket [37](37-скрипты-harness-из-главного-процесса-без-окружения-login-shell.md), срез 1), круг 1, 2026-10-14 — замечания low «e2e и login shell машины» и «переопределения только на процессе worfy … один вызов под `WORFY_GH`»; «Риски» Ticket-а 37 («e2e начинают зависеть от login shell машины»). Срез 2 Ticket-а 37 (PR #311, head `57e9422`) не меняет `test/e2e/helpers.ts` и `src/main/ipc/checks.ts`. Код перечитан по main `1c1beadd`.

## Что происходит

- **e2e отдают приложению всё окружение процесса test-а.** `launchApp`
  (`test/e2e/helpers.ts:121`) копирует `process.env` (`:133-136`) и добавляет переменные `WORFY_*`
  (`:137-153`). `SHELL` и `HOME` он не задаёт: их задают 12 файлов `test/e2e` (11 spec-ов и
  `terminal-ai-helpers.ts`) из 67 spec-ов.
- **С PR #305 каждый старт приложения с открытым Project-ом запускает `$SHELL -ilc` разработчика**
  (захват окружения для скриптов Harness, `src/main/harness/script-env.ts:28`). На Mac ревью это
  0,34–0,36 s на старт. Shell медленнее примерно 5 s валит
  `test/e2e/sidebar-sections.spec.ts:165`: `toHaveCount` ждёт с пределом по умолчанию (5 s;
  `playwright.config.ts` его не меняет). Результат e2e зависит от rc-файлов машины.
- **`WORFY_GH` меняет не только `gh`.** Под этой переменной (подмена `gh` в test-ах; e2e задают её
  всегда, `helpers.ts:142`) бейджи PR берут окружение процесса worfy и для `gh`, и для
  `bin/profile` (`profile --field github.account`): `src/main/ipc/checks.ts:152-161`, строка —
  `:158-159`. Без `WORFY_GH` оба идут с окружением login shell. Значит, ни один e2e не проверяет,
  что этот вызов `profile` получает окружение login shell. «Sign in with gh» устроен так же
  (`src/main/ipc/projects.ts:133-136`), но там окружение нужно только самому `gh`.

## Что делаем

1. **`launchApp` задаёт `SHELL` по умолчанию** — быстрый и предсказуемый (`/bin/sh` или
   shell-подмена из `test/fixtures`), а spec, который проверяет login shell, задаёт свой через
   `options.env`, как сейчас. `HOME` — решение исполнителя с записью в «Итог»: свой временный `HOME`
   отрезает rc-файлы разработчика совсем, но меняет пути, которые e2e могут ждать.
2. **Переменная только для test-ов не вводится** без нужды: если она всё же понадобится, она не
   действует в приёмке E3 (`test/acceptance`) — «Риски» Ticket-а 37.
3. **`WORFY_GH` подменяет только программу `gh`.** `bin/profile` в `appPrs` идёт с окружением login
   shell всегда (`harnessScriptEnv`), как остальные скрипты Harness. Окружение самого `gh` под
   `WORFY_GH` — прежнее.
4. **Замер:** время `pnpm test:e2e` до и после на Mac — в «Итог».

## Готово, когда

- [ ] e2e без `SHELL` в spec-е не запускает login shell разработчика: проверка — shell-подмена,
      которая пишет файл при запуске, первой в `PATH`/`SHELL` не вызвана (или способ исполнителя,
      записанный в «Итог»).
- [ ] Contract test `appPrs` (или его фабрики): `WORFY_GH` задан — `profile` получает окружение из
      `harnessScriptEnv`, `gh` — окружение процесса.
- [ ] `test/e2e/finder-path.spec.ts` и `test/e2e/first-run.spec.ts` (они задают `SHELL` сами)
      зелёные без изменений.
- [ ] Замер `pnpm test:e2e` до и после — в «Итог».
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` — exit 0 на Mac; `gate full`
      зелёный; Linux CI зелёный.

## Тесты

- Мутант: `appPrs` снова отдаёт `process.env` для `profile` под `WORFY_GH` — contract test красный.
- Мутант: `launchApp` без `SHELL` по умолчанию — проверка пункта 1 красная.

## Где в коде

- `test/e2e/helpers.ts:121`, `:133-153`.
- `test/e2e/sidebar-sections.spec.ts:164-168`.
- `src/main/ipc/checks.ts:152-161`.
- `src/main/ipc/projects.ts:133-136`.
- `src/main/harness/script-env.ts:28`.

## Вне скоупа

- e2e на Windows и подмена `gh` там — Epic `worfy-windows`, Ticket 14.
- Захват окружения (фоновый процесс, запасной PATH) — [Ticket 43](43-захват-login-shell-фоновый-процесс-и-запасной-path.md).

## Риски

- **Свой `HOME` в `launchApp`** может сломать e2e, которые ждут файлы под настоящим `HOME`
  (например, Harness, установленный на машине). Поэтому `HOME` — отдельное решение пункта 1.
- **Приёмка E3** запускает приложение как пользователь и должна видеть настоящий login shell:
  изменения `launchApp` её не трогают: приёмка запускает приложение сама
  (`test/acceptance/e3.spec.ts:227`).

## Итог

—
