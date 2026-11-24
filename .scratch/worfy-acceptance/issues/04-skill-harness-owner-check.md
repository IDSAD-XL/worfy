# 04 — Skill Harness `owner-check`: строка `owner-check` через `ticket evidence`, Pass отмечает пункт, Fail заводит доработку

Type: task
Status: done 2026-11-20T03:23Z
PR: #2051
Branch: worfy-acceptance/04
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
  - evidence: test-run pass · `bash harness/bin/tests/owner-check.test.sh` exit 0 · mac - · 1b9ec6366e495c6b8d0a93a02aedd665a229451e
  - evidence: test-run pass · `bash harness/bin/tests/owner-check.test.sh` exit 0 · mac - · 124c0b1327e4e9321cbf580c2ab446f22f77a1e8
  - evidence: review pass · PR #2051 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] `harness/bin/tests/agents-text.test.sh`: текст skill-а держит правило «без слова владельца не отмечать» и «на Fail
      не писать pass»; mutant (фраза убрана) — красный.
  - evidence: test-run pass · `bash harness/bin/tests/agents-text.test.sh` exit 0 · mac - · 1b9ec6366e495c6b8d0a93a02aedd665a229451e
  - evidence: review pass · PR #2051 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] `test/contract/codex-parity.test.ts` зелёный с новым skill-ом.
  - evidence: test-run pass · `pnpm exec vitest run test/contract/codex-parity.test.ts` exit 0 · mac - · 1b9ec6366e495c6b8d0a93a02aedd665a229451e
  - evidence: review pass · PR #2051 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] `docs/features/evidence.md` называет skill `owner-check`; `node scripts/check-feature-docs.mjs` — exit 0.
  - evidence: test-run pass · `node scripts/check-feature-docs.mjs` exit 0 · mac - · 1b9ec6366e495c6b8d0a93a02aedd665a229451e
  - evidence: review pass · PR #2051 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR, job-ы Windows CI зелёные
      (платформенный PR).
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/44664848110/job/136054714026 · ci - · aab14e0ebd04c348e18b222ec7a549037087d36f

## Где в коде

- `harness/skills/owner-check/SKILL.md` (новый)
- `harness/bin/tests/owner-check.test.sh` (новый), `harness/bin/tests/agents-text.test.sh`
- `test/contract/codex-parity.test.ts` (только прогнать)
- `docs/features/evidence.md`

Только читать: `harness/skills/ship-ticket/step-6-manual-gui-checks.md`, `harness/bin/ticket` (`ticket evidence`),
`harness/lib/evidence.cjs`, `docs/features/vendors.md`.

## Вне скоупа

- worfy-шаблон, который вызывает skill, — Ticket 03. Правило записи шагов приёмки — Ticket 08.

## Итог

- Skill `harness/skills/owner-check/SKILL.md`: аргументы, абзац «Owner's words:», правило «только слово владельца»,
  блок записи решения (проверка ручного пункта, одна строка через `ticket evidence`, `[x]` на Pass, Ticket доработки на
  Fail, Pass на доработке закрывает исходный пункт, privacy check слов), documents PR дня в Full mode, Workflow folder в
  Silent mode. Code story: [04-skill-harness-owner-check.md](../stories/04-skill-harness-owner-check.md).
- Красный до правки: `bash harness/bin/tests/owner-check.test.sh` без skill-а (`SKILL_FILE` на несуществующий файл) —
  `FAIL no skill file …`, exit 1. Mutant-ы блока — каждый красный: без проверки повтора (повторный Pass — вторая строка),
  без проверки ручного пункта (неручной пункт получил строку), без Ticket-а доработки, `--sha -` в `ticket evidence`
  (`sha is 7 to 40 hex digits`). Mutant-ы `agents-text.test.sh`: фраза «Never tick an item without the owner's word»
  убрана — `FAIL owner-check skill: no 'Never tick …'`, exit 1; фраза «Never write `pass` on a Fail» убрана — так же, exit 1.
- Доработка 1 (красный CI на Windows, job `windows (harness-scripts 2/2)`): на Git Bash case «Fail writes owner-check
  fail…» падал — блок печатал путь Ticket-а доработки через `path.join`, на Windows это `f-bash\issues\03-rework-…md`,
  а test и раздел «What its output means» ждут `/`. Теперь путь собирается строкой `<epic>/issues/<файл>` на любой
  ОС. Новый case гоняет Fail с preload-ом (`FENVW`), который заставляет `path.join` блока соединять относительный путь
  через `\`, как на Windows: mutant с прежним `path.join` красный и на Mac (`FAIL bash/zsh: rework path with a \ path.join`,
  exit 1). CRLF и `[` в grep не причина: парсер читает строки через `/\r?\n/`, а остальные проверки этого case-а на
  Windows прошли.
- Решено без владельца, подтвердить:
  - Логика записи — блок `node -e` внутри `SKILL.md`, а не отдельный скрипт в `harness/bin/`: след Ticket-а называет только
    `SKILL.md`; test вырезает блок из `SKILL.md` и гоняет его в bash и zsh, как `skill-blocks.test.sh`.
  - «Ручной пункт» проверяется парсером `parseDoneSection` (`harness/lib/evidence.cjs`) с `done_section` и `manual_mark`
    Profile-а — тем же, что внутри `ticket evidence`: его матрица не печатает, ручной ли пункт.
  - «Та же строка» — тот же вердикт, ref (дата и слова), платформа и копия; `sha` не сравнивается: при `-` это `HEAD`,
    который между двумя Send again может сдвинуться.
  - Ticket доработки: каркас на английском (тексты Harness — английские), строка `Source: owner-check fail <date> of
    <epic> <NN>, item <k> — <файл>` в одной форме; Pass на пункте доработки доходит до исходного пункта по этой строке и
    по совпадению текста пунктов. Один Ticket доработки на пункт и день.
  - Замены в словах: путь с именем → `<home>`, хост → `<host>`, email → `<email>`, адрес Tailscale → `<ip>`, UUID →
    `<uuid>`, token → `<token>`, слово личного списка → `<private>`; владельцу называются виды, не значения.
  - Ветка documents PR дня — `owner-check/<YYYY-MM-DD>` (занята влитым PR-ом — `-2`, `-3`); skill его не вливает.
  - Fail не снимает `[x]` с уже отмеченного пункта: Ticket этого не просит.
- Вне следа, без них `pnpm test` красный: новый skill вписан в `harness/evals/lib/coverage.json` («uncovered», case-а
  нет, блок гоняет `owner-check.test.sh`) и в список skill-ов plugin-а в `test/contract/harness-migrate.test.ts` (старый
  Harness его не имел — план миграции не предлагает его удалить).
