# 82 — `projects-connect.spec.ts` на Windows: диалог показывает стадию `harness`, а не `form`

Type: task
Status: done 2026-10-21T07:45Z
PR: #671
Blocked by: 80
Source: проверка тикета 80 на ПК владельца (PR #667) и решение Session на Mac, 2026-10-21.

## Что происходит

На Windows падают три test-а `test/e2e/projects-connect.spec.ts`:

- `:73` «Add project connects a new repository…»;
- `:230` «the GitHub account: the active account with access by default…»;
- `:294` «the GitHub account: gh failing says why…».

Ошибка у всех одна: диалог подключения Project-а ждут на стадии `form`, а он на стадии `harness`
(`Expected: "form"`, `Received: "harness"`). Стадия `harness` значит: worfy считает, что Harness не
установлен (так же, как test `:172` вызывает её нарочно).

Падают одинаково и на ветке тикета 79 (до фикса тикета 80), и на ветке тикета 80. В обоих прогонах
watcher `gh.exe` видел 0 запусков настоящего gh. Значит, причина не в gh-stub-е.

Предположение, не проверено: поиск Harness (`src/main/harness/locate.ts`, `harnessHomes`) на Windows
не находит Harness песочницы test-а — путь, переменная окружения или формат пути отличаются от macOS.

## Что делаем

1. Найти, почему на Windows Harness песочницы не находится в этих test-ах.
2. Исправить код или песочницу так, чтобы три test-а проходили на Windows, не меняя их смысла на macOS.

## Готово, когда

- [x] Названа причина стадии `harness` на Windows.
- [x] `projects-connect.spec.ts` на Windows — зелёный, под watcher-ом `gh.exe` 0 запусков gh.
- [x] Unit test на причину, если она в коде worfy (красный без фикса).
- [x] `pnpm typecheck`, `pnpm lint` — exit 0.

## Вне скоупа

- Проверки first-run на Windows и stand-in-ы инструментов — тикет 81.

## Итог

Причин четыре. Все в том, как test-ы запускают инструменты на Windows; каждая следующая была видна,
только когда исправлена предыдущая.

1. Стадия `harness`. `projects-connect.spec.ts` и `select.spec.ts` давали в `WORFY_CLAUDE` stand-in
   Claude Code — скрипт `#!/bin/sh`. Windows такой не запускает, проверка Harness падала с ошибкой, и
   диалог останавливался на стадии `harness`. Теперь stand-in общий, `.mjs`
   (`test/e2e/claude-plugin-stub.ts`): worfy запускает его своим Node на любой системе
   (`src/main/program.ts`).
2. `bin/profile` Harness — тоже скрипт `#!/usr/bin/env node`; `:281` запускал его напрямую. Теперь
   через Node (`process.execPath`).
3. «Sign in with gh». На Windows stand-in gh — `.mjs`, а `signInCommand` отдавал его node-pty как
   программу (это был долг тикета 80). Под своим Node тоже нельзя: worfy.exe — GUI-программа, и в
   pseudo-terminal (ConPTY) она ничего не печатает и не читает (проверено на ПК). Теперь `.mjs` на
   Windows идёт через `node.exe` из Path терминала; без него — ошибка с причиной. На macOS — через Node
   самого worfy (`programStart`). Contract test-ы в `test/contract/github-accounts.test.ts`.
4. Язык отчётов по умолчанию — язык системы (`app.getLocale()`), а `select.spec.ts` ждёт `en`. На ПК
   владельца Windows на русском, и было `ru`. Теперь `launchApp` запускает приложение с `--lang=en-US`
   (`ENGLISH_LOCALE` в `test/e2e/helpers.ts`); macOS этот флаг не читает.

Плюс: `:110` ждал путь в JSON без экранирования; на Windows обратные слэши в JSON удвоены
(`JSON.stringify`).

На ПК 2026-10-21: `projects-connect.spec.ts` и `select.spec.ts` под watcher-ом `gh.exe` — 6 passed,
0 запусков gh; typecheck, lint — exit 0.
