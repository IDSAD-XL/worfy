# 21 — Деление страницы Autopilot: Auto-approval на своей странице

Type: task
Status: claimed 2026-11-07T07:31Z
Blocked by: —
Source: решение владельца 2026-11-07, Q1 («да»: вынести Auto-approval со страницы Autopilot); Ticket [20](20-деление-страницы-autopilot.md) (его `## Итог` назвал кандидатов на следующее деление); «Как устроено» [spec.md](../spec.md) и решение владельца 2026-10-30, Q9 (страница больше примерно 400 строк делится на две); [ADR-0088](../../../docs/adr/0088-feature-pages-in-english.md) (английский как основной язык Feature page)

## Что происходит

- `docs/features/autopilot.md` — 674 строки на `main` 201947d7, перевод `docs/features/ru/autopilot.md` — 678. Правило
  Epic-а — больше примерно 400 строк делится на две.
- Ticket 20 вынес ожидания, остановки и Fault scenario-и на `docs/features/autopilot-faults.md`, но страница осталась на
  635 строках, а Ticket worfy-autopilot-queue 19 дописал её до 674. Ticket 20 назвал кандидатов на следующее деление:
  Auto-approval и запуск run-а из чата.
- Auto-approval описан в двух местах страницы: раздел `#### Auto-approval` в Behaviour (режимы, исходы политики, hard deny,
  где смотреть решения) и два длинных пункта списка в `#### During a run` (что бывает с запросом разрешения в Shadow и
  On, в том числе на Codex; временная папка и git-окружение run-а). Строки test-ов `auto-approve-*` — в `#### Tests`.
- На раздел ссылается `docs/features/sessions.md` (`autopilot.md#auto-approval`).

## Что делаем

1. Читает страницу и код из свежего `origin/main`. Новая страница `docs/features/auto-approval.md` получает всё об
   Auto-approval: раздел Behaviour, оба пункта из «During a run», абзац о том, почему политика не делает run опаснее
   `bypassPermissions` (в How it works), строки test-ов `auto-approve-*`.
2. Если `autopilot.md` и после этого заметно больше примерно 400 строк — выносит ещё один раздел, только самостоятельный
   (например запуск run-а из чата с `/worfy:epic-wave` и `autopilot_start`); выбор и итоговые размеры — в `## Итог`.
3. Новая страница — по шаблону Epic-а: **Behaviour**, **How it works**, **Implementation**; без номеров строк, без
   changelog. `autopilot.md` ссылается на неё одной строкой там, где была перенесённая часть.
4. Перевод в `docs/features/ru/` с шапкой `> Перевод [английской версии](../<page>.md), commit `same-pr`.` под
   заголовком; из `docs/features/ru/autopilot.md` уходит та же часть.
5. Строка новой страницы в индексе `docs/features/README.md` и `docs/features/ru/README.md`. Ссылки `docs/`, `src/`
   (Guide: `topic.json` и тексты), `CONTEXT.md`, `README.md` на перенесённые разделы ведут на новую страницу.

Не входит: правка содержания перенесённой части, кроме ссылок и одной вводной фразы.

## Готово, когда

- [ ] `docs/features/autopilot.md` не больше примерно 400 строк или в `## Итог` сказано, почему остальное не вынесено;
      размеры всех страниц до и после — в `## Итог`.
- [ ] Перевод новых страниц в `docs/features/ru/` с шапкой; из `docs/features/ru/autopilot.md` ушла та же часть.
- [ ] Индекс на обоих языках называет новые страницы; ни одна ссылка на перенесённый раздел не ведёт в пустоту
      (якоря проверены скриптом).
- [ ] `node scripts/check-feature-docs.mjs`, `node scripts/check-handoff.mjs`, `pnpm lint`, `pnpm typecheck`, `pnpm test` —
      exit 0; gate fast зелёный; `ci-ok` зелёный. Gate full не нужен: код не меняется.
- [ ] Review: один агент уровня `low` проверяет, что утверждения перенесены без изменений и ссылки живые.

## Тесты

Новых test-ов нет. Проверка путей Ticket-а 02 (`scripts/check-feature-docs.mjs`) читает новые английские страницы;
якоря ссылок проверяет разовый скрипт в scratchpad (в репозиторий не кладётся).

## Где в коде

- `docs/features/autopilot.md`
- `docs/features/auto-approval.md` (новый)
- `docs/features/ru/autopilot.md`
- `docs/features/ru/auto-approval.md` (новый)
- Вторая новая страница и её перевод, если `autopilot.md` после шага 1 заметно больше примерно 400 строк
- `docs/features/README.md`
- `docs/features/ru/README.md`
- Страницы со ссылками на перенесённые разделы: `docs/features/sessions.md`, `docs/features/cards.md` и их переводы
- `src/renderer/guide/topics/autopilot/topic.json`, если Topic опирается на перенесённый раздел
- `.scratch/worfy-feature-docs/spec.md` (строка Ticket-а 21)

## Вне скоупа

- Исправление найденных багов продукта и расхождений страницы с кодом: такая находка — в `## Итог`.
- Деление других страниц.
