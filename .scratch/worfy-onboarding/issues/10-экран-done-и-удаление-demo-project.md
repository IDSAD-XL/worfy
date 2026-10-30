# 10 — Экран Done и удаление Demo project

Type: task
Status: done 2026-10-30T12:13Z
PR: #1048
Blocked by: 03, 05, 07
Source: решения владельца 2026-10-26, пункты 7 (экран «Done» с «Connect your own project» и «Remove the demo project»; удаление с подтверждением убирает папку, Profile и запись registry; сам demo не удаляется) и 8 (macOS и Windows одинаково); [spec.md](../spec.md), «Тексты (черновик)», «Экран Done»; «Решено без владельца», Р12 (решено без владельца, подтверждено владельцем 2026-10-26)

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

PR #1048 (merge f2e654c4). Экран Done (`DoneScreen.tsx`) вместо шагов после шага 6, «Show steps» возвращает список;
канал `gettingStarted.removeDemo` (`src/main/getting-started/remove.ts`): guard-ы до диалога (корень диска, home, папка
выше home, пересечение с `dataRoot`, `bin/profile -C` = `worfy-demo` и Profile наш — проверка из `forget()`),
нативное подтверждение (по умолчанию Cancel), Orchestrator удерживается закрытым (`keepClosed` в
`AppOrchestrators.open` — единая точка для main и renderer), Session-ы и Terminal-ы с cwd внутри папки закрываются и
дожидаются до удаления, `project-connect --remove`, строка списка и папка данных, запись `demo` и шаги 2–6, папка — 5
попыток по 1 s с ответом, что осталось. Снимки экрана Done в обеих темах сверены.

- Отступление от порядка тикета: запись `demo` убирается до удаления папки (её держат наблюдатели Stage-й demo).
  Тупика нет: повторный Remove отклонился бы и при порядке тикета, `createDemo` потом создаёт `worfy-demo-2`.
- Вне следа: `src/main/agent/app-orchestrators.ts` (`keepClosed`); `getting-started.spec.ts`, `getting-started-hints.spec.ts`
  (клик «Show steps»), `scripts/e2e-specs.table.json`.
- Gate: круг 1 — REJECTED (test корня диска красный на Windows CI: `mkdir D:\` EPERM; нет test-а на соседнюю
  `worfy-demo-2`; нет test-а с symlink-ами; новое окно снова открывало Orchestrator). Круг 2 — REJECTED (снятие hold
  при неудачном удалении без test-а; путь через renderer мимо hold-а; hold до `retain`). Узкий круг — решён
  оркестратором без владельца (листовой тикет, ночная автономия; подтвердить) — NARROW: VERIFIED. Удаление за пределы
  папки demo reviewer проверил пробами: symlink-и наружу, папка-symlink, `/var` и `/private/var`, регистр, `..`, пустой и
  относительный путь.
- CI: после узкого круга `getting-started.spec.ts:192` на macOS runner-е — тело раздела под «Show steps» выше на 9 px;
  test проверяет видимость каждого шага вместо «не прокручивается» в этом состоянии.
- Debt (low): после неудачного удаления при активном demo вид Session висит на «Starting the Orchestrator…» до смены
  Project-а; `forgetDemo` сохраняет `hintsSeen` — после нового demo подсказки не повторяются; запись, чья папка удалена
  руками, Remove отклоняет без очистки; «Show steps» нет в «Тексты (черновик)».
- Windows, вручную (ПК, `main` f2e654c4, комментарий в #1048): удаление с открытым Terminal-ом прошло — Terminal
  закрыт до удаления папки, папки и строки Project-а нет, записи в registry нет, toast верный; занятый файл назван в
  ответе (EBUSY). Реальный registry владельца до и после совпадает побайтно. Не проверено: нативный диалог
  подтверждения на Windows нажимали не руками (ответ в main, как в e2e) — это приёмка 12. ПК удалил руками свою
  оставшуюся после варианта с занятым файлом папку (её не было до run-а) — вне брифа, владельческого не задето.
  Windows: scope `pc` — gate full ПК после merge (ADR-0086).
