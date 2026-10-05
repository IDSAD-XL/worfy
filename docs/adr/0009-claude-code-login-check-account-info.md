# Вход в Claude Code проверяется через accountInfo(), а не apiKeySource

Дата: 2026-10-05. Статус: принят.

Спецификация эпика `worfy-mvp` (риск 3) называла признаком входа по подписке поле `apiKeySource` в сообщении `system/init`. Spike тикета 06 (`scripts/spikes/sdk-probe.ts`, сценарии `init` и `no-login`; SDK 0.3.289, Claude Code 2.1.289, Electron 44.5.1, macOS arm64) показал, что это поле признаком не служит.

**Решение.** worfy проверяет вход через `query.accountInfo()`: при входе в ответе есть `subscriptionType` (и `email`, `organization`), без входа — только `apiProvider` и `tokenSource: "none"`. Ход без входа заканчивается синтетическим ответом `Not logged in · Please run /login` (модель `<synthetic>`, `result` с `is_error: true`); worfy показывает его как ошибку Сессии с подсказкой войти в Claude Code. Ключей API worfy по-прежнему не принимает и не хранит.

**Почему.** `apiKeySource` в `system/init` равен `none` и при входе по подписке (Claude Max), и без входа (пустой `CLAUDE_CONFIG_DIR`).

Затронуты: тикет 07 (пункты «Готово, когда» про вход по подписке — через `accountInfo()`; показ ошибки «Not logged in»), спецификация эпика (риск 3: проверка через `apiKeySource` устарела; удаление `ANTHROPIC_API_KEY` и `ANTHROPIC_AUTH_TOKEN` остаётся, ADR-0007).

## Considered Options

- `apiKeySource` как признак входа, как в спецификации: не различает вход по подписке и его отсутствие.
- Чтение учётных данных Claude Code (Keychain, `~/.claude`) самим worfy: worfy не трогает чужие секреты; `accountInfo()` отвечает на тот же вопрос через SDK.
- Не проверять вход заранее и разбирать только синтетический ответ `Not logged in` после первого хода: пользователь узнаёт о проблеме, только когда уже отправил задачу.
