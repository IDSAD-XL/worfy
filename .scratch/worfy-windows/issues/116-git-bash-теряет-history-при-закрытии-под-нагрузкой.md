# 116 — Git Bash теряет history при закрытии под нагрузкой: kill.exe обрывается раньше SIGHUP

Type: bug
Status: claimed 2026-10-31T15:26Z
Branch: worfy-windows/116
Blocked by: —
Source: замер ПК 2026-10-31 на main `c01cd364` (через мост; данные на ПК в `evidence/windows-close-measure/`:
`idle.jsonl`, `load.jsonl`, `stats.mjs`, `stats2.mjs`); красный `test/contract/terminal-git-bash-close.test.ts:33` в gate
full на ПК, main `fc9279cf` (раньше в worfy-polish 47). Платформенный: делает Session на ПК, проверяет и вливает Mac
(ADR-0056).

## Что происходит

- Закрытие Terminal-а Git Bash (`src/main/terminal/windows-pty.ts`): helper PowerShell запускает
  `kill.exe -HUP -W <bash>`, ждёт его `$signal.WaitForExit(500)` и завершает `$signal.Kill()` (`:125`,
  `HANGUP_SIGNAL_BOUND_MS = 500`, причина предела — комментарий `:44-52`: kill.exe, переживший helper, держит его ответ,
  потому что наследует stdout helper-а). Затем helper ждёт выхода bash до `HANGUP_GRACE_MS` (1000 ms, `:28`) и
  завершает оставшихся `Stop-Process -Force` (`:206`).
- Замер ПК, 120 закрытий под нагрузкой (полный vitest на 8 workers, CPU медиана 46–50 %, максимум 76 %):
  - предел 500 ms сработал 26 раз; во всех 26 `.bash_history` нет, bash был жив после 1000 ms ожидания и завершён
    `Stop-Process`;
  - предел не сработал 94 раза; во всех 94 history есть, bash вышел через 5–59 ms после kill.exe (медиана 33 ms);
  - kill.exe: min/median/max 56/510/2400 ms (вместе с `Process.Start`, который под нагрузкой сам медленный);
  - без нагрузки 30 закрытий: потерь 0, предел не срабатывал, kill.exe 42/46/317 ms.
- Механизм (26 из 26 совпадений, напрямую не наблюдался): предел завершает kill.exe до того, как тот доставил SIGHUP;
  bash сигнала не получает и history не пишет. Пользователь, закрывший Git Bash на занятой машине, теряет history этой
  Session (около 22 % закрытий в замере).
- Пределы, внутри которых должна остаться правка: helper Git Bash `HANGUP_TIMEOUT_MS` = 4500 ms (`:58`), закрытие
  `WINDOWS_CLOSE_BOUND_MS` = 5000 ms (`src/main/terminal/pty.ts:91`). В замере helper под нагрузкой — до 4449 ms,
  `terminal.close` — до 4511 ms.

## Что делаем

1. Убрать фиксированный обрыв kill.exe через 500 ms. Направление (выбрать по замеру, записать выбор в «Итог»):
   - kill.exe ждут, пока выйдет он сам или bash, в пределах общего бюджета hangup-а (`HANGUP_SIGNAL_BOUND_MS` +
     `HANGUP_GRACE_MS`), и завершают его только перед ответом helper-а — так kill.exe по-прежнему не переживает helper;
   - или доставлять SIGHUP путём, который не запускает новый процесс под нагрузкой (если такой есть в MSYS).
   Предел helper-а и `WINDOWS_CLOSE_BOUND_MS` не поднимать. Изменить сами константы hangup-а можно, если сумма
   остаётся в `HANGUP_TIMEOUT_MS`; что изменилось — в «Итог».
2. `Stop-Process` по-прежнему только для процессов, которые остались после бюджета.
3. Комментарий `:44-52` переписать под новое поведение.

## Готово, когда

- [x] Сначала падающий test: stand-in kill.exe, который доставляет сигнал через 700 ms, — history сохраняется
      (сейчас — нет). Был красным на старом коде; по решению Orchestrator-а после ревью заменён, см. «Итог».
- [x] Test: stand-in kill.exe, который не выходит вовсе, — helper отвечает в своём пределе, и kill.exe не держит ответ
      (поведение, ради которого вводили предел 500 ms).
- [ ] (вручную, ПК) Тот же замер, 120 закрытий под нагрузкой: 0 закрытий без `.bash_history`; `terminal.close` не дольше
      `WINDOWS_CLOSE_BOUND_MS`; таблица — в «Итог». **НЕ выполнен: 2 из 120 без history.** `terminal.close` в пределе.
- [ ] `test/contract/terminal-git-bash-close.test.ts` зелёный в gate full на ПК.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.

## Тесты

- Contract `test/contract/terminal-git-bash-close.test.ts` (настоящий Git Bash, только Windows) — без quarantine.
- Unit/contract helper-а с stand-in kill.exe — рядом с test-ами `windows-pty` (тот stand-in, что спит 10 s, уже был в
  замере предела).

## Где в коде

- `src/main/terminal/windows-pty.ts` (`:28`, `:44-58`, `:125`, `:206`)
- `src/main/terminal/pty.ts:91` — только читать
- `test/contract/terminal-git-bash-close.test.ts`, test-ы `windows-pty`

## Итог

**Потеря history сократилась, но не устранена: пункт «0 закрытий без `.bash_history`» НЕ выполнен, 2 из 120 под нагрузкой.**
Решение Orchestrator-а: вливать с этой таблицей (вариант 1). Запись history без сигнала (`PROMPT_COMMAND='history -a'`,
не проверено) — вопрос владельцу, в этом тикете не начата.

Что изменилось. Выбрано первое направление: kill.exe больше не завершают через 500 ms. kill.exe и bash делят одно ожидание
`HANGUP_WAIT_MS` = 1500 ms: отсчёт после `Process.Start`, ожидание кончается с выходом bash. Эта константа заменила
`HANGUP_SIGNAL_BOUND_MS` (500) и `HANGUP_GRACE_MS` (1000), сумма та же. `HANGUP_TIMEOUT_MS` = 4500 ms и
`WINDOWS_CLOSE_BOUND_MS` = 5000 ms не менялись. kill.exe, ещё работающий после ожидания, helper завершает до ответа:
kill.exe, переживший helper, держал бы его ответ. `Stop-Process` — только для оставшегося после ожидания.

Замер на ПК, коммит с исправлением `50dabaec`, тот же способ, что на `c01cd364`: 120 закрытий Git Bash под полным vitest на
8 workers (данные на ПК в `evidence/windows-close-measure/`, `loadfix116.jsonl`, `idlefix116.jsonl`).

| Git Bash, под нагрузкой | до, `c01cd364` | исправление |
| --- | --- | --- |
| без `.bash_history` | 26 из 120 | **2 из 120** |
| CPU, медиана / максимум | 47 / 76 % | 71 / 99 % |
| `terminal.close`, медиана / p95 / максимум, ms | 2193 / 3678 / 4511 | 2457 / 3721 / 4933 |
| `terminal.close` дольше 5000 ms | 0 | 0 |
| helper, медиана / p95 / максимум, ms | 2120 / 3613 / 4449 | 2378 / 3650 / 4855 |
| helper дольше 4500 ms | 0 | 2 |
| от старта kill.exe до выхода bash, медиана / максимум, ms | 382 / 2432 (n=94) | 441 / 1991 (n=118) |
| PowerShell: helper, максимум; закрытие, максимум, ms | 2906; 2985 | 3530; 3613 |

Без нагрузки, 30 закрытий Git Bash: потерь 0, `terminal.close` до 1913 ms, kill.exe до 366 ms.

- Обе потери: kill.exe ещё работал в конце ожидания, bash был жив. `i=130`: CPU 63 %, `Process.Start` около 572 ms, helper
  3931 ms, закрытие 4000 ms. `i=192`: CPU 75 %, `Process.Start` около 1221 ms, helper 4855 ms, закрытие 4933 ms.
- **helper в двух случаях вышел за 4500 ms на практике; запас `terminal.close` до 5000 ms в худшем случае — 67 ms.** Ответ
  helper-а во всех 120 закрытиях полный. «Timed out 0» это не подтверждает: `execFile` при exit 0 ошибки не отдаёт.
- Нагрузка заметно выше прошлой, причина не установлена; часть замера шла параллельно с двумя агентами ревью, читавшими
  diff. Поэтому 26 и 2 — не сравнение один к одному.
- Причина потерь выведена из совпадения, доставка SIGHUP напрямую не наблюдалась. Замер относится к скрипту helper-а
  `50dabaec`; его текст после этого не менялся, менялись комментарий и test-ы.

Test-ы со stand-in kill.exe (batch-файл, настоящий Git Bash, только Windows). Первая версия на 700 ms (`sleep.exe`, затем
настоящий kill.exe) была красной на старом коде без `.bash_history`, но по ревью не укладывалась бы в ожидание под нагрузкой.
Заменена по решению Orchestrator-а; запись history проверяет `terminal-git-bash-close.test.ts:33`.
- «still running after 700 ms»: по файлам-меткам stand-in прожил дольше 700 ms. С возвращённым обрывом 500 ms — красный
  (467.7 ms), с исправлением — зелёный.
- «delivers its SIGHUP and never exits»: stand-in доставляет сигнал и не выходит. Без `$signal.Kill()` — красный (`the
  stand-in still runs after the answer`), с исправлением — зелёный. Первая версия этой поломки не ловила: `execFile` при
  сработавшем лимите отдаёт exit 0 helper-а, поэтому test смотрит на сам stand-in.
- helper, снятый по лимиту под нагрузкой, в обоих test-ах — отдельный исход (skip с причиной), а не неверный ответ.

Осталось:
- Находка ревью low не исправлена: если kill.exe не запустился, helper всё равно ждёт bash всё `HANGUP_WAIT_MS`. Правка меняет
  текст скрипта на основном пути, а замер не повторяется; цена — 500 ms только на этом редком пути.
- `terminal-git-bash-close.test.ts:33` может краснеть в gate full на ПК из-за этих 1,7 %. Тогда это Windows exception с reason:
  реальная остаточная потеря history, запись ждёт решения владельца, а не безвредный flaky test.
- Полный `pnpm test` на ПК до PR не запускался: вердикт — `ci-ok` и gate full на ПК после merge. Пункт «зелёный в gate full на ПК»
  ждёт этот gate.
