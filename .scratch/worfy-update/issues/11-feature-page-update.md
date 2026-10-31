# 11 — Feature page Update: `docs/features/updates.md` и перевод

Type: task
Status: open
Blocked by: 01, 02, 03, 04, 05, 06, 07, 08, 09, 10
Source: [spec.md](../spec.md), «Решено без владельца», Р14, «Риски», пункт 2 (откат руками); [ADR-0088](../../../docs/adr/0088-feature-pages-in-english.md) (английская страница, русский перевод с отметкой commit-а)

## Что происходит

- Feature page-и лежат в `docs/features/` по-английски, переводы — в `docs/features/ru/` (ADR-0088), список —
  `docs/features/README.md`. Шаблон раздела и проверки — `.scratch/worfy-feature-docs/spec.md`, «Шаблон
  раздела», «Проверки»; скрипт — `scripts/check-feature-docs.mjs`.
- К claim поведение Update собрано Ticket-ами 01–10; страницы о нём нет. `docs/features/harness.md`
  описывает кнопку Harness в toolbar без акцента и без Update, `docs/features/app-shell.md` — Settings без
  блока «Updates».

## Что делаем

1. `docs/features/updates.md` (новый) по шаблону раздела: что такое Update и Available update (термины
   CONTEXT.md), где видно, «Update automatically», «Restart when idle», откат (и руками, когда новая копия
   не стартует: переименовать `worfy-stable.previous`), сбой сборки, What's new, что не входит (подпись и
   Releases — E4, ADR-0089). Реализация — файлы `src/main/update/`, `scripts/install-stable.mjs`.
2. `docs/features/ru/updates.md` (новый) — перевод с отметкой commit-а английской версии.
3. Строка в `docs/features/README.md` и `docs/features/ru/README.md`; ссылка на страницу из
   `harness.md` (Harness после Update) и `app-shell.md` (Settings → General → Updates).

## Готово, когда

- [ ] `node scripts/check-feature-docs.mjs` — exit 0.
- [ ] Каждый путь и `file:line` страницы существует на `main` в момент PR.
- [ ] Тексты интерфейса на странице совпадают с кодом (`grep` каждой строки в `src/renderer/`).
- [ ] `pnpm lint` — exit 0; `ci-ok` зелёный.

## Тесты

- Новых test-ов нет: проверка — `scripts/check-feature-docs.mjs` и lint путей.

## Где в коде

- `docs/features/updates.md` (новый)
- `docs/features/ru/updates.md` (новый)
- `docs/features/README.md`, `docs/features/ru/README.md`
- `docs/features/app-shell.md`, `docs/features/harness.md`

Только читать: `.scratch/worfy-feature-docs/spec.md`, `src/main/update/`, `src/renderer/update/`.

## Итог

Заполняется при закрытии.
