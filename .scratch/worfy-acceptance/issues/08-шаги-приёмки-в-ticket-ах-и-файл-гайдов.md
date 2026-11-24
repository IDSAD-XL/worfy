# 08 — Шаги приёмки в Ticket-ах: правило Harness для ручных пунктов, перенос гайдов, файл гайдов до приёмки владельцем

Type: task
Status: claimed 2026-11-24T03:02Z
PR: #2165
Branch: worfy-acceptance/08
Blocked by: 04, 05
Source: [spec.md](../spec.md), «Ticket-ы», 8; «Решения по реализации» → «Шаги приёмки — ручные пункты Ticket-а»; «Вопросы
владельцу», Q5 (решено владельцем 2026-11-20)

Кто: агент (Orchestrator).

Платформенный Ticket: правка текстов skill-ов Harness-а — платформенный PR (ADR-0056), вердикт Windows — job-ы Windows в
CI. Глубина ревью — `medium`.

## Что происходит

- Шаги приёмок Orchestrator ведёт руками в `.scratch/owner-acceptance-guides.md` («Сделай → Должно быть», «Перед
  началом Orchestrator сделает»); пункты — в Ticket-ах. Они расходятся (spec, «Проблема»).
- Этот формат владелец сам попросил 2026-11-06. Решение 2026-11-20 (Q5): шаги переезжают в Ticket-ы, а файл удаляется
  только после того, как владелец принял вид в Ticket-е 10; до этого Orchestrator держит файл актуальным.
- Шаблон Ticket-а — `harness/skills/to-tickets/SKILL.md`; ручные проверки — `harness/skills/ship-ticket/step-6-manual-gui-checks.md`.

## Что делаем

1. Правило Harness: ручной пункт пишется для владельца, один шаг — «Сделай: … → Должно быть: …», с `needs:`; подготовка
   Orchestrator-а — неручные пункты того же Ticket-а. Текст — в `harness/skills/to-tickets/SKILL.md` и
   `harness/skills/ship-ticket/step-6-manual-gui-checks.md` (английский, ADR-0074).
2. Шаги открытых приёмок из файла гайдов — ручными пунктами в их Ticket-ы приёмки (`.scratch/<epic>/issues/NN-*.md`),
   по одному пункту на шаг.
3. Файл гайдов не удаляется: в нём остаётся ссылка «шаги — в Ticket-ах, вид Acceptance», он актуален до Ticket-а 10.
4. `HANDOFF.md` в разделе «Ждёт владельца» ведёт на вид (правку делает Orchestrator, как обычно для `HANDOFF.md`).
5. `docs/features/workflow.md`: как пишется ручной пункт приёмки.

## Готово, когда

- [ ] `harness/bin/tests/agents-text.test.sh`: текст to-tickets и step-6 требует «Сделай → Должно быть» и `needs:` для
      ручного пункта; mutant (фраза убрана) — красный; весь файл — exit 0.
  - evidence: test-run pass · `bash harness/bin/tests/agents-text.test.sh` exit 0 (527 passed); mutant without the sentence in step 6 and in to-tickets exit 1 · mac dev · a121c0ffb633a08d408f5eb916250f9153398338
- [ ] Шаги каждой открытой приёмки — ручные пункты своих Ticket-ов; `evidence-check --changed` — exit 0 на PR.
  - evidence: test-run pass · `node harness/bin/evidence-check --changed --root .scratch` exit 0 (33 files) · mac dev · a121c0ffb633a08d408f5eb916250f9153398338
- [ ] Файл гайдов на месте и ссылается на вид; `node scripts/check-handoff.mjs` — exit 0.
  - evidence: test-run pass · `node scripts/check-handoff.mjs` exit 0 · mac dev · a121c0ffb633a08d408f5eb916250f9153398338
- [ ] `docs/features/workflow.md` описывает ручной пункт приёмки; `node scripts/check-feature-docs.mjs` — exit 0.
  - evidence: test-run pass · `node scripts/check-feature-docs.mjs` exit 0 · mac dev · a121c0ffb633a08d408f5eb916250f9153398338
- [ ] `pnpm lint`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR, job-ы Windows CI зелёные (платформенный PR).

## Где в коде

- `harness/skills/to-tickets/SKILL.md`, `harness/skills/ship-ticket/step-6-manual-gui-checks.md`
- `harness/bin/tests/agents-text.test.sh`
- `.scratch/<epic>/issues/NN-*.md` открытых приёмок, `.scratch/owner-acceptance-guides.md`, `HANDOFF.md`
- `docs/features/workflow.md`

Только читать: `harness/skills/owner-check/SKILL.md` (Ticket 04).

## Вне скоупа

- Удаление файла гайдов — после приёмки владельцем (Ticket 10).

## Итог

Платформенный PR: да — правка текстов skill-ов Harness-а (`to-tickets`, `ship-ticket`, шаг 6) и его test-а (ADR-0056);
вердикт Windows — job-ы Windows в CI на head PR.

- Правило Harness-а — в `harness/skills/ship-ticket/step-6-manual-gui-checks.md` и `harness/skills/to-tickets/SKILL.md`
  (с пунктом в шаблоне Ticket-а). `harness/bin/tests/agents-text.test.sh` держит пять фраз правила в обоих файлах и для
  каждой фразы проверяет копию без неё. До правки текста — exit 1 (3 failed), после — exit 0.
- `to-tickets` — копия mattpocock-skills 1.3.1: правка записана в `harness/skills/THIRD_PARTY.md`, новый sha256 и
  третий пункт шаблона — в `test/contract/harness-third-party-skills.test.ts`. Этих двух файлов нет в «Где в коде»: без
  них contract test красный.
- Шаги открытых приёмок перенесены в 31 Ticket: `worfy-multi-vendor` 43; `worfy-product-session` 08, 21, 23, 26–32;
  `worfy-polish` 75, 77, 134; `worfy-multi-repo-ticket` 08; `worfy-mcp-live` 08; `worfy-stuck-agents` 11;
  `worfy-code-stories` 17; `worfy-auth-check` 10; `worfy-changes-view` 07, 08, 09; ручные проверки вне приёмок —
  `worfy-daily` 13, 31; `worfy-mvp` 06, 21; `worfy-week` 16; `worfy-guide` 20; `worfy-ui` 03; `worfy-windows` 30.
- Файл гайдов на месте, в начале — ссылка «шаги — в Ticket-ах, вид Acceptance». `HANDOFF.md` не правился: ссылку «Ждёт
  владельца» на вид ставит Orchestrator (пункт 4 «Что делаем»).

Решено без владельца:

- Метки шага в тексте Harness-а — `Do: … → Expect: …`, на языке документов Project-а; в русских Ticket-ах — «Сделай: … →
  Должно быть: …».
- Шаги дописаны после существующих пунктов «Готово, когда», под абзацем «Шаги приёмки владельца — из …»; старые пункты
  (текст, номера, строки Evidence) не тронуты: на номера ссылаются `Source:` Ticket-ов доработки (`worfy-changes-view` 09
  → 07, пункт 3) и строки Evidence. Цена: общий ручной пункт («Mac Stable: …») остаётся рядом со своими шагами, и
  владелец закрывает его после них.
- Решения без владельца из файла гайдов — тоже ручные пункты без `needs:`: Pass — «подтверждаю», Fail — «в Ticket»
  (Fail заводит Ticket доработки, как «в Ticket»).
- Согласие владельца на обновление Stable в `worfy-changes-view` 07–09 и `worfy-polish` 134 — пункт подготовки
  Orchestrator-а «обновить Mac Stable до `main` после «да» владельца», а не ручной пункт.
- Шаги `worfy-changes-view` части 1 разнесены по Ticket-ам доработки: «Node и diff» — в 08, «комментарии» — в 09, по их
  поведению после доработки (вид Changes во всё окно, диапазон перетаскиванием «+»); решения 1, 3, 16, 18, 19 из гайда
  не перенесены — их сняли ответы владельца D1, D4 2026-11-21 и доработка 08.
- Общая подготовка блока `worfy-product-session` — в Ticket 08 этого Epic-а, подготовка раздела — в его Ticket.
- Пример ручного пункта в шаблоне `to-tickets` — с буквальной меткой `(manual)` и `needs: mac stable`, чтобы разбор
  Evidence читал его без ошибок, как `## Done when` шаблона.

Проверки после rebase на `origin/main` (Ticket не зависит от кода 05): `agents-text.test.sh`, contract test
`harness-third-party-skills`, `evidence-check --changed --root .scratch`, `pnpm lint`, `pnpm typecheck` — exit 0. Gate fast —
exit 2, red: один test вне диффа, `test/contract/modes-linked.test.ts:362` — событие `ecoMode.changed` окна B
проверяется без ожидания (`undefined`); этот PR не трогает ни `src/`, ни этот test. Не перезапускался. До rebase gate fast
был green. `ci-ok` и job-ы Windows — на PR.
