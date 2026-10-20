# 77 — `qmd-collections.test.sh` красный на Windows: что чинится здесь, что ждёт Ticket 15

Type: bug
Status: claimed 2026-10-20T11:53Z
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

Как быть с A–C до Ticket-а 15 (skip с названной причиной или иначе) — решает владелец; Mac ставит
вопрос в его список. Здесь ничего не пропускается молча.

## Готово, когда

- [ ] На Windows `qmd-collections.test.sh` не падает на `profile … exit null`: 12 passed вместо 8.
- [ ] Каждый оставшийся красный называет причину (`ENOENT`, `unbound variable`), а не `exit null`.
- [ ] На macOS `qmd-collections.test.sh` зелёный, как был (проверка Mac).
- [ ] `plugin-neutral.test.sh`, `qmd.test.sh`, `test/contract/harness-qmd.test.ts` зелёные.
