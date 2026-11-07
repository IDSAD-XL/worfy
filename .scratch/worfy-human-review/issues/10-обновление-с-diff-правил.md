# 10 — Ежемесячное обновление ревьюера с diff правил

Type: task
Status: open
Blocked by: 08, 09
Source: [spec.md](../spec.md), «Решения владельца 2026-11-07», п. 3, 7, 9; «Как работает» → «Обновление»; «Вопросы владельцу», Q8

Платформенный Ticket: приложение читает `meta.json` в папке Profile-а на Mac и Windows — Windows verdict до merge
(ADR-0056). Глубина ревью — `medium`.

## Что происходит

- После Ticket-ов 06–08 генератор умеет только первый запуск; `review-history fetch --since` есть (Ticket 03).
- После Ticket-а 09 есть toast Project-а и раздел «Team reviewer» с «Build» и «Delete».

## Что делаем

1. `harness/skills/human-review-setup/refresh.md` и аргумент `--refresh` в `SKILL.md`: `fetch --since` даты из
   `meta.json`, `estimate` и «да», анализ новых PR вместе с прежним `research.md`, новый `SKILL.md` во временный
   черновик, diff правил — добавлено / изменено / убрано, у каждого `R<n>` и числа «было → стало», проверка на 5 PR
   (новые отложенные из нового окна). «Принять» — старые файлы в `previous/`, новые на место; «Отклонить» — ничего не
   меняется, `raw/` удаляется. Нового PR с ревью нет — так и сказать, токены не тратить.
2. Напоминание (Q8 (а)): при активации Project-а, если в частной папке есть `SKILL.md`, `meta.json` старше 30 дней и
   напоминание не показано за эти 30 дней, — `action`-toast «Update your team reviewer?», «Update» / «Later».
   Сам ничего не читает.
3. «Update» в toast-е и в разделе «Team reviewer» — новая Session Node с `/worfy:human-review-setup --refresh`.

## Готово, когда

- [ ] Contract test: `refresh.md` зовёт `fetch --since` и `estimate` до анализа; без «да» — ничего не меняется.
- [ ] Contract test: diff правил называет добавленные, изменённые и убранные правила с `R<n>`; «Отклонить» не трогает
      `SKILL.md`.
- [ ] Contract test: напоминание — только при `SKILL.md` и `meta.json` старше 30 дней, не чаще раза в 30 дней; кнопка
      «Update» открывает Session с `--refresh`.
- [ ] `node scripts/check-cyrillic.mjs` и `node scripts/eval-harness.mjs --dry-run --changed origin/main` — exit 0.
- [ ] `ci-ok` на PR зелёный; Windows verdict есть.

## Тесты

- `test/contract/harness-human-review-setup.test.ts` — `refresh.md`; `test/contract/projects.test.ts` — напоминание
  и «Update».
- Сначала падающий: напоминание на 31-й день — красный, пока его нет.

## Где в коде

- `harness/skills/human-review-setup/SKILL.md`
- `harness/skills/human-review-setup/refresh.md` (новый)
- `harness/evals/lib/coverage.json`
- `test/contract/harness-human-review-setup.test.ts`
- `src/main/projects/review-offer.ts`
- `src/renderer/shell/ProjectSettings.tsx`
- `test/contract/projects.test.ts`
