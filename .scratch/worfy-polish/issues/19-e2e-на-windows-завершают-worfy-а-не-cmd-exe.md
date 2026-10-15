# 19 — e2e на Windows: helper завершает сам worfy, а не только `cmd.exe` над ним

Type: task
Status: open
Blocked by: —
Source: решение владельца 2026-10-15 по Gate Ticket-а
[04](04-три-нестабильных-e2e-ждут-состояние.md) (раздел «Gate оркестратора (2026-10-15)», Noted
[low]: «Вне diff, для `worfy-windows`: `helpers.ts:112-116` — на Windows Playwright запускает Electron
через `shell: true`, `kill('SIGKILL')` завершает только `cmd.exe`») и «Итог» Ticket-а 04 («Кандидат в
следующий Ticket: `close()` в `test/e2e/helpers.ts`»);
[ADR-0056](../../../docs/adr/0056-windows-checks-and-two-sessions.md), пункт 2.

**Платформенный Ticket (ADR-0056, пункт 2).** PR меняет поведение e2e на Windows. Merge ждёт
`gate full` на Windows-ПК владельца; его строка вердикта и код выхода входят в «Итог». «Не удалось
проверить» — не зелено, PR не мержится. Пока Windows-ПК выключен, Status после PR —
`blocked — ждёт gate full на Windows-ПК`, как у Ticket-а 13.

## Что происходит

Каждый e2e запускает worfy через `launchApp` (`test/e2e/helpers.ts:121`) и завершает через
`close()` или helper `kill`.

- **Playwright на Windows запускает Electron через shell.** В `playwright-core` 1.63.0
  (`lib/coreBundle.js:44279-44283`) на `win32` ставится `shell = true`, а команда склеивается в одну
  строку. Значит, `app.process()` — это `cmd.exe`, а worfy (`electron.exe`) — его дочерний процесс.
- **Helper убивает только `cmd.exe`.** `kill` (`helpers.ts:79-83`) зовёт `child.kill('SIGKILL')`
  для `child = app.process()` (`:170`). На Windows это `TerminateProcess` одного `cmd.exe`; worfy под
  ним остаётся жить.
- **Когда helper зовётся.** `close()` — если приложение не вышло за `QUIT_TIMEOUT_MS` = 20 s (`:21`,
  `:198`); `catch` в `launchApp` — если окно не появилось (`:208-209`). Затем `exited(child)` ждёт
  только выхода `cmd.exe` (`:73-76`), и `cleanDirs` удаляет папки, которые держит живой worfy.
- **Сам Playwright убивает дерево.** Его собственный `kill` на Windows — `taskkill /pid … /T /F`
  (`lib/coreBundle.js:9402`). Helper проекта этим не пользуется.

Строки `:112-116` из Gate Ticket-а 04 сдвинулись: тот же код сейчас на `:79-83`.

## Что делаем

1. **Сначала красный test — на Windows-ПК.** Временный spec (в scratchpad, не в PR, как probe
   Ticket-а 04): main держит `will-quit` навсегда; после `close()` test ищет `electron.exe` или
   `worfy.exe` с PID, который приложение назвало само (`app.evaluate(() => process.pid)`). На main
   процесс жив. Вывод — в «Итог».
2. **Убивать сам worfy.** Сразу после `_electron.launch` helper берёт PID главного процесса worfy
   изнутри приложения (`app.evaluate(() => process.pid)`) и в `kill` завершает этот PID, потом ждёт
   выхода и его, и `child`. На macOS и Linux PID совпадает с `child.pid` — поведение то же. Если
   PID получить не удалось (приложение зависло до связи с Playwright) — запасной путь, его выбирает
   исполнитель (например, `taskkill /T` по `child.pid`) и пишет в «Итог».
3. **Условия Ticket-а 04 для будущего `close()`** — не размывать: `close()` по-прежнему считает
   ошибкой и «приложение не завершило quit», и «после quit кто-то держит вывод». Этот Ticket меняет
   только то, **кого** убивает `kill`. Если без ветки по `process.platform` не обойтись — причина в
   «Итог» с пометкой «решено без владельца, подтвердить».
4. **Тот же probe на Mac** — зелёный и до, и после: процесса с этим PID после `close()` нет.

## Готово, когда

- [ ] Probe пункта 1 на Windows-ПК: на main worfy жив после `close()`, с правкой — нет; вывод
      `tasklist` до и после — в «Итог».
- [ ] Probe пункта 4 на Mac — зелёный; e2e `autopilot`, `binding` и `packaged` зелёные на Mac.
- [ ] Gate full на Windows-ПК — строка вердикта и код выхода в «Итог» (ADR-0056, пункт 2).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full — exit 0 и строка
      `[gate] зелено (full)`; Linux CI зелёный.

## Тесты

- Probe-spec на Windows и Mac — в scratchpad, в PR не входит (как в Ticket-е 04); в «Итог» — текст
  probe и вывод.
- Мутант: `kill` снова по `child` — probe на Windows красный.
- e2e на Linux CI не идут (CI — только unit и contract); e2e — в gate full на Mac и на Windows-ПК.

## Где в коде

- `test/e2e/helpers.ts`

Только читать (не в списке, чтобы не давать ложных пересечений Wave): `playwright.config.ts`,
`test/e2e/autopilot.spec.ts`, `test/e2e/binding.spec.ts`, `test/e2e/packaged.spec.ts`,
`docs/adr/0056-windows-checks-and-two-sessions.md`.

## Вне скоупа

- Переделка `close()` («Кандидат в следующий Ticket» из «Итог» Ticket-а 04): отличать «не
  завершил quit» от «после quit держит вывод».
- Остальной порт e2e на Windows — Epic `worfy-windows`, Ticket 14 (open). Он тоже правит
  `test/e2e/helpers.ts` (пункт 6, путь к распакованной сборке): кто вливается вторым, тот
  обновляется от main.

## Итог

—
