# 10 — Экран Done и удаление Demo project

Type: task
Status: open
Blocked by: 03, 05, 07
Source: решения владельца 2026-10-26, пункты 7 (экран «Done» с «Connect your own project» и «Remove the demo project»; удаление с подтверждением убирает папку, Profile и запись registry; сам demo не удаляется) и 8 (macOS и Windows одинаково); [spec.md](../spec.md), «Тексты (черновик)», «Экран Done»; «Решено без владельца», Р12 (решено без владельца, подтвердить)

## Что происходит

- После Ticket-а 06 шаг 6 отмечается, когда Ticket demo `done`. Экрана после шага 6 нет.
- «Remove» Project-а в боковой панели убирает только строку списка (`projects.remove`,
  `src/main/ipc/projects.ts:314-319`; `ProjectStore.remove`, `src/main/projects/store.ts:291-299`):
  папка данных worfy (`ProjectStore.dataDir`, `:130`), Profile и записи gate registry остаются, Session-ы
  Project-а не закрываются.
- Ticket 03 даёт `project-connect --remove <name>`: Profile, записи gate registry, `runs/<name>/`.
- Подтверждение действий First run — нативный диалог «Confirm» / «Cancel» на окне, которое спросило
  (`confirmIn`, `src/main/ipc/first-run.ts:118-131`).
- Session-ы приложения — `sharedRegistry()` (`src/main/agent/app-registry.ts:179`), Orchestrator-ы —
  `src/main/agent/app-orchestrators.ts`, Terminal-ы — `src/main/ipc/terminal.ts`. На Windows папку, где
  открыт файл (cwd Terminal-а, процесс `node --test`, git), удалить нельзя: `EBUSY` или `EPERM`.

## Что делаем

1. Экран Done — `src/renderer/getting-started/DoneScreen.tsx` (новый), в разделе вместо списка шагов,
   когда шаг 6 отмечен. Тексты spec-а. «Connect your own project» — `requestAddProject()` Ticket-а 07.
   Ссылка «Show steps» возвращает список.
2. Канал `gettingStarted.removeDemo` → `{ removed: true } | { removed: false, reason }`. main
   (`src/main/getting-started/remove.ts`, новый):
   1. подтверждение нативным диалогом с текстом spec-а и путём папки; «Cancel» — ничего;
   2. закрывает Session-ы (Orchestrator тоже) и Terminal-ы, чей cwd внутри папки demo;
   3. `project-connect --remove worfy-demo`;
   4. `projects.remove` пути demo и папка данных worfy этого Project-а;
   5. папка demo: `rm` с повторами (`maxRetries`, пауза) — на Windows файлы освобождаются не сразу;
      не удалилось — ответ называет, что осталось и почему;
   6. запись `demo` из состояния убирается; шаги 2–6 снимаются, шаг 1 остаётся; раздел виден.
   Удаляется только путь из записи `demo` и только если там наш шаблон (`bin/profile -C` отвечает
   `worfy-demo`); иначе — отказ, ничего не тронуто.
3. Сам по себе Demo project не удаляется: ни Skip, ни Done, ни перезапуск его не трогают.
4. После удаления — toast `success` «The demo project was removed.»

## Готово, когда

- [ ] Contract test: созданный demo (Ticket 05) во временных папках, подтверждение — да: папки нет,
      `bin/profile -C` его не знает, в `gate/config.json` записей `worfy-demo` нет, в `projects.json`
      строки нет, папки данных worfy нет; запись `demo` убрана.
- [ ] Подтверждение — нет: ничего не тронуто.
- [ ] Запись `demo` указывает на папку, где не наш Profile, — отказ, папка цела.
- [ ] Открытый Terminal с cwd внутри demo закрыт до удаления (contract test с fake pty).
- [ ] e2e: шаг 6 отмечен (Status пишет test) — экран Done; «Remove the demo project» с подменённым
      подтверждением — Project-а нет в боковой панели, папки нет; «Connect your own project» открывает
      «Add project».
- [ ] Снимки экрана Done в светлой и тёмной теме.
- [ ] Платформенный PR (ADR-0056, пункт 2; удаление папок на Windows): вердикт Windows — gate full на
      ПК, код 0 и строка `[gate] green (full)`; (вручную) на ПК удаление demo с открытым Terminal-ом
      проходит.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full — exit 0 и строка
      `[gate] green (full)` (оркестратор перед merge).

## Тесты

- Contract `test/contract/getting-started-remove.test.ts` (новый): подтверждение — параметр `deps`;
  настоящий `harness/bin/project-connect` во временной `HARNESS_HOME`.
- e2e `test/e2e/getting-started-done.spec.ts` (новый).
- Сначала падающий: вызов `gettingStarted.removeDemo` — канала нет.

## Где в коде

- `src/main/getting-started/remove.ts` (новый)
- `src/main/getting-started/demo.ts`, `src/main/getting-started/state.ts`
- `src/shared/ipc/getting-started.ts`, `src/main/ipc/getting-started.ts`
- `src/renderer/getting-started/DoneScreen.tsx` (новый)
- `src/renderer/shell/sidebar/GettingStartedSection.tsx`
- `test/contract/getting-started-remove.test.ts` (новый)
- `test/e2e/getting-started-done.spec.ts` (новый)

Только читать: `src/main/ipc/projects.ts`, `src/main/projects/store.ts`, `src/main/ipc/first-run.ts`,
`src/main/agent/app-registry.ts`, `src/main/agent/app-orchestrators.ts`, `src/main/ipc/terminal.ts`.

## Итог

Заполняется при закрытии.
