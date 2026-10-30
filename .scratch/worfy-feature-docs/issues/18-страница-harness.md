# 18 — Страница Harness

Type: task
Status: open
Blocked by: 08, 09, 10, 11, 12, 13, 14, 15, 16, 17
Source: «Как устроено» и Q8, Q9 [spec.md](../spec.md); решения владельца 2026-10-30, Q2, Q3, Q7, Q9, Q10, Q20, Q21, Q22; [ADR-0088](../../../docs/adr/0088-feature-pages-in-english.md) (английский как основной язык Feature page)

## Что происходит

- Описания этих Feature в репозитории нет. После Ticket-а 01 `docs/features/harness.md` и
  `docs/features/ru/harness.md` — заготовки в одну строку.
- Страница лежит в `docs/features/`, а не внутри plugin-а. Поэтому ADR-0074 (содержимое plugin-а на английском) и `check-cyrillic`, который читает Markdown `harness/`, её русский перевод не затрагивают.
- Страницы приложения к этому моменту есть, на них можно ссылаться, например на Autopilot и Gate.

## Что делаем

1. Читает код и test-ы из свежего `origin/main`. Это источник страницы (Q7). Ticket-ы и ADR нужны только
   для «почему так» и как подсказка, где искать.
2. Пишет `docs/features/harness.md` на английском, по разделу на каждый Feature:
- Установка из приложения.
- Plugin.
- Skills.
- Агенты.
- Hooks.
3. В каждом разделе — три блока шаблона: **Behaviour** (без путей), **How it works** («почему так» — одна-две
   фразы и ссылка на ADR), **Implementation** (модули и точки входа с путями, поток данных, главные test-ы;
   без номеров строк и без копий сигнатур). Отличия платформ и работа на Linked machine — подзаголовком внутри нужного блока (`On a Linked machine`). Для Feature с многими состояниями внутри Behaviour разрешены подзаголовки и таблицы. Конкретные числа на странице остаются. Linux не описывается: пакета для него нет. Скриншотов
   нет. Только настоящее: без changelog и без пересказа ADR. Пути — в форме из индекса
   `docs/features/README.md`.
4. Утверждение, которое не подтверждается кодом или test-ом, на страницу не попадает. Оно уходит в раздел
   `## Итог` этого Ticket-а (Q20). Запускать приложение не нужно, платных запросов к Claude нет.
5. Страница вышла больше примерно 400 строк — делит её на две и пишет об этом в `## Итог`, таблица spec-а и
   индекс правятся отдельным PR (Q9).
6. Пишет `docs/features/ru/harness.md`: перевод с шапкой `> Перевод [английской версии](../harness.md), commit `same-pr`.`
   под заголовком. Термины и названия UI остаются на английском.
7. Индекс не правит (Q22).

## Готово, когда

- [ ] Обе страницы в `main`, заготовки заменены, разделы соответствуют списку или отличия объяснены в
      `## Итог`.
- [ ] Страница на английском, это не ошибка: для `docs/features/` действует исключение ADR-0088.
- [ ] Review: один агент уровня `low` сверяет каждое утверждение с кодом и проверяет, что на странице нет
      номеров строк. Merge блокирует только неверное утверждение (Q21; исключение из правила о PR только с
      документами, раздел «Исключения» spec-а). Отчёт review называет уровень и потраченные токены.
- [ ] `ci-ok` зелёный. Gate full не нужен: код не меняется.
- [ ] `## Итог` называет утверждения, которые не подтвердились. Токены на страницу записывает Orchestrator
      при закрытии Ticket-а, не implementer.

## Тесты

Новых test-ов нет. Проверка путей Ticket-а 02 читает английскую страницу.

## Где в коде

Папки выведены из имён, код при составлении Ticket-а не читался. Автор проверяет список при claim и дополняет:

- `src/main/harness`
- `src/renderer/harness`
- `harness/skills`
- `harness/agents`
- `harness/hooks`
- `harness/bin`
- `harness/lib`
- `harness/profiles`

## Вне скоупа

- Исправление найденных багов продукта: такая находка — в `## Итог`.
- Feature, которых нет в `main`.

## Итог

Страница вышла больше 400 строк и разделена на две: `docs/features/harness.md` (Installing from the app, Plugin) и
`docs/features/skills-agents-and-hooks.md` (Skills, Agents, Hooks). Перевод каждой лежит в `docs/features/ru/`. Строка индекса
`docs/features/README.md` и таблица `spec.md` называют пять разделов на одной странице: это правится отдельным PR.

Страница описывает `main` без изменений PR #1084 (поле `docs.feature_pages`, шаг в ship-ticket, линза `documentation`).

**Сверка папок из «Где в коде».** Список был неполным. Страница использует ещё `harness/.claude-plugin`, `harness/.mcp.json`,
`src/main/ipc/harness.ts`, `src/main/ipc/harness-migration.ts`, `src/shared/ipc/harness.ts`,
`src/shared/ipc/harness-migration.ts`, `src/renderer/shell/toolbar/HarnessStatus.tsx`, `src/main/first-run/actions.ts`,
`src/main/agent/options.ts`, `src/main/agent/app-registry.ts`, `src/main/workflow/profile.ts`, `electron.vite.config.ts`,
`electron-builder.yml` и `scripts/build-version.ts`. В `src/renderer/harness` лежит только форма переноса.

**Утверждения, которые не подтвердились и на страницу не попали:**

- `harness/agents/implementer.md`: «The PreToolUse check on Edit and Write lets edits through only inside the session's tree».
  В `harness/hooks/hooks.json` `PreToolUse` есть только на Bash. Если такая проверка есть, она не в plugin-е.
- Что делают на Windows `qmd-mcp`, `qmd-refresh` и `qmd-sync-main`. Это zsh-скрипты, а hook `Stop` называет `qmd-refresh` напрямую.
  Код не говорит, как это работает на Windows.
- `harness/README.md`: «Some text is still in Russian». Кириллица нашлась только в `harness/skills/epic-wave/SKILL.md`,
  `harness/profiles/README.md` и `harness/profiles/draft.schema.json`, поэтому страница говорит только о словах других языков,
  которые читают скрипты. Подробнее не проверялось.

**Возможные баги продукта (код не менялся):**

- `harness/README.md`, строка про skills: нет `connect-project`, хотя skill есть в `harness/skills/`.
- `harness/skills/retro/SKILL.md`, `harness/skills/tickets-to-tasks/SKILL.md` и `harness/skills/continuous-audit/SKILL.md` называют
  контракт Profile по старому пути `~/.claude/profiles/README.md`. Настоящий путь: `profiles/README.md` внутри plugin-а.

