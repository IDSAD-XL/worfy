# 03 — Contract test-ы не читают настоящий `~/.claude`: временный `WORFY_CLAUDE_HOME` по умолчанию

Type: task
Status: open
Blocked by: —
Source: [spec.md](../spec.md), кандидат R6; `HANDOFF.md`, «Риски и долги»: «[med] Contract test-ы читают
настоящий `~/.claude/settings.json`: если там `model: haiku`, падают 10 test-ов (`worfy-daily` 07 и 23)»;
«Итог» [`worfy-daily` 23](../../worfy-daily/issues/23-настройки-session-node-а.md), подраздел «Где в
коде» (`orchestrator.test.ts` пришлось перевести на временный `WORFY_CLAUDE_HOME`).

## Что происходит

- Папку Claude Code worfy берёт из `WORFY_CLAUDE_HOME`, без неё — `~/.claude` пользователя
  (`src/main/claude-home/registry.ts:2`). Модель и effort по умолчанию — из `settings.json` этой папки
  (`src/main/claude-home/user-model.ts`).
- `WORFY_CLAUDE_HOME` ставят 19 из 97 файлов `test/contract` (`agent-controls.test.ts:4-5` — образец).
  Общего setup-файла у project-а `contract` нет (`vitest.config.ts:61-67`). Остальные файлы читают
  настоящий `~/.claude` машины, где идёт прогон: с `model: haiku` там 10 test-ов красные — test-ы
  зависят от настроек владельца, а не от кода.

## Что делаем

1. **Воспроизвести без касания настоящего `~/.claude`:** прогон project-а `contract` с `HOME` во
   временной папке, где `.claude/settings.json` = `{"model":"haiku"}` и `.gitconfig` с `user.name` и
   `user.email` (git в test-ах берёт их из `HOME`). Список красных test-ов — в «Итог».
2. **`test/setup-contract.ts`** — `setupFiles` project-а `contract`: если `WORFY_CLAUDE_HOME` не задан,
   ставит его на новую пустую временную папку на файл test-ов и удаляет её после. Test, которому нужна
   своя папка, задаёт её сам, как сейчас.
3. **Песочница.** С `WORFY_CLAUDE_HOME` прогон считается песочницей: установка и перенос Harness
   разрешены (`src/shared/ipc/harness.ts:51`, `src/shared/ipc/harness-migration.ts:72`). Test-ы, которые
   проверяют отказ вне песочницы, снимают переменную у себя явно; найти их — `grep -rn "WORFY_CLAUDE_HOME"
   test/contract` и красные прогона после шага 2. Такие файлы исполнитель дописывает в «Где в коде» при claim.

## Готово, когда

- [ ] Прогон шага 1 (`HOME` во временной папке, `model: haiku`): `pnpm vitest run --project contract` —
      exit 0; до правки — красный, число красных test-ов — в «Итог».
- [ ] Test в `test/contract`: во время test-а `WORFY_CLAUDE_HOME` задан и не равен `~/.claude`
      (`os.homedir()`), и папка пустая, если test её не заполнял.
- [ ] Test-ы отказа вне песочницы по-прежнему проверяют отказ (переменная снята у них явно).
- [ ] Настоящий `~/.claude` не меняется: список файлов и время изменения `settings.json` до и после
      прогона совпадают (команда и вывод — в «Итог»).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full — exit 0 и строка
      `[gate] зелено (full)`; Linux CI зелёный.

## Тесты

- Сначала красный: прогон шага 1 до правки.
- Новый test `test/contract/claude-home-isolation.test.ts` — проверка переменной (пункт 2 «Готово, когда»).
- Мутанты: setup-файл не подключён; папка общая на все файлы (test-ы видят чужие записи); переменная
  ставится и поверх заданной test-ом. Каждый краснит свой test.

## Где в коде

- `vitest.config.ts`
- `test/setup-contract.ts`
- `test/contract/claude-home-isolation.test.ts`

Только читать (не в списке, чтобы не давать ложных пересечений Wave):
`test/contract/agent-controls.test.ts`, `src/main/claude-home/registry.ts`,
`src/main/claude-home/user-model.ts`, `src/shared/ipc/harness.ts`, `src/shared/ipc/harness-migration.ts`.

## Вне скоупа

- `harness/bin/tests/preflight.test.sh` и его `HOME` (`worfy-harness` 11) — это Harness.
- Project-ы `node` и `jsdom` — сначала найти, читают ли они `~/.claude`; если да — отдельный Ticket.
- e2e: у них своя временная папка в `launchApp`.

## Итог

—
