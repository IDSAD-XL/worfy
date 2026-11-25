# 10 — Session Assistant-а: cwd вне Project-ов, третий вид Session в Harness, только tools `worfy-app`, файл памяти

Type: task
Status: open
Blocked by: 06, 09
Source: [spec.md](../spec.md), «Ticket-ы», строка 10; «Решение», слой 2; «Решения владельца», 2 и 11; «Решения по
реализации» → «Session Assistant-а»; «Границы», 1; «Решения по test-ам», В; «Волны», Wave 4

Кто: агент.

## Что строить

1. **Где работает.** Claude Code; cwd — папка данных worfy вне всех Project-ов, поэтому `CLAUDE.md` и hooks Project-ов
   не грузятся. На Canvas Project-ов её нет.
2. **Правила.** Третий вид Session для Harness: `WORFY_SESSION_KIND` с новым значением и свой файл правил.
3. **Tools.** Только tools `worfy-app` (Ticket 09); Bash, запись файлов и сеть запрещены. Образец — Session черновика
   профиля.
4. **Пробуждение.** Новая Session на каждое пробуждение (решение о пробуждении — Ticket 06).
5. **Память — файл состояния:** обязанности, открытые предложения, обязательства, правила из оценок, ответы пользователя.
6. **Модели.** Рассуждает сильная модель. Haiku 5.5 только сортирует текст внешних источников (Ticket 11).

## Где в коде

- `WORFY_SESSION_KIND` — `src/main/vendors/claude/options.ts` (`SESSION_KIND_VARIABLE`, значение `product`).
- Правила по виду Session — `harness/hooks/inject-rules.mjs`; правила Product Session — `harness/hooks/rules/product.md`.
- Session черновика профиля — `src/main/projects/connect.ts`.
- Запрет tools у одноразового вызова — `src/main/vendors/claude/one-shot.ts`.

## Решения

- Session Claude Code на каждое пробуждение, вне всех Project-ов, со своими правилами Harness и одним MCP-сервером
  `worfy-app`; память — файл состояния (spec, «Решение», слой 2; решение 11 — вариант c).
- Haiku 5.5 вместо Haiku 4.5 только для сортировки (решение 2; spec, «Session Assistant-а», «Модели»).
- Граница 1: у Assistant-а только tools `worfy-app`, нет Bash, записи файлов и сети (spec, «Границы»).

## Test-ы

Стык В (spec, «Решения по test-ам»): отдельный unit test — у Session Assistant-а нет Bash. Сценарий e2e с fake агентом
(`WORFY_AGENT=fake`) — Ticket-ы 14–16.

## Готово, когда

- [ ] Session Assistant-а стартует с cwd в папке данных worfy вне всех Project-ов; `CLAUDE.md` и hooks Project-ов не
      грузятся; на Canvas Project-ов её нет.
- [ ] `WORFY_SESSION_KIND` получает новое значение; Harness для него печатает свой файл правил.
- [ ] Unit test: у Session Assistant-а нет Bash, записи файлов и сети; есть только tools `worfy-app`.
- [ ] Unit test: каждое пробуждение — новая Session.
- [ ] Файл памяти хранит обязанности, открытые предложения, обязательства, правила из оценок и ответы пользователя; новая
      Session его читает.
- [ ] Session Assistant-а идёт не на Haiku.
- [ ] pr-follow и autopilot-start, которые запустил Assistant, пишутся в журнал Assistant-а (Ticket 08) вместе с
      пунктом, который их вызвал (ADR-0114, граница 6). Сейчас `journal` в `appWorfyAppDeps`
      (`src/main/mcp/app-server.ts`) пишет их только в log main (review PR #2240 Ticket-а 09).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
