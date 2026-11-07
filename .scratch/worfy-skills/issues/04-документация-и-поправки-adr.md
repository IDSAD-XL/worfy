# 04 — Документация: страницы Feature, `harness/README.md`, поправки ADR-0059, -0047, -0094

Type: task
Status: open
Blocked by: 02, 03
Source: [spec.md](../spec.md), «Решения владельца 2026-11-07», п. 7; «Как работает» → «Документация, ADR, eval-ы»; [ADR-0059](../../../docs/adr/0059-installer-installs-plugin-dependencies.md), «Considered Options»

Не платформенный: только документы. Глубина ревью — `low` и проверка утверждений страниц Feature против кода (как у
worfy-feature-docs: каждое утверждение — путь и строка).

## Что происходит

- `docs/features/skills-agents-and-hooks.md`: таблица skills (`:21` — `retro` worfy), test `harness-retro-skill`
  (`:100`), hook `SessionEnd` `session-end.mjs` (`:196`), напоминание `session.retro_reminder_after` (`:217`), лог
  `state/pending-retro.log` (`:265`); `ru/` — то же (`:205`, `:249`).
- `docs/features/harness.md:49`, `:138` и `docs/features/ru/harness.md:46` — установщик ставит `mattpocock-skills`
  в Claude Code и в Codex.
- `harness/README.md:16` (список skills), `:18` (`session-end.mjs`), `:21` (зависимость в `plugin.json`), `:49`
  (hook `SessionEnd` для Codex).
- ADR-0059 — зависимость ставит установщик; п. 8 «не удаляет её»; в «Considered Options» отвергнут вариант «перенести
  нужные skills в Harness». ADR-0047, п. 5 — plugin объявляет зависимость. ADR-0094, строка 66 — Codex ставит
  зависимость отдельным plugin-ом.

## Что делаем

1. Страница Feature `skills-agents-and-hooks` и её `ru/` копия: skills Matt Pocock в таблице (имя, когда, что
   делает; ручной вызов отмечен), строка об авторстве и заморозке на 1.3.1 со ссылкой на `harness/skills/THIRD_PARTY.md`;
   `retro` — Matt Pocock; без `session-end.mjs` и `session.retro_reminder_after`.
2. Страница Feature `harness` и `ru/`: зависимости нет; при Update worfy убирает plugin, который поставил сам, по
   правилу Ticket-а 03.
3. `harness/README.md` — по сделанному в 01–03.
4. ADR — раздел `## Amendments` в конце, принятый текст не переписывается (`rules-adr.md`):
   - ADR-0059: зависимости `mattpocock-skills` больше нет, skills взяты копией 1.3.1 внутрь plugin-а (решение владельца
     2026-11-07; вариант «перенести skills в Harness» из «Considered Options» принят); п. 8 дополняется правилом
     удаления Ticket-а 03; механизм зависимостей остаётся;
   - ADR-0047, п. 5 и ADR-0094 (строка про Codex) — по одной строке со ссылкой на поправку ADR-0059.

## Готово, когда

- [ ] Обе страницы Feature и их `ru/` копии описывают сделанное в 01–03; каждое новое утверждение — со ссылкой на
      файл и строку, проверено вторым агентом.
- [ ] Поправки ADR-0059, -0047, -0094 — в разделе `## Amendments`, принятый текст не тронут (`git diff` только
      дописывает).
- [ ] grep `mattpocock`, `retro_reminder_after`, `session-end.mjs` по `docs/features/` и `harness/README.md` — только
      строки об истории и об авторстве.
- [ ] `node scripts/check-cyrillic.mjs`, `node scripts/check-handoff.mjs` — exit 0; `ci-ok` на PR зелёный.

## Тесты

- Документы; test-ов нет. Проверка ссылок и утверждений — второй агент.

## Где в коде

- `docs/features/skills-agents-and-hooks.md`
- `docs/features/ru/skills-agents-and-hooks.md`
- `docs/features/harness.md`
- `docs/features/ru/harness.md`
- `harness/README.md`
- `docs/adr/0059-installer-installs-plugin-dependencies.md`
- `docs/adr/0047-harness-lessons-by-pr-early-owner-switch.md`
- `docs/adr/0094-vendor-seam.md`
