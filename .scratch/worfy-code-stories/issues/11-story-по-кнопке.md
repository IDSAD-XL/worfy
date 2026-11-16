# 11 — Story по кнопке: PR без story, PR Session, PR коллег, story Epic-а до конца

Type: feature
Status: open
Blocked by: 04, 08, 09
Source: [spec.md](../spec.md), «Ticket-ы», строка 11; «Решения владельца» 6, 9, 13, 18, 19, 25 (строки 97, 101–102,
109–112, 118–120, 129–131); «Решения по реализации» → worfy: «Невидимый агент», «Progress bar», «Story по кнопке»
(строки 256–267); «Решения по test-ам», Б (строки 282–284); «Риски»: «Цена» (строки 339–345); истории 14–19, 28

Кто: агент.

## Что происходит

- Story PR пишет implementer только для PR Ticket-а (Ticket 05). У PR обычной Session, PR коллег, старых PR и у Epic-а до
  его конца story нет.
- Невидимый агент, progress bar и путь fake агента даёт Ticket 04 (`oneShot` Vendor-а Project-а). Хранилище story по
  кнопке — Ticket 08 (по образцу `src/main/projects/pr-inbox-state.ts`). Вид — Ticket 09.
- PR коллег worfy уже читает для PR inbox (`src/main/github/inbox.ts`) и не сохраняет их слова на диск (ADR-0105).
- По оценке прототипа story по кнопке после merge — около 100 тыс. token-ов на PR.

## Что делаем

1. Кнопка «Code story» у PR без story (Pull requests, карточка Ticket-а без story PR) и «Story» у Epic-а без `story.md`.
   Нажатие запускает сборку; progress bar — на месте кнопки (Ticket 04).
2. Вход агента:
   - для PR — diff PR, текст PR, файл Ticket-а и вердикты, если они есть. Diff идёт в тексте запроса: Bash у
     `oneShot` запрещён;
   - для Epic-а до конца — готовые story PR и spec. Неготовые Ticket-ы помечены в «Начале» (решение 18).
   - запрос передаёт `readFolders` (checkout PR), как `StoryBuilder` Ticket-а 04: только с ним драйвер Claude Code
     отказывает в Read, Glob и Grep вне этой папки и cwd запроса (`src/main/vendors/claude/read-guard.ts`, аудит
     2026-11-16). Diff и текст PR пишет автор PR, в том числе посторонний; `harness: true` запросу не нужен.
3. Выход — story по формату Ticket-а 01 через `outputSchema`. Сохраняется в хранилище Ticket-а 08.
4. PR коллег — только текст агента и ссылки `path:line@commit`, без слов коллег. Код фрагментов worfy читает из git,
   когда показывает шаг. Опубликовать story на GitHub нельзя (раздел «Не в этом Epic-е»).
5. Сборку можно остановить. Остановленная сборка ничего не сохраняет. Повторное нажатие на PR с сохранённой story
   открывает её, а не собирает заново; пересобрать — отдельное действие.
6. Vendor — тот, что у Project-а (решение 25). Project на Codex без `oneShot` — причина из Ticket-а 04.
7. Story Epic-а до конца: главы взяты из разных PR, у каждой свой head, и одно поле `Commit:` в шапке (`TICKETS.md`,
   раздел «Code story», поле Header) не подходит. Каждая глава несёт head своего PR; Ticket дописывает это в формат
   `TICKETS.md`.
8. Цену первых сборок (token-ы из ответа `oneShot`, если Vendor их даёт) записать в «Итог».

## Готово, когда

- [ ] e2e (`WORFY_AGENT=fake`): «Code story» у PR обычной Session → progress bar → вид Story; ни одного нового Session
      Node (проверка как у contract test-а запроса списка MCP, `worfy-mcp-live` 14).
- [ ] e2e: story Epic-а до конца — неготовые Ticket-ы помечены в «Начале».
- [ ] `TICKETS.md` описывает head PR у каждой главы story Epic-а по кнопке. Contract test: в сохранённой story у каждой
      главы свой head, и код главы читается из него.
- [ ] Contract test: в запросе есть diff, текст PR, файл Ticket-а и вердикты; у PR коллеги в сохранённом файле нет
      текста PR и комментариев.
- [ ] Contract test: остановка во время сборки — ничего не сохранено; повторное нажатие на PR с сохранённой story
      открывает её без нового запроса.
- [ ] Unit test: на Project-е с Codex без `oneShot` кнопка показывает причину и не запускает запрос.
- [ ] lint, typecheck, test-ы модуля и gate fast — exit 0.

## Тесты

- e2e с fake агентом и contract test-ы входа, хранения и остановки; каждый сначала красный.

## Где в коде

- `harness/bin/TICKETS.md` (head PR у главы story Epic-а по кнопке)
- `src/main/stories/by-button.ts` (новый: вход агента для PR и для Epic-а)
- `src/main/stories/one-shot.ts`, `src/main/stories/store.ts` (из Ticket-ов 04 и 08)
- `src/main/ipc/stories.ts`, `src/shared/ipc/stories.ts`
- `src/main/github/inbox.ts` (только если нужен diff PR коллеги)
- `src/renderer/pr-inbox/PrInboxView.tsx`, `src/renderer/canvas/actions/EpicStory.tsx`,
  `src/renderer/canvas/actions/TicketStory.tsx` (кнопки Ticket-а 10; он в той же Wave — кто вливается вторым, подключает
  сборку к кнопкам)
- `test/contract/story-by-button.test.ts` (новый)
- `test/e2e/code-story.spec.ts`
- `test/fixtures/agent-scripts/` (сценарий сборки)

Только читать: `src/main/projects/pr-inbox-state.ts`, `docs/adr/0105-pr-reply-only-on-the-users-click.md`.

## Вне скоупа

- Story правок, которые ещё не стали PR (экран Changes, `worfy-changes-view`).
