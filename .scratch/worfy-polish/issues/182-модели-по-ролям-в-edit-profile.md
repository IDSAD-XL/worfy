# 182 — Модели по ролям в Edit profile: модель и effort для implementer, reviewer, scout и verifier

Type: task
Status: open
Blocked by: None — can start immediately
Source: решение владельца 2026-11-28 (тема claude-projects-parity, Q5, пункт 5д: «все да») —
[просьба Product Session](../../../docs/product/claude-projects-parity/для-orchestrator-а-polish.md), раздел 3;
[заметка темы](../../../docs/product/claude-projects-parity/research-что-уже-есть-разговор-library-удобства.md),
раздел C, строка C16.

Кто: агент. Глубина review — `medium`.

## Что происходит

- В Profile поля модели и effort ролей Harness есть: `agents` с ролями implementer, reviewer, scout и verifier,
  модель `sonnet` или `opus`, effort `low`, `medium` или `high` (`harness/profiles/draft.schema.json:135-143`).
- В UI эти поля пишет только Eco mode: Sonnet с effort medium для каждой роли (`docs/features/orchestrator-modes.md:30-31`).
- В форме «Edit profile…» их нет (`docs/features/projects.md:434-441`; в `src/renderer/projects/EditProfile.tsx` нет
  `agents`).

## Что строить

1. В форме Edit profile — поля модели и effort для ролей implementer, reviewer, scout и verifier.
2. Значения — те, что допускает схема Profile; правку проверяет Harness по схеме, как остальные поля формы
   (`docs/features/projects.md:434-441`).
3. Feature page `docs/features/projects.md` (абзац об «Edit profile…») называет новые поля.

## Где в коде

- `src/renderer/projects/EditProfile.tsx` — форма Edit profile.
- `harness/profiles/draft.schema.json` — поле `agents`.
- `docs/features/projects.md`, `docs/features/orchestrator-modes.md`.

## Готово, когда

- [ ] В Edit profile есть модель и effort для implementer, reviewer, scout и verifier; сохранённое значение попадает в
  `agents.<role>.model` и `agents.<role>.effort` Profile-а. Test на это, красный до правки.
- [ ] Правку проверяет Harness по схеме Profile; отказ виден под полем, как у других полей формы.
- [ ] Feature page называет новые поля Edit profile.
- [ ] (вручную) Владелец смотрит форму «Edit profile…» в Stable copy: поля моделей по ролям выглядят и стоят, как
  остальные поля формы.
  - needs: mac stable
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
