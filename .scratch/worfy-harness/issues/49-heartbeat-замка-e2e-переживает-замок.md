# 49 — Heartbeat замка e2e в блоке gate full одного PR не выходит, когда замка уже нет

Type: bug
Status: claimed 2026-10-19T23:34Z
Branch: worfy-harness/49
Blocked by: —
Source: Session на Mac 2026-10-18 — 8 осиротевших heartbeat-процессов на Mac (временные замки
test-ов, сняты руками); первый круг ревью PR #497 на Mac ([комментарий](https://github.com/IDSAD-XL/worfy/pull/497#issuecomment-6252102036),
раздел «Outside the diff»). Строки — на main `f7ea055f`.

## Что происходит

- **Что такое heartbeat.** Блок gate full одного PR в `harness/skills/epic-wave/SKILL.md:860-874` берёт
  замок e2e (папку `workflow.e2e_lock`, `mkdir`). Замок старше 30 мин считается брошенным, поэтому
  фоновый subshell раз в 5 мин обновляет время папки (`SKILL.md:870`):
  `( while sleep 300; do touch -c "$L" 2>/dev/null || exit 0; done ) … & HB=$!`.
- **Heartbeat не выходит, когда замка нет.** `touch -c` на несуществующем пути возвращает 0 (на macOS
  проверено), поэтому `|| exit 0` не срабатывает никогда. Пока shell блока жив, его `trap … EXIT`
  (`:871`) убивает heartbeat. Если shell убит без trap-а (SIGKILL — например, timeout файла vitest в
  `harness-scripts.test.ts`), heartbeat живёт вечно: папки нет, а он раз в 5 мин зовёт `touch -c`.
  2026-10-18 на Mac найдено 8 таких процессов от временных замков test-ов.
- **То же в Profile.** Строка замка e2e в `rules.md` Profile-а worfy (`~/.claude/worfy-harness/projects/worfy/rules.md:60`,
  вне репозитория) — тот же цикл `while sleep 300; do touch -c "$L" … || exit 0; done`.
- **Гонка trap-а.** `trap 'pkill -P $HB …; kill $HB …'` (`SKILL.md:871`): `pkill -P` ищет детей
  subshell-а, а subshell в это время может как раз запускать новый `sleep` — тот остаётся. В минимальной
  пробе — 1 сирота на 40 прогонов; `wave-gate.test.sh` оставляет ~3 `sleep 300` на прогон.
- **Нет test-а на живой замок.** Ни один test не закрепляет, что замок моложе 30 мин блок не трогает
  (`SKILL.md:866`, `find "$L" -maxdepth 0 -mmin +30`): мутант без `-mmin +30` выживает на main.
- `harness/bin/wave-gate` (Node) этой ошибки не имеет: `fs.utimesSync` на пропавшей папке бросает, и
  `clearInterval` останавливает heartbeat (`harness/bin/wave-gate:213-220`).
- **Тот же класс в `scripts/e3-sandbox.sh`** (добавлено 2026-10-19, ревью PR #509). Свой heartbeat замка
  песочницы — `lock_run`, `scripts/e3-sandbox.sh:314`: `(while sleep 300; do touch "$LOCK" … || exit 0; done) &`.
  Trap на выходе (`:317`) делает `kill` subshell-а, а его `sleep 300` остаётся с ppid 1 до 5 мин — после
  каждого `pnpm test`, который зовёт скрипт. Плюс `touch` без `-c`: если замка уже нет, он создаёт на его
  месте обычный файл (как в Profile-е до 2026-10-10).

## Что делаем

1. Heartbeat выходит, когда папки замка нет: `[ -d "$L" ] || exit 0; touch -c "$L"` — в
   `SKILL.md:870` и в строке замка Profile-а (`rules.md:60`; Profile правится через `project-connect` или
   владельцем — Session не пишет под `~/.claude`).
2. Гонка trap-а: убивать heartbeat так, чтобы его `sleep` не оставался — например, сначала `kill $HB`, потом
   `pkill -P $HB`, или своя группа процессов у heartbeat-а и `kill` группы; выбрать при работе и замерить.
   С пунктом 1 сирота-`sleep` живёт не дольше 5 мин, но и это видно в списке процессов.
3. Test на живой замок: замок моложе 30 мин с чужим `holder.json` блок не снимает и ждёт.
4. `scripts/e3-sandbox.sh:314-317` — тот же способ, что в пунктах 1 и 2: heartbeat выходит без папки
   замка (`touch -c` и проверка `-d`), а trap не оставляет его `sleep`.

## Готово, когда

- [ ] `harness/bin/tests/wave-gate.test.sh`: блок gate full одного PR, shell блока убит `kill -9` после
      взятия замка, замок снят — heartbeat выходит не позже одного шага (с подменённым быстрым `sleep`).
      Красный на main.
- [ ] Тот же файл: после обычного выхода блока не остаётся ни одного `sleep` от heartbeat (N ≥ 40
      прогонов, 0 сирот). Красный на main, если гонка воспроизводится.
- [ ] Тот же файл: замок моложе 30 мин не снимается; мутант без `-mmin +30` — красный.
- [ ] После `lock_run` в `scripts/e3-sandbox.sh` не остаётся ни одного `sleep` от heartbeat (тот же
      способ замера, что выше); test красный на main.
- [ ] Строка замка в Profile-е worfy исправлена тем же способом (запись — владелец или `project-connect`).
- [ ] `pnpm test` (`test/contract/harness-scripts.test.ts`) — exit 0 на Mac; gate full — exit 0 и строка
      `[gate] зелено (full)`.

## Где в коде

- `harness/skills/epic-wave/SKILL.md:860-874` — блок gate full одного PR (`:866` — брошенный замок,
  `:870` — heartbeat, `:871` — trap).
- `harness/bin/tests/wave-gate.test.sh:795-818` — test-ы этого блока.
- `~/.claude/worfy-harness/projects/worfy/rules.md:60` — строка замка e2e в Profile-е (вне репозитория).
- `scripts/e3-sandbox.sh:314-317` — heartbeat и trap `lock_run`; его test-ы — рядом с остальными test-ами
  скрипта (найти при работе).

## Вне скоупа

- `harness/bin/wave-gate` — heartbeat на Node, ошибки нет.

## Риски

- Test с `kill -9` оставит процесс, если правка не сработала: test должен сам убить оставшийся
  heartbeat по pid в конце.
