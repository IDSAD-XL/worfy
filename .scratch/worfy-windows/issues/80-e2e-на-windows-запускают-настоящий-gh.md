# 80 — e2e на Windows запускают настоящий `gh.exe`

Type: task
Status: open
Branch: worfy-windows/80-e2e-gh-stub
Blocked by: —
Source: прогоны на ПК владельца 2026-10-21 (тикет 79, PR #665); решение Session на Mac того же дня.

## Что происходит

Правило: из test-ов настоящий gh не запускается, только stand-in (`test/fixtures/gh/gh-stub.mjs`
через `WORFY_GH`). На Windows e2e его нарушают.

- Watcher процессов `gh.exe` во время прогона `window.spec.ts` (ветка тикета 79) увидел 4 запуска:
  `gh --version` и `gh auth status` от двух процессов `electron.exe` приложения под test-ом.
- `settings-health.spec.ts` и `first-run.spec.ts` на Windows запускали те же команды: проверки first-run
  (`src/main/first-run/checks.ts`, строки gh и GitHub accounts) ищут gh по PATH и не смотрят на
  `WORFY_GH`, а на Windows этот PATH — из реестра, с настоящим gh. Эти два spec-а тикет 79 выключил
  на Windows (тикет 81 вернёт их).
- В прогонах 2026-10-21 на ПК настоящий gh так запускался несколько раз: PR #661, main `85cec301` и
  ветка тикета 79 (`window.spec.ts`, `settings-health.spec.ts`, `first-run.spec.ts`). Только
  `gh --version` и `gh auth status`: команды, которые ничего не меняют и не запускают Actions.
  Вреда нет, но правило нарушено.

`launchApp` ставит `WORFY_GH` на stub и `WORFY_FIRST_RUN_AUTO=0`. Кто делает 4 запуска из
`window.spec.ts` при этих переменных — выяснить в этом тикете. Возможная причина:
`src/main/github/accounts.ts` на Windows требует от `WORFY_GH` полный путь к `gh.exe`.

## Что делаем

1. Найти, какой код запускает gh в обход stub-а в e2e на Windows, и закрыть каждый путь.
2. Все запуски приложения в e2e — через `WORFY_GH` на stub, и все места worfy, что запускают gh,
   слушают `WORFY_GH`.
3. Guard test, который падает, если запуск приложения в e2e может дойти до настоящего `gh.exe`.

## Готово, когда

- [ ] Названо, что запускало gh в `window.spec.ts`, и этот путь закрыт.
- [ ] Guard test: красный, если e2e запускает приложение без stub-а gh или если код worfy запускает
      gh в обход `WORFY_GH`; мутанты фикса — красные.
- [ ] На Windows прогон `window.spec.ts` под watcher-ом `gh.exe` — 0 запусков настоящего gh.
- [ ] `pnpm typecheck`, `pnpm lint` — exit 0.

## Вне скоупа

- Seam, чтобы проверки first-run на Windows видели stand-in-ы остальных инструментов, и включение
  `settings-health.spec.ts` и `first-run.spec.ts` на Windows — тикет 81.
