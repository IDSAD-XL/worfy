# 05 — Создание Demo project одной кнопкой

Type: task
Status: open
Blocked by: 03, 04, 11
Source: решения владельца 2026-10-26, пункты 2 (шаг «Open the demo project» — одна кнопка), 5 (локальный репозиторий в домашней папке, на Windows не в `%TEMP%`, Profile `worfy-demo` на установленном Harness), 6 (по умолчанию подешевле), 8 (macOS и Windows одинаково); [spec.md](../spec.md), «Решено без владельца», Р5, Р6, Р13 (решено без владельца, подтвердить)

## Что происходит

- Сегодня Project появляется только через «Add project» (`src/renderer/shell/sidebar/ProjectsSection.tsx:401`):
  папка → режим → проверка Harness → черновик Profile от агентской Session → форма → запись
  `bin/project-connect` (`src/main/projects/connect.ts`, `ProjectConnector`, `:487`; запись —
  `write`, `:653`) → `ProjectStore.add` (`src/main/projects/store.ts:262`).
- Для demo черновик Session не нужен: шаблон и черновик Profile даёт Ticket 04
  (`src/main/getting-started/demo-template.ts`). `--no-qmd` и `--remove` даёт Ticket 03, пометку
  `localOnly` у Project-а — Ticket 11.
- Скрипт Harness запускается через `connectScriptRunner` (`connect.ts:138`) с окружением скриптов
  Harness (`src/main/harness/script-env.ts`).
- Модель и effort Session Node-а хранит `SessionSettingsStore`
  (`src/main/agent/session-settings.ts:64`) по id Node-а; Node Orchestrator-а создаёт
  `orchestrator.open` (`src/shared/ipc/orchestrator.ts:82`).
- Домена IPC для Getting started нет. Модули handler-ов main находит сам
  (`src/main/ipc/index.ts:62`, `import.meta.glob`).

## Что делаем

1. Новый домен IPC `gettingStarted` (`src/shared/ipc/getting-started.ts`, `src/main/ipc/getting-started.ts`),
   каналы с пометкой `local`. Этот Ticket — канал `gettingStarted.createDemo` → `{ ok: true, projectId,
   path } | { ok: false, reason }` и событие хода `gettingStarted.createProgress` (строка шага).
2. Состояние — `src/main/getting-started/state.ts` (новый): файл `getting-started.json` в `dataRoot()`
   (`src/main/storage/paths.ts:35`), запись атомарная, как `writeMark` (`src/main/ipc/first-run.ts:168-175`).
   Этот Ticket кладёт туда `demo: { projectId, path, profile, cost }`; остальное добавляет Ticket 06.
3. `src/main/getting-started/demo.ts` (новый), `createDemo(deps)`; домашняя папка, временная папка,
   git, скрипт Harness и хранилища — через `deps`, чтобы test-ы шли во временной папке:
   1. Папка (Р6): `<home>/worfy-demo`, занята — `-2`, `-3`…; путь внутри `tmpdir` — отказ всегда.
   2. Уже есть наш demo (запись `demo` и папка на месте) — ответ с ним, ничего не создаётся.
   3. Файлы шаблона → `git init -b main` → `git add -A` → commit «Demo project» автором из
      `git config`. Нет автора — отказ с той же подсказкой, что проверка `git-identity` First run
      (`src/main/first-run/checks.ts`, `GIT_IDENTITY_COMMANDS`, `:469`).
   4. `bin/project-connect --no-qmd` с черновиком шаблона. Exit 2 (Harness не знает `--no-qmd`) —
      отказ «Update the Harness first: …» (риск 2 spec-а). Имя `worfy-demo` занято не нашим
      Profile-ем — отказ с причиной, ничего не переписывается.
   5. `ProjectStore.add(path, { localOnly: true })`, Demo project — активный.
   6. Node Orchestrator-а Demo project создаётся тем же путём, что `orchestrator.open`; его
      настройки — Sonnet, effort medium (Р5). Сообщение Orchestrator-у не отправляется.
   7. Запись `demo` в состояние.
   Сбой на шаге 3–6 откатывает сделанное этим вызовом: `project-connect --remove`, `ProjectStore.remove`,
   папка — только если её создал этот вызов. Причина — в ответе.
4. Шаги идут по одному; второй вызов, пока первый идёт, ждёт его и получает тот же ответ.

## Готово, когда

- [ ] Contract test: во временной домашней папке и временной `HARNESS_HOME` — папка `worfy-demo` с
      файлами шаблона и одним commit-ом; `bin/profile -C <папка> --name` — `worfy-demo`; Project в
      `projects.json` с `localOnly`, активный; настройки Orchestrator-а — Sonnet, medium; запись `demo`.
- [ ] Папка `worfy-demo` занята чужим — создаётся `worfy-demo-2`.
- [ ] `home` внутри `tmpdir` (как `%TEMP%` на Windows) — отказ, на диске ничего.
- [ ] Сбой `project-connect` (подменённый скрипт с exit 1) — папки нет, Profile нет, Project-а в списке
      нет; причина в ответе.
- [ ] Нет автора git — отказ с командой `git config --global user.name …`.
- [ ] Повторный вызов при живом demo — тот же Project, без второй папки.
- [ ] (вручную) dev-сборка над временной папкой данных: «Create demo project» (кнопка — Ticket 07; до
      него — вызов канала из DevTools) создаёт Project, Canvas показывает Epic `todo` и Ticket `01`.
- [ ] Платформенный PR (ADR-0056, пункт 2; пути и папки Windows): вердикт Windows — gate full на ПК,
      код 0 и строка `[gate] green (full)`; на ПК demo создаётся в `C:\Users\<имя>\worfy-demo`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full — exit 0 и строка
      `[gate] green (full)` (оркестратор перед merge).

## Тесты

- Contract `test/contract/getting-started-demo.test.ts` (новый): настоящий `harness/bin/project-connect`
  во временной `HARNESS_HOME`, настоящий git, `home` и `tmpdir` — параметры `deps`, а не переменные
  окружения: test-ы сами живут в временной папке ОС.
- Сначала падающий: вызов `gettingStarted.createDemo` — канала нет.

## Где в коде

- `src/main/getting-started/demo.ts` (новый)
- `src/main/getting-started/state.ts` (новый)
- `src/shared/ipc/getting-started.ts` (новый)
- `src/main/ipc/getting-started.ts` (новый)
- `test/contract/getting-started-demo.test.ts` (новый)

Только читать: `src/main/getting-started/demo-template.ts`, `src/main/projects/store.ts`,
`src/main/projects/connect.ts`, `src/main/agent/session-settings.ts`, `src/main/agent/orchestrator.ts`,
`src/main/storage/paths.ts`, `src/main/ipc/first-run.ts`.

## Итог

Заполняется при закрытии.
