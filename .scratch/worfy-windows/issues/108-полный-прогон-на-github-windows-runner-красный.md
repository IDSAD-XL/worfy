# 108 — Полный прогон unit и contract на GitHub Windows runner красный: 8 файлов, 66 test-ов

Type: bug
Status: open
Blocked by: —
Source: run 39841670369 workflow `windows-tests.yml` в режиме `full` из PR #784 (коммит `53e7ee59` = `main` + #784,
`windows-latest`), направление Session на Mac 2026-10-23. Журнал упавшего шага — `C:/Users/Alexey/worfy-wt/run-39841670369-failed.log`
на ПК.

## Что происходит

Весь `pnpm test` (unit и contract) на GitHub Windows runner упал: 8 файлов из 417, 66 test-ов. На Windows-ПК
владельца эти же 8 файлов на `main` `730abb86` зелёные (7 файлов одним прогоном — 292 passed, 15 skipped,
EXIT=0; `rules-hooks.test.sh` — 201/201). Runner отличается от ПК тремя условиями, и каждое ломает свою группу:

1. **Временная папка под короткой 8.3-формой имени** (`TEMP=C:\Users\RUNNER~1\AppData\Local\Temp`). JavaScript
   `fs.realpathSync` короткое имя не разворачивает, а `realpath(3)` (`fs.realpathSync.native`, `fs/promises`
   `realpath`, Vite, `pwd -W` Git Bash) даёт длинное `C:\Users\runneradmin\…`. На ПК у `C:\Users\Alexey` короткой
   формы нет, поэтому там разницы не видно.
   - `test/unit/canvas.test.tsx` (41), `test/unit/session-rail-discovery.test.tsx` (2),
     `test/unit/shell-discovery.test.tsx` (2): «Cannot find module '/@id/C:\Users\RUNNER~1\…\worfy-glob-probe-…'».
     Копию модуля для test-а glob (`test/unit/glob-probe.tsx`) Vite находит по длинному пути, а список
     `server.fs.allow` в `vitest.config.ts` держит временную папку в короткой форме (`realpathSync(tmpdir())`):
     файл вне списка, модуля «нет».
   - `test/contract/shell.test.ts` (12), `test/contract/tickets-read.test.ts` (4): ожидаемый путь test собирает
     из `realpathSync(mkdtempSync(…))` (короткая форма), а `shell.openInEditor` и `tickets.read` отвечают
     настоящим путём через `fs/promises` `realpath` (длинная). Продукт прав: он и корень Project, и файл
     разворачивает одним `realpath`.
   - `harness/hooks/tests/rules-hooks.test.sh` (1 test в `test/contract/harness-scripts.test.ts`, 5 проверок
     внутри): hook `inject-rules.mjs` называет файл правил пользователя путём из `HARNESS_HOME`, как его видит
     node (короткая форма), а test сравнивает с `pwd -W` (длинная).
2. **Checkout на диске `D:`, временная папка на `C:`.** `test/contract/harness-script-command.test.ts` (2):
   test-ы `nodeOnPath` про относительную запись PATH и запись `\tools` без диска требуют, чтобы рабочая папка
   процесса и временная лежали на одном диске; между дисками относительного пути нет.
3. **Первый `sh` на PATH — `C:\Program Files\Git\bin\sh.exe`.** Это launcher Git for Windows: он ставит свои
   `mingw64/bin` и `usr/bin` перед PATH. `scripts/eval-run-env.mjs` (`gitCopy`) на Windows ищет git через
   `sh -c 'git --exec-path'`, и вместо первого git на PATH прогонов отвечал git самого Git for Windows.
   `test/contract/harness-evals.test.ts` (2): заглушки git, которые test ставит первой на PATH, не вызывались,
   выход 0 вместо 1. Это ошибка продукта: порядок PATH прогонов не соблюдался.

## Что делаем

1. `vitest.config.ts`: временную папку для `server.fs.allow` — через `realpathSync.native`.
2. `test/contract/shell.test.ts`, `test/contract/tickets-read.test.ts`: папка test-а — через
   `realpathSync.native`, как ответ продукта.
3. `harness/hooks/tests/rules-hooks.test.sh`: путь к папке Harness в написании node — из `HARNESS_HOME`
   глазами node, а не `pwd -W`.
4. `test/contract/harness-script-command.test.ts`: два test-а `nodeOnPath` выполняются с папкой test-а как рабочей
   (`process.chdir` и возврат в `finally`).
5. `scripts/eval-run-env.mjs`: внутри `sh` снова выставить PATH прогонов (`cygpath -u -p`), потом искать git.

## Готово, когда

- [ ] Каждая группа воспроизведена на ПК в условиях runner-а (короткая 8.3-форма TEMP; TEMP на другом диске;
  `Git\bin` первым на PATH) — красная до правки, зелёная после.
- [ ] Мутанты: без `.native` в `vitest.config.ts` — красные test-ы glob; без проверки абсолютного пути в
  `nodeOnPath` — красные оба test-а; hook без пути в заметке — красный `rules-hooks.test.sh`.
- [ ] 8 файлов на ПК зелёные; `no-rmsync`, `pnpm lint`, `pnpm typecheck`, gate fast — exit 0.
- [ ] Mac запускает `windows-tests.yml` с этими 8 файлами на ветке — зелёный.

## Где в коде

- `vitest.config.ts:20` — `tempDir` для `server.fs.allow`.
- `test/unit/glob-probe.tsx:67` — корень копии (Vite сам разворачивает путь, правка не нужна).
- `test/contract/shell.test.ts:59`, `test/contract/tickets-read.test.ts:69` — папка test-а.
- `src/main/ipc/shell.ts:25` — `realOrNull` (`fs/promises` `realpath`), ответ `shell.openInEditor`.
- `harness/hooks/tests/rules-hooks.test.sh:199` — `HH_N`; `harness/hooks/inject-rules.mjs:77`, `harness/hooks/eval-env.cjs:36`.
- `test/contract/harness-script-command.test.ts:60-90` — test-ы `nodeOnPath`; `src/main/workflow/profile.ts:158`.
- `scripts/eval-run-env.mjs:156-165` — `gitCopy`, поиск git на Windows.

## Итог

2026-10-23, ветка `worfy-windows/108` от `main` `730abb86`, Windows-ПК.

**На ПК до правки, обычное окружение:** 7 файлов одним прогоном — 292 passed, 15 skipped, EXIT=0;
`rules-hooks.test.sh` с пустым HOME — 201/201, EXIT=0. Значит, красное — условия runner-а, а не код на любом Windows.

**Воспроизведение условий runner-а на ПК.** На диске `C:` создание 8.3-имён выключено, но у старых папок короткая
форма есть: `C:\Users\Alexey\.config` = `C:\Users\Alexey\CONFIG~1`. Временная папка для прогонов —
`C:\Users\Alexey\CONFIG~1\wt108tmp` (TEMP и TMP; для Git Bash ещё TMPDIR в POSIX-форме: `/tmp` Git Bash на ПК
привязан к уже запущенным процессам MSYS и TEMP не следует).

| Группа | Условие | До правки | После |
| --- | --- | --- | --- |
| canvas, session-rail-discovery, shell-discovery, shell, tickets-read | TEMP в 8.3-форме | 61 failed из 88, EXIT=1, те же «Cannot find module '/@id/C:\Users\Alexey\CONFIG~1\…'» и пути `CONFIG~1` против `.config` | 87 passed, 1 skipped, EXIT=0 |
| rules-hooks.test.sh | TMPDIR в 8.3-форме | те же 5 FAIL, что на runner-е, 196/201, EXIT=1 | 201/201, EXIT=0 (и в обычном окружении 201/201) |
| harness-script-command | TEMP на `D:\wt108-tmp`, checkout на `C:` | 2 failed, EXIT=1 (`expected 'c:' to be 'd:'`, `expected true to be false`) | 10 passed, 4 skipped, EXIT=0 (и с TEMP на `C:`) |
| harness-evals | `C:\Program Files\Git\bin` первым на PATH | 2 failed (те же два test-а), EXIT=1 | 195 passed, 10 skipped, EXIT=0 (и в обычном PATH) |

**Мутанты (восстановление из копии):** `vitest.config.ts` без `.native` при 8.3-TEMP — `shell-discovery` 2 failed;
`nodeOnPath` без проверки абсолютного пути при TEMP на `D:` — оба test-а красные; `inject-rules.mjs` без пути в
заметке при 8.3-TMPDIR — 2 FAIL «no path to the file». `.native` в `test/unit/glob-probe.tsx` не нужен: с
обычным `realpathSync` там и `.native` в config test-ы glob зелёные (Vite сам разворачивает путь при импорте),
поэтому `glob-probe.tsx` не тронут.

**Что изменено.**
1. `vitest.config.ts`: `tempDir` для `server.fs.allow` — `realpathSync.native(tmpdir())`.
2. `test/contract/shell.test.ts`, `test/contract/tickets-read.test.ts`: папка test-а — `realpathSync.native`.
   Продукт не менялся: `shell.openInEditor` и `tickets.read` и так отвечают путём `realpath(3)`.
3. `harness/hooks/tests/rules-hooks.test.sh` (правка в тестах Harness нужна: сравнение там и было неверным):
   `HH_N` — `HARNESS_HOME`, как его видит node, с `/`, вместо `pwd -W`.
4. `test/contract/harness-script-command.test.ts`: помощник `inScratch` — два test-а `nodeOnPath` выполняются с
   папкой test-а как рабочей. Утверждения прежние; относительная запись теперь просто `near`.
5. `scripts/eval-run-env.mjs` (`gitCopy`, ошибка продукта): на Windows
   `sh -c 'PATH="$(cygpath -u -p "$1")" && exec git --exec-path' sh <PATH прогонов>`. Без `cygpath` (не Git for
   Windows) — выход 127 и прежнее сообщение «gave no folder»: прогон останавливается, а не берёт чужой git.

`.github/workflows/` не тронут; skip-ов не добавлено.

Проверки (все с кодом): 7 файлов vitest и `test/unit/no-rmsync.test.ts` одним прогоном в обычном окружении —
8 files, 307 passed, 15 skipped, EXIT=0; `pnpm lint` EXIT=0; `pnpm typecheck` EXIT=0; gate fast EXIT=0,
«[gate] green (fast)» (по diff сузился до lint и typecheck). `test/contract/harness-scripts.test.ts` целиком (около 26 минут) не запускался:
на ПК в это время под замком идут e2e оркестратора; его единственный упавший на runner-е test —
`rules-hooks.test.sh`, он прогнан отдельно с пустым HOME (выше). e2e не запускались: `test/e2e` не тронут.
