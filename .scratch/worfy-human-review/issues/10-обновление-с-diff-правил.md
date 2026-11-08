# 10 — Ежемесячное обновление ревьюера с diff правил

Type: task
Status: done 2026-11-08T12:10Z
PR: #1662
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
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/harness-human-review-setup.test.ts` exit 0 · mac - · 901f734f8b913c5ebe3680cd2889f5ec0ddde4d6
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/harness-human-review-setup.test.ts` exit 0 · mac - · b35122e5276cc0f58707ab01b711b6b88822cd74
  - evidence: review pass · PR #1662 · - - · 0c2e42d148649b4c6b89be731b00131e0c16b3ae
- [ ] Contract test: diff правил называет добавленные, изменённые и убранные правила с `R<n>`; «Отклонить» не трогает
      `SKILL.md`.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/harness-human-review-setup.test.ts` exit 0 · mac - · 901f734f8b913c5ebe3680cd2889f5ec0ddde4d6
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/harness-human-review-setup.test.ts` exit 0 · mac - · b35122e5276cc0f58707ab01b711b6b88822cd74
  - evidence: review pass · PR #1662 · - - · 0c2e42d148649b4c6b89be731b00131e0c16b3ae
- [ ] Contract test: напоминание — только при `SKILL.md` и `meta.json` старше 30 дней, не чаще раза в 30 дней; кнопка
      «Update» открывает Session с `--refresh`.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/projects.test.ts test/unit/review-offer-toast.test.ts test/unit/project-settings-shell.test.tsx test/unit/launch.test.ts` exit 0 · mac - · 901f734f8b913c5ebe3680cd2889f5ec0ddde4d6
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/projects.test.ts test/unit/review-offer-toast.test.ts test/unit/project-settings-shell.test.tsx test/unit/launch.test.ts` exit 0 · mac - · b35122e5276cc0f58707ab01b711b6b88822cd74
  - evidence: review pass · PR #1662 · - - · 0c2e42d148649b4c6b89be731b00131e0c16b3ae
- [ ] `node scripts/check-cyrillic.mjs` и `node scripts/eval-harness.mjs --dry-run --changed origin/main` — exit 0.
  - evidence: test-run pass · `node scripts/check-cyrillic.mjs` exit 0, `node scripts/eval-harness.mjs --dry-run --changed origin/main` exit 0 · mac - · 901f734f8b913c5ebe3680cd2889f5ec0ddde4d6
  - evidence: test-run pass · `node scripts/check-cyrillic.mjs` exit 0, `node scripts/eval-harness.mjs --dry-run --changed origin/main` exit 0 · mac - · b35122e5276cc0f58707ab01b711b6b88822cd74
  - evidence: review pass · PR #1662 · - - · 0c2e42d148649b4c6b89be731b00131e0c16b3ae
- [ ] `ci-ok` на PR зелёный; Windows verdict есть.
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/42476104330/job/128725524258 · ci - · 0c2e42d148649b4c6b89be731b00131e0c16b3ae

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

## Итог

- `harness/skills/human-review-setup/refresh.md` (новый) и раздел `## Update: \`--refresh\`` в `SKILL.md` (после
  шага 1; описание skill-а называет `--refresh`). Дата чтения — `analysed_through` из `meta.json`, иначе `fetched_at`;
  без обеих и без `SKILL.md` — первый запуск вместо обновления. `fetch --since` и `estimate` до любого чтения `raw/`;
  `pull requests: 0` — «No new pull request with a review of the team since <date>», `clean`, токенов нет; строка
  `voice:` среза обновление не останавливает. Без явного «yes» — `clean`, ничего не меняется.
- Анализ — `analyse.md` с поправками: прежний `research.md` не уходит в `previous/`, копия —
  `raw/refresh/research-before.md`; новые комментарии — только с `created_at` / `submitted_at` после даты; разделы
  `R<n>` не перенумеровываются, новые темы — следующими номерами; итог — `raw/refresh/research.md`. Черновик — разделы
  1–5 `write.md` в `raw/skill/`, раздел 6 (установка) только по «Accept».
- Diff правил — Node-скрипт между установленным `SKILL.md` и `raw/skill/SKILL.md`: пары по шагу и набору `[R<n>]`;
  **Added** / **Changed** / **Removed**, у каждого `[R<n>]` и числа «before → now»; в `raw/refresh/diff.md`.
- Проверка — `check.md` на 5 новых PR из `raw/refresh/held_out.json` (не в `meta.json`), черновиком, страницы — в
  `raw/refresh/check/`, итог — `raw/refresh/check.json`. «Accept»: старые `SKILL.md`, `voice-examples.md`,
  `research.md`, `lint.json` — в `previous/` с отметкой времени, новые — на место; в `meta.json` — `held_out`, `check`,
  `analysed_through` (= `update.fetched_at`), `kept_at`, `decision`. «Reject» и молчание: только `clean`.
- Напоминание: окно при активации Project-а спрашивает `projects.reviewer.remind`; main отвечает `due`, если ревьюер
  собран, его дата (`kept_at`, иначе `fetched_at`) старше 30 дней и `humanReview.remindedAt` в `settings.json` Project-а
  (папка данных worfy, не папка Profile-а) нет или он старше 30 дней; due записывается до ответа. Toast «Update your
  team reviewer?» — «Update» / «Later»; «Update» и кнопка «Update» в «Team reviewer» (вместо «Rebuild») — Session с
  `/worfy:human-review-setup --refresh`. Окно read-only не спрашивает.
- Файлы вне раздела «Где в коде» (согласовано с Orchestrator-ом 2026-11-08): `src/shared/ipc/projects.ts`,
  `src/main/ipc/projects.ts`, `src/main/actions/launch.ts`, `src/shared/projects/action-templates.ts`,
  `src/main/projects/settings.ts`, `src/renderer/projects/review-offer.ts`, `src/renderer/projects/useProjects.ts`,
  `src/renderer/main.tsx`, `test/unit/launch.test.ts`, `test/unit/link-access.test.ts`,
  `test/unit/review-offer-toast.test.ts`, `test/unit/use-projects.test.tsx`, `test/unit/project-settings-shell.test.tsx`,
  `docs/features/projects.md`.
- Сначала падающие test-ы: напоминание (31-й день и др.) — 8 failed из 9 новых в `test/contract/projects.test.ts`;
  `refresh.md` — 16 failed в `test/contract/harness-human-review-setup.test.ts`; после правки все зелёные.
- Ревью PR #1662, раунд 1 (REJECTED), исправлено:
  - «Нового нет» и отложенные PR — по комментариям команды с `submitted_at` / `created_at` после даты, не по числу PR
    среза: `fetch --since` берёт PR по `updatedAt`, и PR с ревью до даты и merge после неё попадает в срез со старыми
    комментариями. Счёт — Node-скриптом без текста в `raw/refresh/new.json` до вопроса; `"comments": 0` — «Nothing
    new», `clean`, токенов нет. `commit_id` отложенного PR — коммит первого ревью команды после даты.
  - Дата чтения — более поздняя из `analysed_through` и `fetched_at`: после целой пересборки старый `analysed_through`
    остаётся в `meta.json`, и чтение от него посчитало бы комментарии дважды.
  - Diff правил: пары по шагу — тот же набор `[R<n>]` и текст, тот же набор, затем наборы с общим `[R<n>]`, так что
    `[R3]` → `[R3] [R12]` — одно изменённое правило. «Accept» уносит старый `check/` в `previous/check-<stamp>/`.
  - Число PR после принятого обновления — `analysed_pull_requests` (история + PR обновлений), пока `analysed_through`
    позже `fetched_at`; `readTeamReviewer` показывает его в «Team reviewer».
  - Test-ы на даты в будущем дальше 30 дней (выживший mutant `Math.abs`).
