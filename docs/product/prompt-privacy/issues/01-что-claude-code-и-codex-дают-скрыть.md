# 01 — Что Claude Code и Codex дают скрыть: prompt, вывод tool-ов, файлы

Type: research
Status: done 2026-11-28T03:42Z
Blocked by: —
Source: [map.md](../map.md), Notes — путь текста через `Session.send`; [заметка о Moon Blur](../research-moon-blur.md),
раздел «Что это значит для worfy»

## Question

worfy сам видит только текст, который отдаёт агенту. Что агент читает сам — файлы, вывод команд, ответы MCP-серверов,
— идёт в модель мимо worfy. Может ли hook или настройка Claude Code (UserPromptSubmit, PreToolUse с изменением входа,
PostToolUse для встроенных tool-ов и для MCP) заменить текст, который увидит модель? То же для Codex. Есть ли у них
своё маскирование секретов? Что поставщик хранит из prompt-ов и сколько (подписка Claude, API, Codex со входом через
ChatGPT) — то есть от чего вообще защищает маскирование?

## Answer

Заметка: [research-как-скрывают-данные-до-модели.md](../research-как-скрывают-данные-до-модели.md), раздел 1 и 2.
Ключевые места сверены второй раз по странице документации 2026-11-28. Главное:

- Prompt hook-ом не переписать ни в Claude Code, ни в Codex. `UserPromptSubmit` может только заблокировать prompt или
  добавить к нему контекст. Заблокированный prompt всё равно остаётся в локальном transcript-е и истории prompt-ов.
  Значит, вставленный текст маскирует только сам worfy, до `Session.send` → драйвер агента.
- Вывод tool-ов в Claude Code подменить можно: `PostToolUse` → `updatedToolOutput`, для встроенных tool-ов и MCP. Дыры
  названы в документации: значение, не совпавшее со schema встроенного tool-а, молча игнорируется, и модель получает
  оригинал; telemetry всегда видит оригинал; файлы через `@` вставляются без tool call, мимо hook-ов; schema вывода
  `Read` не описана. Codex умеет только заблокировать результат tool-а (модель получает текст hook-а), hosted tool-ы
  вроде `WebSearch` hook-и не видят.
- Единственная точка, которая видит всё, что уходит модели Claude Code, — proxy через `ANTHROPIC_BASE_URL`. По
  документации запросы идут через gateway и при входе по подписке claude.ai: «Requests still route through the gateway,
  but a saved claude.ai login remains the active credential» (https://code.claude.com/docs/en/llm-gateway). У Codex
  есть `openai_base_url`; работает ли он при входе через ChatGPT, не проверено.
- Хранение у поставщика: подписки Claude — 30 дней, до 5 лет, если включено «Help improve our AI models»; API — 30
  дней; личные аккаунты ChatGPT — «Improve the model for everyone» включено по умолчанию и действует на Codex. Локально
  transcript-ы Claude Code и rollout-ы Codex — открытый текст.
- Своего маскирования того, что уходит модели, нет ни у одного из двух CLI: redaction есть только для отчётов,
  telemetry и логов.
