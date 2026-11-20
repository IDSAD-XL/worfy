# 04 — Skill Harness `owner-check`: строка `owner-check` через `ticket evidence`, Pass отмечает пункт, Fail заводит доработку

Type: task
Status: open
Blocked by: —
Source: [spec.md](../spec.md), «Ticket-ы», 4; «Решения по реализации» → «Skill `owner-check` Harness-а»; «Риски», «Слова
владельца в публичном репозитории», «Codex как Orchestrator»; «Вопросы владельцу», Q2

Кто: агент.

Платформенный Ticket: новый skill в `harness/skills/` — платформенный PR (ADR-0056), вердикт Windows — job-ы Windows в CI.
Глубина ревью — `medium`.

## Что происходит

- Строку `owner-check` пишет Orchestrator со слов владельца (`docs/features/evidence.md`, таблица «кто пишет какую
  строку»), руками, по шагу `harness/skills/ship-ticket/step-6-manual-gui-checks.md` — формы
  `ticket evidence <epic> <NN> <item> owner-check <pass|fail> --ref "<YYYY-MM-DD>: <слова>" --platform <p> --copy <c>
  [--sha <s>]`.
- Skill-а, который принимает решение в одной форме, нет: worfy-шаблону `ownerCheck` (Ticket 03) нечего вызывать.
- Тексты Harness — английские (ADR-0074). Codex вызывает skill сообщением, которое начинается с его имени
  (`docs/features/vendors.md`).

## Что делаем

1. `harness/skills/owner-check/SKILL.md` (новый, английский): аргументы `<epic> <NN> <item> <pass|fail> <platform>
   <copy> <sha|->` и абзац «Owner's words:».
2. Проверяет, что пункт — ручной пункт этого Ticket-а (`ticket evidence <epic> <NN>`); иначе отказ с причиной.
3. Пишет строку через `ticket evidence … owner-check …`; при `sha` = `-` не передаёт `--sha`. Та же строка дважды не
   пишется: повтор ничего не добавляет.
4. Pass отмечает пункт `[x]`. Fail (Q2 (а)) заводит Ticket доработки в том же Epic-е: `Source:` называет пункт и дату,
   «Готово, когда» — тот же ручной пункт с его `needs:`; Pass на пункте доработки дописывает `owner-check pass` и
   исходному пункту.
5. Full mode: строки дня — в один documents PR, перед push — `evidence-check --changed`; privacy check слов владельца
   заменяет путь с именем, хост, email на `<home>`, `<host>` и говорит владельцу. Silent mode — прямо в Workflow folder.
6. Никогда не отмечает пункт без слова владельца и не пишет `pass` на Fail.
7. Plugin находит skill по папке `harness/skills/`, списка skill-ов в `harness/.claude-plugin/plugin.json` нет. Codex
   вызывает его по имени; `test/contract/codex-parity.test.ts` должен остаться зелёным.
8. `docs/features/evidence.md`: строку `owner-check` пишет skill `owner-check` (таблица «кто пишет»).

## Готово, когда

- [ ] Harness test `harness/bin/tests/owner-check.test.sh` (новый): временный Ticket — Pass пишет одну строку и `[x]`;
      повтор не пишет вторую; Fail пишет `owner-check fail` и Ticket доработки; неручной пункт — отказ. Красный до
      правки — в «Итог».
- [ ] `harness/bin/tests/agents-text.test.sh`: текст skill-а держит правило «без слова владельца не отмечать» и «на Fail
      не писать pass»; mutant (фраза убрана) — красный.
- [ ] `test/contract/codex-parity.test.ts` зелёный с новым skill-ом.
- [ ] `docs/features/evidence.md` называет skill `owner-check`; `node scripts/check-feature-docs.mjs` — exit 0.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR, job-ы Windows CI зелёные
      (платформенный PR).

## Где в коде

- `harness/skills/owner-check/SKILL.md` (новый)
- `harness/bin/tests/owner-check.test.sh` (новый), `harness/bin/tests/agents-text.test.sh`
- `test/contract/codex-parity.test.ts` (только прогнать)
- `docs/features/evidence.md`

Только читать: `harness/skills/ship-ticket/step-6-manual-gui-checks.md`, `harness/bin/ticket` (`ticket evidence`),
`harness/lib/evidence.cjs`, `docs/features/vendors.md`.

## Вне скоупа

- worfy-шаблон, который вызывает skill, — Ticket 03. Правило записи шагов приёмки — Ticket 08.
