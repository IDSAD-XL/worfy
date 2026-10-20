# 77 — `qmd-collections.test.sh` красный на Windows: что чинится здесь, что ждёт Ticket 15

Type: bug
Status: done 2026-10-20T19:59Z
PR: #602
Branch: worfy-windows/77
Blocked by: —
Source: решение Mac 2026-10-20 (сессия «Worfy продолжение»): красный на main в каждом full-прогоне
`harness-scripts.test.ts` на Windows прячет настоящие красные; отдельный маленький Ticket, не Ticket
[15](15-qmd-на-windows-или-grep.md) (qmd на Windows — последний Ticket порта). Строки — на main `11418a09`.

## Что происходит

В full-прогоне на ПК (PR #582, #565, #559, #590, #596) `bin/tests/qmd-collections.test.sh` красный:
8 passed, 26 failed. Каждая из 26 ошибок — `qmd-collections: profile -C … --json: exit null:` с пустым
stderr.

Причина — не таймаут и не qmd. `harness/bin/qmd-collections:102-104` зовёт `harness/bin/profile`
через `spawnSync(file, args)`. `profile` — файл без расширения с первой строкой `#!/usr/bin/env node`.
Windows не запускает такой файл по `#!`: `spawnSync` возвращает `error.code = ENOENT`, `status: null`,
stderr пустой. Проверка на ПК: прямой `spawnSync(profile, ["--help"])` — `ENOENT`, через
`process.execPath` — exit 0. Остальные скрипты Harness уже запускают соседей через node:
`preflight:149` (`scriptCommand`), `epic-status:83`, `project-connect:70`, `profile-set:104`.

Под этим — ещё два слоя в самом test-е:
- registry получает пути `/tmp/tmp.…` (Git Bash), а node на Windows их не находит
  (`profile: no such directory`);
- `PATH="$T/fakebin:$PATH"` с `T` вида `C:/…`: двоеточие после `C` режет запись PATH в Git Bash.

## Что сделать

1. `qmd-collections` запускает `profile` и `qmd-sync-main` как `preflight` своих соседей: node-скрипт —
   через `process.execPath`, файл с другим `#!` — через bash на Windows, напрямую в остальных
   системах. Сам `qmd` — как раньше (см. «Вне скоупа»).
2. Сообщения об ошибке старта называют ошибку (`ENOENT`), а не `exit null`: `profile`,
   `qmd-sync-main --describe`, `qmd update`.
3. Test: `T` в написании Windows (`pwd -W`, как `profile.test.sh:95`); записи PATH — в написании Git
   Bash (`cygpath -u`); пути в сообщениях сравниваются так, как их печатает скрипт (`cygpath -w`, как
   `profile.test.sh:97`). На macOS и Linux `pwd -W` и `cygpath` нет — пути те же, что были.

## Вне скоупа (Ticket 15)

После пунктов 1–3 на Windows 12 passed, 22 failed. Все 22 упираются в qmd на Windows:
- **A, 9 случаев** (`full`, `second run`, `already there`, `foreign`, четыре случая блокировки,
  `young holder`): `qmd-sync-main` — `#!/bin/zsh`, zsh в Git Bash нет; под bash он падает на
  `${0:A:h}` (`line 30: A: unbound variable`). Ticket 15 уже называет эти три обёртки на zsh.
- **B, 8 случаев** (`silent` и семь случаев формы `index.yml`): `qmd update: ENOENT` — `qmd`, который
  shell-скрипт, Windows не запускает по `#!`. Заглушка test-а — `#!/bin/sh`; настоящий `qmd` из npm на
  Windows — тоже shell-обёртка рядом с `qmd.cmd`. Запускать сам `qmd` через node этого Ticket-а нельзя:
  на macOS это `#!/usr/bin/env node` с native-модулями под свой node.
- **C, 1 случай** (`already-named`): какой строкой `update:` qmd на Windows запустит
  `qmd-sync-main` (сейчас — путь с `\` в кавычках к скрипту на zsh).
- Ещё не проверено, пока B красный: пути в `index.yml` на Windows записаны вперемешку `/` и `\`.

Решение владельца 2026-10-20 (через Session на Mac): A–C на Windows пропускаются с названной причиной до
Ticket-а 15, в его «Готово, когда» — пункт снять эти пропуски. Причины в test-е не называют номер Ticket-а:
`plugin-neutral.test.sh` запрещает номера Ticket-ов worfy в `harness/`. Они называют пробел словами — «qmd is
not ported to Windows yet», — а связь с Ticket-ом 15 держит его пункт.

## Готово, когда

- [x] На Windows `qmd-collections.test.sh` не падает на `profile … exit null`: 12 passed вместо 8.
- [x] На Windows группы A–C пропущены с причиной, и файл — exit 0; в Ticket 15 — пункт снять пропуски.
- [x] Каждый оставшийся красный называет причину (`ENOENT`, `unbound variable`), а не `exit null`.
- [x] На macOS `qmd-collections.test.sh` зелёный, как был (проверка Mac).
- [x] `plugin-neutral.test.sh`, `test/contract/harness-qmd.test.ts` зелёные; `qmd.test.sh` на macOS
      зелёный (на Windows его пропускает `ZSH_ONLY` в `test/contract/harness-scripts.test.ts:43`).

## Итог

Сделано в PR #602. `harness/bin/qmd-collections` запускает `profile` и `qmd-sync-main` через `scriptCommand`
(как `preflight:149`): node-скрипт — через `process.execPath`, другой `#!` — через bash на Windows. Неудачный
запуск называет команду, сигнал или код выхода вместо `exit null`. `qmd` запускается как раньше.
`harness/bin/tests/qmd-collections.test.sh`: пути в написании Windows (`pwd -W`, `cygpath -u`, `cygpath -w`) и
пропуски групп A–C на Windows с причиной.

На ПК (Git Bash, временные HOME и USERPROFILE): без пропусков — 12 passed, 22 failed, все 22 в группах A–C;
mutant с прямым запуском `profile` — 8 passed, 26 failed (`spawnSync … ENOENT`); с пропусками — exit 0,
4 passed, 15 строк пропуска. `plugin-neutral.test.sh` — exit 0; `test/contract/harness-qmd.test.ts` с двумя
guard-test-ами — exit 0; lint и typecheck — exit 0. На macOS (Mac): `qmd-collections.test.sh` 38/0, `qmd.test.sh`
35/0.

### Закрытие (2026-10-20)

Влит в main PR-ом #602 (2026-10-20, `767160f0`). Gate full на Mac: один красный прогон — новый flaky test
`tickets-chokidar` из #591 (его чинит Session Harness); перезапуск шага test-ов зелёный, 7226 passed.
check/windows — по прогону ПК на `3a8923d4`. Ревью Mac: high и med нет; один low перенесён в Ticket 15
(`scriptCommand` и файл без `#!`). Ticket закрыт docs-PR-ом с ПК по просьбе Session на Mac.
