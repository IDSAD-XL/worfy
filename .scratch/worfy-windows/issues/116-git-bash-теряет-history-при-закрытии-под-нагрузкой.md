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

- [ ] Сначала падающий test: stand-in kill.exe, который доставляет сигнал через 700 ms, — history сохраняется
      (сейчас — нет).
- [ ] Test: stand-in kill.exe, который не выходит вовсе, — helper отвечает в своём пределе, и kill.exe не держит ответ
      (поведение, ради которого вводили предел 500 ms).
- [ ] (вручную, ПК) Тот же замер, 120 закрытий под нагрузкой: 0 закрытий без `.bash_history`; `terminal.close` не дольше
      `WINDOWS_CLOSE_BOUND_MS`; таблица — в «Итог».
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
