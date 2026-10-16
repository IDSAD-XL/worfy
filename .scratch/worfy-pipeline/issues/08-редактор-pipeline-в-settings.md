# 08 — Редактор Pipeline Project-а в Settings

Type: task
Status: open
Blocked by: 03, 06
Source: решение владельца 2026-10-17, grilling о Pipeline, пункт 10 ([spec.md](../spec.md), «Решения
владельца»: сначала Pipeline правится в `profile.json` руками или через `bin/profile`, редактор в
Settings — поздний Ticket); [ADR-0067](../../../docs/adr/0067-pipeline-in-profile-and-sha-bound-agent-marks.md).

## Что происходит

- Pipeline — поле `workflow.pipeline` в `profile.json` Profile-а, вне репозитория
  (`~/.claude/worfy-harness/projects/<name>/`). Проверяет его `bin/profile` (Ticket 02); `bin/profile`
  только читает (`harness/bin/profile:25`).
- Settings worfy — разделы `src/renderer/settings/*Section.tsx`, список — `src/renderer/settings/sections.ts`.
- worfy меняет workflow только инструментами Harness (ADR-0002).

## Что делаем

1. Раздел Settings «Pipeline» для выбранного Project-а: виды из каталога ADR-0067 — включить,
   переставить, переименовать (`label`), задать `stuck_after`, `name` у Check и `environment` у
   Deploy. Своих видов и выражений нет.
2. Запись — командой Harness, а не прямой правкой файла из worfy. Команды записи у `bin/profile`
   нет: до claim Orchestrator спрашивает владельца, какой инструмент пишет поле (новая команда
   `bin/profile set workflow.pipeline` или иное), и записывает ответ в «Итог».
3. Перед записью — та же проверка, что у `bin/profile` (exit 1 с причиной показывается в разделе).

## Готово, когда

- [ ] (вручную, до claim) решение владельца об инструменте записи — в «Итог».
- [ ] `pnpm test test/unit/settings-pipeline.test.tsx` — exit 0: включение, порядок, переименование;
      неверный Pipeline не записывается, причина видна.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0. gate full — шаг Orchestrator-а перед merge.

## Тесты

Сначала падающий `test/unit/settings-pipeline.test.tsx`; запись — через stub команды Harness во
временной папке `HARNESS_HOME`.

## Где в коде

- `src/renderer/settings/PipelineSection.tsx` (новый)
- `src/renderer/settings/sections.ts`
- `test/unit/settings-pipeline.test.tsx` (новый)

## Итог

Заполняется при закрытии.
