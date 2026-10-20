# 56 — Test checks handler в `github-prs.test.ts` зависит от login shell машины и печатает настоящий token

Type: task
Status: claimed 2026-10-20T17:48Z
Blocked by: —
Source: gate full PR [#563](https://github.com/IDSAD-XL/worfy/pull/563) (worfy-harness 40), 2026-10-20:
повторный прогон unit-набора оркестратором с временным HOME дал красный test, которого PR не трогает.
Причина найдена implementer-ом раунда правок #563.

## Что происходит

Test «the app's own checks handler reads the account with <WORFY_CLAUDE_HOME>/bin/profile and runs
WORFY_GH …» (`test/contract/github-prs.test.ts`, около строки 820) идёт через настоящий
`harnessScriptEnv` (`src/main/ipc/checks.ts:199` → `src/main/workflow/profile.ts:597`). Тот запускает
login shell разработчика с переменной HOME.

- **Временный HOME.** rc-файлы nvm не читаются, и `bin/profile` пишет «node not found in PATH». Тогда
  account = null, gh запускается без token, и test красный: ожидался `token: "gho_TestToken…"`, а
  пришло пусто. Так и на main, и с кодом #563. С настоящим HOME test зелёный.
- **`GH_TOKEN` в окружении.** Если он задан (сессии делают `export GH_TOKEN=$(gh auth token …)`),
  stub gh записывает настоящий token вместо тестового, и diff упавшего assertion-а печатает его в лог
  test-а. 2026-10-20 так в локальные логи попал настоящий token. Логи не публиковались и удалены.
  Скрипты gate и e2e оркестратора теперь делают `unset GH_TOKEN GITHUB_TOKEN`.

## Что делаем

1. Test передаёт свой `scriptEnv`, где node есть на PATH и нет login shell, так же как соседний test
   около строки 856. Результат больше не зависит от HOME и rc-файлов машины.
2. Перед запуском test убирает `GH_TOKEN` и `GITHUB_TOKEN` из окружения (`vi.stubEnv(…, undefined)`
   или явный env), чтобы настоящий token не дошёл до stub-а.
3. Проверить, есть ли в `github-prs.test.ts` и соседних contract-test-ах другие test-ы с настоящим
   `harnessScriptEnv` или с наследованием `GH_TOKEN`, и поправить их так же.

## Готово, когда

- [ ] `H=$(mktemp -d); HOME=$H HARNESS_HOME=$H/hh pnpm test test/contract/github-prs.test.ts` — exit 0.
- [ ] Тот же прогон с `GH_TOKEN=gho_REALLOOKING…` в окружении — exit 0, и строки `gho_REALLOOKING` нет в
      выводе.
- [ ] Мутант красный: test снова берёт `harnessScriptEnv` — красный под временным HOME.
- [ ] `pnpm lint`, `pnpm typecheck` — exit 0; полный `pnpm test` с временным HOME — exit 0.

## Где в коде

- `test/contract/github-prs.test.ts` — test около строки 820 и соседний около 856 (образец).
- `src/main/ipc/checks.ts:199` — `scriptEnv: harnessScriptEnv`.
- `src/main/workflow/profile.ts:597` — запуск `bin/profile` через login shell.

## Вне скоупа

- Поведение приложения: login shell для `bin/profile` в настоящем запуске остаётся.
- Скрипты gate (`harness/hooks/gate.mjs`): там `GH_TOKEN` уже снимает оркестратор у себя. Правка gate,
  если она понадобится, — отдельный платформенный PR.

## Итог

Заполняется при закрытии.
