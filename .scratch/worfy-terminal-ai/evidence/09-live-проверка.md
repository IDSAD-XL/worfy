# 09 — live-проверка Terminal AI на подписке, 2026-10-19

Stable copy, собранная из `main` `e61cb1fe`, pid main process 51064, запуск ~17:50 (время местное,
EEST, UTC+3). Подписка владельца, без `WORFY_AGENT=fake`. Лог — stdout Stable copy (в репозиторий не
кладётся: в нём пути машины и отпечатки ключей gate). Здесь — только подсчёты и выводы.

## Слова владельца

«Проверил терминал, все впорядке» — про ручные пункты: Suggestion из истории и от Haiku, второе окно,
история и `$HISTFILE`, Next command, Command request и панель ⌘I, Fix, `LimitsMeter`, переключатели
Settings. Время до серого текста в 10 попытках и пункт о thinking у Sonnet владелец не сообщал —
**не измерено**.

## Лог Stable copy (снимок до 18:00:37)

| Что | Сколько |
| --- | --- |
| строк `[terminal-ai] assist process: …` (init assist-процесса) | 17 |
| из них модель `claude-haiku-4-5-20251001` | 8 |
| из них модель `claude-sonnet-5-5` | 9 |
| запросов `suggest: model haiku` | 8 |
| запросов `next: model sonnet` | 5 |
| запросов `request: model sonnet` | 4 |
| запросов `fix: …` | 0 |
| `option_not_applied`, `claim refused`, `did not start`, `failed` | 0 |

- Каждая строка init: Claude Code 2.1.289, `apiKeySource none`, plugin-ы — только встроенные в Claude
  Code `cc-plugin-agents-md`, `cc-plugin-telemetry`, `cc-plugin-plugin-authoring`; plugin-ов
  пользователя нет (worfy, mattpocock и другие не грузятся); `hooks: not reported by init`.
  `claude --debug` для hooks встроенных plugin-ов не запускали.
- Строк `fix:` в логе нет: Fix, о котором говорит владелец, в этот снимок лога не попал (либо был
  позже 18:00:37, либо в другой копии). Расхождение записано, не разобрано.

## Процессы (`ps`, дети pid 51064)

- ~17:57: два процесса `claude`: 52480 (RSS 314 MB, 6:35) и 60702 (RSS 218 MB, 1:51).
- 18:30 и 18:36: один — 52480 (RSS 234 MB, 45:58). 60702 и 73885 закрылись.
- **52480 — не assist-процесс, а Session worfy.** Его argv: `--model opus`, `--effort high`,
  `--resume=<id Session-а>`, `--add-dir <папка cards worfy>`, `--plugin-dir-no-mcp <harness>`,
  `--settings {"autoCompactWindow":400000}` — опции Session-а (`src/main/agent/options.ts`: `resume`,
  `autoCompactWindow`). Assist-процесс стартует с `settingSources: []`, без MCP, моделью haiku или
  sonnet (`src/main/terminal-ai/options.ts`). Запущен через 3 с после старта приложения — по
  всей видимости, Session Card-ы, которую Stable copy продолжила при запуске (не проверялось).
- Значит, assist-процесс в каждый момент был один: 60702 (RSS 218 MB) — по времени, spare после
  последнего запроса (его argv не снят); после 10 минут без запросов его нет (18:30 — только Session). Пункт ADR-0058, 2
  выполняется.

## `~/.claude`

- `~/.claude/projects`: список папок до (17:41) и после (17:57) одинаковый — транскриптов нет.
- `~/.claude/sessions` до и после:
  - новые `52480.json` и `52480.<hash>.key` — запись Session-а 52480 (`cwd` — корень Project-а,
    `kind: interactive`, `entrypoint: sdk-ts`, `messagingSocketPath: /tmp/cc-socks/52480.sock`).
    Для Session-а это ожидаемо: worfy и находит живые Session-ы по этим файлам.
  - новый `60702.<hash>.key` без `60702.json` — spare assist-а публикует ключ своего messaging socket,
    пока жив; после его выхода файла нет.
  - `<pid>.json` assist-процесса в снимки не попал. По коду Claude Code 2.1.289 он пишется в момент
    claim и удаляется на выходе процесса, `cwd` — `<WORFY_DATA_DIR>/terminal-ai` (не Project).
    Разбор и план — Ticket [16](../issues/16-assist-процесс-в-списке-сессий-claude-code.md).
- `shasum ~/.zshrc` до и после одинаковый.

## Чего здесь нет

Времени ответа по функциям, Limits до и после, примеров ответов: владелец их не записывал. Сценарий
приватности с `WORFY_AGENT=fake` и `WORFY_TERMINAL_AI_LOG`, test-ы и gate full в этой проверке не
запускались.
