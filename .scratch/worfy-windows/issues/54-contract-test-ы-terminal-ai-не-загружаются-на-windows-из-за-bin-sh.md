# 54 — Contract test-ы Terminal AI и shell integration не загружаются на Windows: `/bin/sh` при загрузке модуля в шести файлах `test/contract`

Type: task
Status: done 2026-10-18T11:20Z
PR: #462
Blocked by: 53
Source: Session на Windows-ПК «Worfy тесты на ПК», найдено попутно при работе над
[Ticket-ом 53](53-e2e-не-загружаются-на-windows-из-за-bin-sh.md) («Итог» на ветке `worfy-windows/53`,
[PR #387](https://github.com/IDSAD-XL/worfy/pull/387), не влит; пункт «Вне скоупа, найдено
попутно»). Отдельный Ticket — решение Session на Mac 2026-10-16. Код перечитан на Mac по main
`ed820a51` и ветке `worfy-windows/53` `86f2e2e7`.

## Что происходит

- **Шесть файлов `test/contract` при загрузке модуля ищут zsh через `/bin/sh`:**
  `const ZSH = execFileSync('/bin/sh', ['-c', 'command -v zsh'], …)` на верхнем уровне файла.
  - `test/contract/terminal-ai-fix.test.ts:45`;
  - `test/contract/terminal-ai-next-command.test.ts:41`;
  - `test/contract/terminal-ai-request.test.ts:47`;
  - `test/contract/terminal-ai-suggest.test.ts:42`;
  - `test/contract/terminal-ai-zle.test.ts:23`;
  - `test/contract/terminal-shell-integration.test.ts:24`.

  На Windows `/bin/sh` нет: `execFileSync` бросает `ENOENT` при загрузке, и vitest роняет каждый из
  шести файлов целиком — 0 test-ов. Остальной прогон vitest идёт дальше, в отличие от Playwright в
  Ticket-е 53, но test-ы этих файлов, которым zsh не нужен, тоже не запускаются (например, describe
  «the handler of Next command», `terminal-ai-next-command.test.ts:208`, или «the words and the
  notes», `terminal-ai-request.test.ts:334`).
- **Ticket 53 чинит то же в `test/e2e`** (ветка `worfy-windows/53`):
  - поиск zsh — функция `zshPath()` в `test/e2e/zsh.ts`, первый вызов спрашивает `/bin/sh`, импорт
    ничего не запускает;
  - `NO_ZSH` (`process.platform === 'win32'`) и причина пропуска `NO_ZSH_ON_WINDOWS` в том же файле;
    test-ы zsh на `win32` пропускаются с причиной;
  - защита от повтора — test по тексту `test/unit/e2e-no-spawn-on-load.test.ts`: ни один файл
    `test/e2e` и ни один файл, который они загружают, не запускает процесс при загрузке модуля.
    `test/contract` он не смотрит.
- **zsh этим test-ам нужен по смыслу.** Terminal AI и shell integration Ticket-а 01 Epic-а
  `worfy-terminal-ai` работают в zsh. PowerShell для Terminal AI — позже, вне Epic-а
  `worfy-terminal-ai`.

## Что делаем

1. **Поиск zsh — функция, а не значение модуля**, как в Ticket-е 53. Шесть файлов зовут `zshPath()`
   там, где zsh нужен (в test-е, `beforeAll` или helper-е). Брать ли `test/e2e/zsh.ts` или вынести
   его в общий для `test/e2e` и `test/contract` файл — выбор исполнителя, в «Итог».
2. **Test-ы, которым нужен zsh, на `win32` пропускаются с причиной** (`NO_ZSH_ON_WINDOWS` или своя).
   Test-ы тех же файлов, которым zsh не нужен, идут и на Windows. На macOS и Linux ничего не
   меняется.
3. **Защита от повтора** — static check Ticket-а 53 смотрит и `test/contract`: ни один файл
   `test/contract` и ни один файл, который они загружают, не запускает процесс при загрузке модуля.
   Test по тексту красный на main (находит шесть вызовов) и зелёный после правки.
4. **Четыре nit-а ревью PR #387 на Mac в `test/unit/e2e-no-spawn-on-load.test.ts`** — чинятся заодно
   с расширением static check. Номера строк ревью сняты не с ветки `worfy-windows/53` `86f2e2e7`
   (там в файле 279 строк), поэтому места названы по описанию; при claim перечитать файл на main
   после мержа #387:
   1. Набор функций, которые запускают процесс, собирается по голому имени по всем файлам: тёзки
      вроде `field`, `start`, `launch` тоже считаются, а любой вызов `x.start()` ловится. Имя
      сверяется с источником импорта.
   2. Функция, переданная в `new Promise(…)`, считается отложенной, хотя выполняется сразу
      (`NewExpression` не разбирается); `import cp = require('child_process')` не распознаётся. Оба
      случая — находятся.
   3. Отложенными считаются только вызовы, написанные как `test…`: hook-и, взятые деструктуризацией
      (`const { beforeAll } = test`), или `test.extend` под другим именем дают false positive.
      Отложенность определяется по тому, откуда взято имя.
   4. Инициализатор нестатического поля класса считается кодом времени загрузки — он выполняется
      только при `new`. Статическое поле — по-прежнему время загрузки.

## Готово, когда

- [x] На Windows-ПК шесть файлов загружаются: `pnpm exec vitest run --project contract` по каждому —
      ни одного `spawnSync /bin/sh ENOENT`; test-ы zsh — skipped с причиной; test-ы без zsh идут.
      Числа passed, skipped и failed по файлам — в «Итог». Это проверяет Session на Windows-ПК.
- [x] На macOS те же test-ы идут, как раньше: число test-ов каждого из шести файлов (passed и
      skipped) то же, что на main; числа — в «Итог».
- [x] Static check смотрит `test/contract`: красный на main (шесть вызовов найдены), зелёный после
      правки.
- [x] Мутант: вернуть `const ZSH = execFileSync(…)` в один из шести файлов — static check красный.
- [x] Четыре nit-а из пункта 4 закрыты: на каждый — случай в таблице unit-test-а, красный до правки
      static check и зелёный после (тёзка `start` из чужого модуля проходит; `new Promise` с вызовом
      найден; `import cp = require('child_process')` найден; `const { beforeAll } = test` —
      отложенный; нестатическое поле класса проходит, статическое найдено).
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0 на Mac; gate full — exit 0 и строка
      `[gate] зелено (full)` (оркестратор перед merge); Linux CI зелёный.

## Тесты

- Unit `test/unit/e2e-no-spawn-on-load.test.ts`: каталог `test/contract` в обходе; таблица случаев
  — вызов на верхнем уровне файла `test/contract` найден, вызов в теле test-а проходит; случаи
  четырёх nit-ов пункта 4.
- Мутант — выше.

## Где в коде

- `test/contract/terminal-ai-fix.test.ts`
- `test/contract/terminal-ai-next-command.test.ts`
- `test/contract/terminal-ai-request.test.ts`
- `test/contract/terminal-ai-suggest.test.ts`
- `test/contract/terminal-ai-zle.test.ts`
- `test/contract/terminal-shell-integration.test.ts`
- `test/e2e/zsh.ts`
- `test/unit/e2e-no-spawn-on-load.test.ts`

`test/e2e/zsh.ts` и `test/unit/e2e-no-spawn-on-load.test.ts` появляются с Ticket-ом 53 (PR #387);
отсюда `Blocked by: 53`.

Пересечения с другими Epic-ами: `test/contract/terminal-ai-request.test.ts` — в «Где в коде» Ticket-а
13 `worfy-terminal-ai` (панель ⌘I шлёт текущую строку shell-а), `test/contract/terminal-ai-zle.test.ts`
— Ticket-а 11 того же Epic-а (программа в Terminal-е пишет в соединение shell-а). Сверка перед claim;
кто влит вторым, тот делает rebase.

## Вне скоупа

- Другие файлы `test/contract`, которые на Windows падают по существу (`/bin/sh` как `SHELL` в
  test-е, stub-ы `#!/bin/sh`, команды POSIX) — Ticket 14.
- Terminal AI на Windows (PowerShell) — позже, вне Epic-а `worfy-terminal-ai`.

## Итог

Ветка `worfy-windows/54` поверх main `9cbe679`. Проверено на Windows-ПК (Windows 11 Pro, Git Bash, `gh` вне PATH).

### Что сделано

- **Поиск zsh — общий файл `test/zsh.ts`** (был `test/e2e/zsh.ts` Ticket-а 53): `zshPath()` спрашивает `/bin/sh` при первом вызове, `NO_ZSH`, `NO_ZSH_ON_WINDOWS`. Новое — `needsZsh(context)`: пропуск vitest-test-а с причиной там, где zsh нет (`beforeEach(needsZsh)` для describe, где zsh нужен всем test-ам). Восемь spec-ов `test/e2e` импортируют из нового места.
- **Шесть файлов `test/contract` зовут `zshPath()` там, где zsh нужен.** Test-ы zsh на `win32` пропускаются с причиной `NO_ZSH_ON_WINDOWS`; test-ы без zsh идут и на Windows. На macOS и Linux ничего не пропускается: число test-ов каждого файла то же, что на main (14, 22, 28, 35, 49, 20).
- **Три test-а, которые падали на Windows не из-за zsh, пропускаются там с причиной** «the test starts /bin/sh or expects the folder /tmp; Windows has neither» (`needsPosix(context)` в `test/zsh.ts`): «a shell that is not zsh gets no socket and no token» (`terminal-ai-zle`), «a shell that is not zsh (/bin/sh)…» и «the socket path in it fits zsh…; with a long TMPDIR the folder goes to /tmp…» (`terminal-shell-integration`). Ticket 14 берёт только другие файлы `test/contract`, поэтому они решены здесь; два из них ждали 10 s перед падением.
- **Static check `test/unit/e2e-no-spawn-on-load.test.ts` обходит `test/e2e`, `test/contract` и всё, что они загружают**, файлы `.ts` и `.tsx` (`.tsx` — jsdom-проект, например `ipc-renderer.test.tsx`). Четыре nit-а ревью PR #387:
  1. функция, запускающая процесс, опознаётся по файлу, где она объявлена, через импорт имени: тёзка из чужого модуля и метод с тем же именем — не она;
  2. `new Promise(fn)` выполняет `fn` сразу; `import cp = require('child_process')` распознаётся;
  3. отложенные вызовы (test-ы, их модификаторы, hook-и) определяются по тому, откуда взято имя: vitest, Playwright, деструктуризация `test`, `test.extend` под любым именем, в том числе импортированный из другого файла;
  4. инициализатор нестатического поля класса выполняется при `new`, статического — при загрузке.
- **Процессы при загрузке, оставленные намеренно** (`STARTED_ON_LOAD_ON_PURPOSE`, с причиной на каждый файл): шесть вызовов `git(…)` в `link-access.test.ts` (git есть на каждой системе test-ов); `execFileSync('node', …)` и `tool('jq')` в `statusline-bridge.test.ts` (`tool()` — `spawnSync`, который возвращает ошибку, а не бросает её); `hasSh()` в `workflow-profile.test.ts` и `workflow-reader.test.ts` (`spawnSync` для `it.skipIf`). Вызов сверяется по тексту; вызов, которого больше нет в файле, валит test, чтобы список не пережил его.

### Проверено на Windows-ПК

`pnpm exec vitest run --project contract <файл>` по каждому файлу:

| Файл | main `9cbe679` | ветка `c28e575` |
|---|---|---|
| `terminal-ai-fix` | exit 1, файл не загрузился: `spawnSync /bin/sh ENOENT`, 0 test-ов | exit 0: 4 passed, 10 skipped, 0 failed |
| `terminal-ai-next-command` | то же | exit 0: 8 passed, 14 skipped, 0 failed |
| `terminal-ai-request` | то же | exit 0: 6 passed, 22 skipped, 0 failed |
| `terminal-ai-suggest` | то же | exit 0: 13 passed, 22 skipped, 0 failed |
| `terminal-ai-zle` | то же | exit 0: 0 passed, 49 skipped, 0 failed |
| `terminal-shell-integration` | то же | exit 0: 0 passed, 20 skipped, 0 failed |

- Ни одного `ENOENT` на ветке; verbose reporter печатает причину рядом с каждым пропущенным test-ом.
- **Static check красный на main:** test-файл ветки, запущенный на дереве main, — exit 1, найдены шесть вызовов: `terminal-ai-fix.test.ts:45`, `terminal-ai-next-command.test.ts:41`, `terminal-ai-request.test.ts:48`, `terminal-ai-suggest.test.ts:42`, `terminal-ai-zle.test.ts:24`, `terminal-shell-integration.test.ts:24`. На ветке — exit 0, 45 passed.
- **Мутант:** `const ZSH = execFileSync('/bin/sh', ['-c', 'command -v zsh'], …)` на верхнем уровне `terminal-ai-suggest.test.ts` — static check exit 1, вызов найден в строке 2; после отката — exit 0.
- **Полный `pnpm test` по имени против main `9cbe679`:** новых падений нет. Четыре test-а, упавших в полном прогоне ветки (`critical-path`, `install-stable-functions`, `harness-install`, `harness-scripts` с `profile.test.sh`), прошли при повторе этих четырёх файлов: полный прогон шёл параллельно с проверками PR #461 на том же ПК. Итог полного прогона: main — 234 failed / 5487 passed / 151 skipped из 5872, ветка — 236 / 5529 / 288 из 6053 (шесть файлов загружаются и дают свои test-ы). Падения на main и на ветке — известные Windows-падения других Ticket-ов.
- `pnpm lint` — exit 0, `pnpm typecheck` — exit 0.
- Ревью (correctness и test coverage): три находки — три test-а без zsh, падавшие на Windows; `.tsx` вне обхода; намеренные процессы при загрузке не записаны в «Итог». Все три закрыты в commit-е `c28e575` и в этом разделе.

### Не проверено на ПК

- Пункт четырёх nit-ов: случаи в таблице unit-test-а есть и зелёные (45 passed), но «красный до правки static check» на ПК не воспроизводился — старая версия static check живёт в том же файле, что и таблица. Пункт не отмечен; проверка — на Mac или по истории commit-ов.
- macOS: число test-ов по файлам, `pnpm lint`/`typecheck`/`test`, gate full, Linux CI.

### Мерж и проверки на Mac (Session на Mac, 2026-10-18)

- PR #462 влит как `fa06b266`. Ревью на Mac, круг 1 ([комментарий](https://github.com/IDSAD-XL/worfy/pull/462#issuecomment-6244196062)): шесть файлов на macOS — 14 / 22 / 28 / 35 / 49 / 20 test-ов, пропусков нет, как на main, все 168 имён совпадают; каждый из четырёх nit-ов #387 — случай в таблице, красный на static check main и зелёный на ветке.
- Перед мержем `GATE_SCOPE=all` gate full на Mac — exit 0, `[gate] зелено (full): worfy/.:lint worfy/.:typecheck worfy/.:test worfy/.:test:e2e worfy/.:test:package` ([комментарий](https://github.com/IDSAD-XL/worfy/pull/462#issuecomment-6244540778)); Linux CI — batch CI run на main `e074b41f` (содержит `fa06b266`), run 39092198641, success.
