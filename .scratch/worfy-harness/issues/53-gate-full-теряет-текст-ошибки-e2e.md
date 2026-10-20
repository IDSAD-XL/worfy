# 53 — Gate full теряет текст ошибки e2e: в отчёте только хвост вывода, `test-results` перезаписывает следующий прогон Playwright

Type: task
Status: done 2026-10-20T05:12Z
PR: #561
Branch: worfy-harness/53
Blocked by: —
Source: заметка оркестратора на Mac 2026-10-19: gate full PR [#539](https://github.com/IDSAD-XL/worfy/pull/539)
(worfy-canvas 01) — e2e `test/e2e/family.spec.ts` упал один раз, а текст ошибки в `gate-539.log` не
сохранился, и `test-results` уже перезаписал `pnpm test:package`. Код перечитан по main `2af91b51`.

## Что происходит

- Gate (`harness/hooks/gate.mjs`; в установленном plugin-е — `~/.claude/worfy-harness/plugin/hooks/gate.mjs`)
  печатает для упавшего скрипта только последние 40 строк вывода (`outLines.slice(-40)`, `gate.mjs:935`).
  Вывод зелёных скриптов не хранится нигде. Своего log-файла gate не пишет. У e2e (`pnpm test:e2e`) в
  последних 40 строках — итог Playwright и список упавших test-ов, а сам текст ошибки (ожидание, локатор,
  снимок вызовов) выше и в отчёт не попадает.
- `test:e2e` (`electron-vite build && playwright test --grep-invert @packaged`, `package.json:20`) и
  `test:package` (`pnpm package && playwright test --grep @packaged`, `:21`) берут один
  `playwright.config.ts`, где `outputDir` не задан, — оба пишут в `test-results/`. Playwright очищает
  `outputDir` в начале прогона, поэтому `pnpm test:package` после gate full (проверки оркестратора на
  Mac перед merge) стирает `error-context.md` и trace упавшего e2e. Свой `outputDir` есть только у
  `playwright.acceptance.config.ts:27`.
- Итог: flaky e2e, который упал один раз, разобрать нельзя — ни текста, ни trace (см.
  [worfy-polish 34](../../worfy-polish/issues/34-flaky-test-ы-gate-full-2026-10-19.md), `family.spec`).

## Что делаем

1. **Полный вывод каждого скрипта gate — в файл.** Gate пишет вывод каждого скрипта (`lint`,
   `typecheck`, `test`, `e2e`, …) целиком в папку состояния gate рядом с вердиктом
   (`$HARNESS_HOME/gate/state/…`, по ключу worktree и времени прогона), и в отчёте упавшего скрипта рядом
   с хвостом — путь к файлу. Старые log-и чистятся (например, последние N прогонов на worktree).
2. **В хвосте e2e — строки ошибок.** Для скрипта e2e, кроме последних 40 строк, отчёт берёт блоки
   ошибок Playwright (строки от `Error:` до следующего test-а), с пределом размера.
3. **Свой `outputDir` у e2e и у packaged.** В `playwright.config.ts` — `outputDir` по виду прогона
   (например, `test-results/e2e` и `test-results/package` по `--grep` или по переменной окружения из
   скрипта `package.json`), чтобы `test:package` не стирал артефакты `test:e2e`. Пути в `.gitignore` и в
   местах, которые читают `test-results/` (поиск по репозиторию и plugin-у), — обновить.

## Готово, когда

- [ ] Test gate (`harness/hooks/tests/…` или `test/contract/gate*.test.ts` — где уже проверяется отчёт):
      скрипт, который пишет 500 строк и падает, — в отчёте хвост и путь к файлу; в файле все 500 строк;
      зелёный скрипт тоже оставляет файл.
- [ ] Тот же test: вывод в виде Playwright с ошибкой на 300-й строке из 500 — строки ошибки в отчёте.
- [ ] `pnpm test:e2e`, затем `pnpm test:package` на Mac: артефакт упавшего e2e (специально сломанный test в
      копии) остаётся после второго прогона; путь — в «Итог».
- [ ] Мутант красный: отчёт без пути к log-файлу.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full — exit 0 и строка `[gate] зелено (full)`.

## Тесты

- Сначала падающий: test отчёта gate с длинным выводом — пути к файлу нет.

## Где в коде

- `harness/hooks/gate.mjs` (`:935`, сборка отчёта)
- `playwright.config.ts`, `package.json` (`:20-21`), `.gitignore`
- test-ы gate в `harness/hooks/tests/`

Только читать: `playwright.acceptance.config.ts` (`:27`, образец своего `outputDir`).

## Вне скоупа

- Причины самих flaky test-ов — worfy-polish 34.
- Скрипты оркестратора вне репозитория (`gate-N.sh`, `serve.sh`) — они читают отчёт gate как есть.

## Итог

PR #561, merge 97346282. Платформенный PR (harness/hooks): Mac gate full зелёный со второго прогона
(первый упал на flaky test `session-back.spec.ts:138`, который PR не трогает), check/windows — success.

- Логи gate: новый `harness/hooks/gate-log.mjs`. Полный вывод каждого скрипта, зелёного тоже, пишется в
  `$HARNESS_HOME/gate/state/logs/<tag worktree>/<run>/NN-<label>.log`; хранятся 10 последних прогонов на
  worktree, папки чужих worktree без изменений 8 дней удаляются. В отчёте под 40 строками хвоста —
  строка `--- full output (N lines): <path>`.
- Ошибки Playwright выше хвоста: блоки упавших test-ов из полного вывода попадают в отчёт, не больше
  60 строк на блок и 200 всего, строки режутся на 500 символах.
- Папки Playwright: `outputDir: 'test-results/e2e'`, `test:package` пишет в `test-results/package`.
  Проверка оркестратора после gate full на объединённом дереве: в `test-results` ровно `e2e`
  (252 записи, папка на test) и `package` (`packaged-*`) — второй прогон больше не стирает артефакты
  упавшего e2e.
- Test-ы: `harness/hooks/tests/gate-log.test.sh` (20 проверок; до правки 11 из 14 первых были красные);
  мутант без строки `--- full output` — красный. `gate-verdict`, `gate-file-size`, `gate-shim` зелёные.
  На объединённом дереве `harness-scripts` 43/43, `plugin-neutral` 26/26.
- Хвост: проверка, что `pruneLogs` никогда не удаляет вне `<state>/logs`, добавлена в раунде правок.

