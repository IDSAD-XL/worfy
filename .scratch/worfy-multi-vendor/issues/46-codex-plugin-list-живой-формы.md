# 46 — Разбор `codex plugin list --json` живой формы

Type: bug
Status: open
Blocked by:
Source: приёмка Ticket-а 32 на Mac Stable `460fb561`, 2026-11-04: toolbar показывает «Codex error: plugin list»

## Что происходит

Codex 0.166.0 печатает `codex plugin list --json` как `{"installed": [...], "available": [...]}`; у plugin-а —
`pluginId` (`name@marketplace`), `name`, `marketplaceName`, `version`, `installed`, `enabled`. Разбор
`codexPluginsOf` (`src/main/harness/codex-install.ts:128`) знает только список, `{plugins}` и `{marketplaces}`
и не читает `pluginId`, поэтому отвечает null, и статус Harness в Codex — ошибка шага `plugin list`
(«printed no list of plugins»). Форма была угадана без живой записи. `plugin marketplace list --json`
(`{"marketplaces": [{name, ...}]}`) разбирается верно.

## Что делаем

1. `codexPluginsOf` читает `{installed: [...]}` (только этот массив; `available` — не установленные) и ключ
   `pluginId`; прежние формы читаются как раньше.
2. Fixture живого ответа (пути без имени пользователя) и fake Codex CLI, который печатает эту форму; test-ы
   install/status Harness в Codex идут по ней.
3. Проверить остальные команды Codex CLI, которые запускает установка (`plugin install`, `plugin marketplace add`,
   `plugin upgrade`/`remove`, если есть): какие из их ответов worfy разбирает и угаданы ли они так же.

Глубина review — `medium`.

## Готово, когда

- [x] Unit test: живой ответ 0.166.0 даёт карту plugin-ов с `version` и `enabled`; Harness `worfy@worfy-harness`
      находится, когда он в `installed`.
- [x] Contract test статуса и установки Harness в Codex на fake CLI живой формы — exit 0.
- [x] Все unit и contract test-ы Harness и codex-*, `pnpm typecheck`, `pnpm lint` — exit 0.

## Где в коде

- `src/main/harness/codex-install.ts` — `codexPluginsOf`, разбор `codex plugin list --json`.
- `test/fixtures/codex-cli/` — живой ответ Codex 0.166.0 и README.
- `test/contract/harness-codex-install.test.ts` — fake Codex CLI и unit test разбора.
- `test/contract/codex-parity.test.ts`, `test/e2e/codex-hooks-step.spec.ts` — их fake Codex CLI печатает ту же форму.

## Итог

- `codexPluginsOf` читает `{installed: [...], available: [...]}`: только массив `installed`, ключ plugin-а — `pluginId`
  (`name@marketplace`), версия — `version`, `enabled` — как есть. Прежние формы (список, `{plugins}`, `{marketplaces}`)
  читаются как раньше.
- Fixture `test/fixtures/codex-cli/plugin-list-0.166.0.json` — живой ответ владельца, домашняя папка заменена на
  `/Users/me`, урезан (публичный репозиторий): из 22 plugin-ов в `installed` оставлены 10 локальных и два remote
  (`github`, `plugin-management`), их `source.id` заменены на `plugin_connector_example_<n>`; `available` пуст.
  Unit test читает его целиком и находит
  `worfy@worfy-harness`, когда он добавлен в `installed`.
- Три fake Codex CLI (contract test установки, contract test parity, e2e шага «Approve the Harness hooks in Codex»)
  печатают живую форму `plugin list` и `plugin marketplace list` (`{name, root, marketplaceSource}`). На старом разборе
  contract test установки падает: 10 из 19 test-ов, как у владельца, «printed no list of plugins».
- Снимки e2e после установки в Codex на fake живой формы: toolbar — «Codex: approve hooks», не ошибка `plugin list`:
  [светлая](../evidence/46/46-codex-live-plugin-list-after-install-light.png),
  [тёмная](../evidence/46/46-codex-live-plugin-list-after-install-dark.png).
- Остальные команды Codex CLI установки (пункт 3): `plugin marketplace list --json` — разбирается только `name`,
  совпадает с живой формой; `plugin add` — ответ не разбирается, важен только exit code; `plugin marketplace add` —
  в тексте ответа ищутся «already added» и «different source», это угадано по help-тексту, живой записи нет. Риск
  мал: план добавляет marketplace, только когда живой `marketplace list` его не называет. `plugin upgrade`/`remove`
  установка в Codex не запускает.
- Решено без владельца, подтвердить: plugin из `available` не считается установленным, даже если в нём
  `installed: true` (массив `available` не читается вовсе).
