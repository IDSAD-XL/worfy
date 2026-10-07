# 10 — worfy понимает имена Harness с префиксом `worfy:` и новый формат команды Autopilot

Type: task
Status: claimed — 2026-10-07
Blocked by: —
Source: решения владельца 2026-10-07: Q2 (имя plugin-а — `worfy`: `/worfy:epic-wave`, `/worfy:ship-ticket`, Subagent `worfy:implementer`; старые имена без префикса тоже понимаются), Q6 (машинные строки и формат команды Autopilot — по-английски, старые понимаются); [ADR-0040](../../../docs/adr/0040-harness-delivery-local-marketplace.md) (доставка Harness plugin-ом `worfy`); [ADR-0044](../../../docs/adr/0044-harness-in-english-language-from-profile.md) (Harness на английском, машинный контракт без языка); [spec.md](../spec.md)

## Что происходит

- Harness станет plugin-ом `worfy` (Q2). У plugin-а всё в его namespace: skill вызывается только
  как `/worfy:epic-wave` и `/worfy:ship-ticket` — голое `/epic-wave` для skill-а plugin-а не
  работает (факт spike 2026-10-07); Subagent-ы называются `worfy:implementer`, `worfy:reviewer`,
  `worfy:scout`. Старые транскрипты хранят имена без префикса.
- Binding по skill (связь Session с Ticket-ом или Epic-ом по её последнему вызову skill-а):
  `skillName` срезает любой префикс до `:` (`src/shared/binding/signals.ts:52-57`), так что
  `other:epic-wave` из чужого plugin-а тоже даёт Binding. Test-ов на имя с префиксом нет
  (`test/unit/binding.test.ts:212-217` — только `/epic-wave`, `ship-ticket` и `/qmd`).
- Epic в аргументах `/epic-wave` — последнее слово, которое является Epic-ом Project-а
  (`src/shared/binding/resolve.ts:142-148`), то есть от остальных слов команды не зависит.
  Test-ы есть на самый старый формат (`волна 9 эпика worfy-mvp`) и на `wave 2 of auction`
  (`test/unit/binding.test.ts:103-110`); на нынешний формат команды Autopilot
  (`Ticket-ы {tickets} эпика {epic}`, `src/shared/projects/action-templates.ts:34`) test-а нет.
- Тип Subagent-а показывается как есть, то есть с plugin-ом — `worfy:implementer`: заголовок и
  строка вида Node-а Subagent (`src/renderer/canvas/nodes/SubagentNode.tsx:65-66`), список
  Subagent-ов Session (`src/renderer/session/rail/SubagentsRail.tsx:78-79`), заголовок панели
  Subagent-а (`src/renderer/session/ExternalSessionPanel.tsx:56`, `:68`), строка запуска
  Subagent-а в транскрипте (`src/renderer/session/Transcript.tsx:335`).
- Вердикт ревьюера — `VERIFIED` или `REJECTED` в первой строке ответа Subagent-а
  (`src/shared/transcript/subagents.ts:414-417`) и в комментарии PR (`src/main/github/prs.ts:162-170`).
  От типа Subagent-а разбор не зависит. Test-ов на тип `worfy:reviewer` и на ответ ревьюера
  после перевода agents на английский (Ticket 07) нет.
- Новый формат команды Autopilot по-английски вводит Ticket 06 (перевод skills epic-wave и
  ship-ticket). Этот Ticket его не ждёт (Blocked by — по плану Epic-а), поэтому разбор не должен
  зависеть от слов формата.

## Что делаем

1. **Binding по skill: голое имя и `worfy:`** (Q2). `/worfy:epic-wave` (команда), `worfy:epic-wave`
   (Skill tool), `/epic-wave` и `epic-wave` — один skill; то же для `ship-ticket`. Имя с другим
   префиксом (`other:epic-wave`) — не skill Harness, сигнала skill нет: имя `worfy` выбрано, чтобы
   не сталкиваться с чужими plugin-ами (Q2).
2. **Формат команды Autopilot — любой, где Epic назван отдельным словом** (Q6). Binding к Epic-у
   по `/worfy:epic-wave` с аргументами самого старого формата (`волна 3 эпика worfy-mvp`),
   нынешнего (`Ticket-ы 05, 06 эпика worfy-mvp`) и нового английского — каким его объявляет
   `harness/skills/epic-wave/SKILL.md` после Ticket-а 06. Если Ticket 06 ещё не влит, test берёт
   английскую фразу без русских слов, где имя Epic-а — отдельное слово, и в «Итог» — строка, что
   формат Ticket-а 06 надо сверить. Справляется `epicInArgs` — код не меняется, остаются test-ы.
3. **Тип Subagent-а без `worfy:`** (Q2). Один helper — `src/shared/agent/subagent-type.ts`:
   `worfy:implementer` → `implementer`, `implementer` → `implementer`; другие префиксы
   (`mattpocock-skills:…`), тип `workflow` и `null` — как есть. Все четыре места показа из «Что
   происходит» берут подпись у него. Полное имя — в подсказке (`title`) у элемента с типом.
4. **Вердикты.** `VERIFIED` и `REJECTED` читаются у Subagent-а с типом `worfy:reviewer` так же, как
   у `reviewer`, и в английском ответе ревьюера: жирный, markdown, хвост после слова
   (`**VERIFIED** (round 2, head abc1234)`, `REJECTED: 2 findings`). Код меняется, только если
   test-ы покажут, что это не так.
5. **Старые имена.** Старые транскрипты (без префикса, с русскими аргументами) дают те же
   Binding-и и тот же показ, что до Ticket-а: прежние test-ы не меняются.

ADR не нужен: имя plugin-а решено в ADR-0040, машинные строки — в ADR-0044.

**Не входит:** какой текст шлют действия «Ship ticket» и «Run wave» (шаблоны в
`src/shared/projects/action-templates.ts`) — Ticket 12 (шаблон по установленному Harness);
перевод skills — Ticket 06; перевод agents — Ticket 07.

## Готово, когда

- [ ] Unit (`test/unit/binding.test.ts`, `extendSignals`): `<command-name>/worfy:epic-wave</command-name>` с аргументами `Ticket-ы 05, 06 эпика worfy-mvp` — сигнал skill `epic-wave`; Skill tool с `skill: 'worfy:ship-ticket'` — сигнал `ship-ticket`; `/other:epic-wave` и `other:ship-ticket` — сигнала skill нет.
- [ ] Unit (`resolveBinding`): `/worfy:epic-wave` с аргументами трёх форматов (самый старый, нынешний, новый английский) связывает Session с Epic-ом `worfy-mvp`; `/worfy:ship-ticket worfy-mvp 16` — с Ticket-ом 16.
- [ ] Unit (`test/unit/subagent-type.test.ts`): `worfy:implementer` → `implementer`; `scout` → `scout`; `mattpocock-skills:x` → `mattpocock-skills:x`; `workflow` → `workflow`; `null` → `null`.
- [ ] Unit (`test/unit/subagent-nodes.test.tsx`): Node Subagent-а с типом `worfy:implementer` и без имени — заголовок `implementer`, строка вида `implementer · <модель>`, полное имя `worfy:implementer` — в `title`.
- [ ] `grep -rn "subagentType" src/renderer` — каждое место показа типа идёт через helper (проверка поиском; список мест — в «Итог»).
- [ ] Unit (`test/unit/subagents.test.ts`): Subagent `worfy:reviewer` с ответом `**VERIFIED** (round 2, head abc1234)` — вердикт `VERIFIED`; с ответом `REJECTED: 2 findings` — `REJECTED`.
- [ ] Contract (`test/contract/github-prs.test.ts`, `verdictOf`): комментарий PR с первой строкой `VERIFIED (round 1, head abc1234)` — `VERIFIED`.
- [ ] Прежние test-ы Binding-а и Subagent-ов зелёные без правок ожиданий; `pnpm lint`, `pnpm typecheck`, `pnpm test` — код 0; CI на PR зелёный.
- [ ] `GATE_SCOPE=all bash ~/.claude/hooks/gate.sh full` на ветке после rebase — код 0 и строка `[gate] зелено` (e2e `test/e2e/subagent-tree.spec.ts` и `test/e2e/binding.spec.ts` идут здесь).

## Тесты

Сначала падающие test-ы:
- `test/unit/binding.test.ts`: `other:epic-wave` не даёт сигнала skill. На нынешнем main
  `skillName` срезает любой префикс — test красный.
- `test/unit/subagent-nodes.test.tsx`: заголовок Node-а Subagent-а `worfy:implementer` —
  `implementer`. На нынешнем main там `worfy:implementer` — test красный.

В «Итог» — как они падали.

- `test/unit/binding.test.ts` — префиксы, три формата команды Autopilot, старые имена.
- `test/unit/subagent-type.test.ts` — новый: helper подписи типа.
- `test/unit/subagent-nodes.test.tsx` — заголовок, строка вида, `title`.
- `test/unit/subagents.test.ts` — вердикт у `worfy:reviewer` с английским ответом.
- `test/contract/github-prs.test.ts` — вердикт в комментарии PR английского ревьюера.

## Где в коде

- `src/shared/binding/signals.ts`
- `src/shared/agent/subagent-type.ts` — новый: подпись типа Subagent-а для показа
- `src/renderer/canvas/nodes/SubagentNode.tsx`
- `src/renderer/session/rail/SubagentsRail.tsx`
- `src/renderer/session/ExternalSessionPanel.tsx`
- `src/renderer/session/Transcript.tsx`
- `test/unit/binding.test.ts`
- `test/unit/subagent-type.test.ts` — новый
- `test/unit/subagent-nodes.test.tsx`
- `test/unit/subagents.test.ts`
- `test/contract/github-prs.test.ts`

Если `epicInArgs` не справляется с новым форматом — исполнитель добавляет
`src/shared/binding/resolve.ts` в «Где в коде»; если test-ы вердиктов покажут дефект —
`src/shared/transcript/subagents.ts` или `src/main/github/prs.ts`. Общих файлов с Ticket-ами 09,
11 и 12 нет; Ticket 12 ждёт этот Ticket (Blocked by).

## Итог

- **Binding по skill.** `skillName` (`src/shared/binding/signals.ts`) принимает имя Harness голым или с
  `worfy:` и отвергает любой другой префикс: `other:epic-wave` и `other:ship-ticket` больше не дают
  сигнала skill (раньше давали). Правило «голое имя или `worfy:`» — `harnessName` в
  `src/shared/agent/subagent-type.ts`, там же константа `HARNESS_PLUGIN = 'worfy'`.
- **Формат команды Autopilot.** `epicInArgs` справился со всеми тремя форматами без правки
  `src/shared/binding/resolve.ts`: `волна 3 эпика worfy-mvp`, `Ticket-ы 05, 06 эпика worfy-mvp` и
  `tickets 05, 06 of epic worfy-mvp`. Английская фраза взята из Ticket-а 06
  (`.scratch/worfy-harness/issues/06-…md`, пункт 4: `/worfy:epic-wave tickets 05, 06, 07, 08 of epic worfy-harness`);
  `harness/skills/epic-wave/SKILL.md` на момент работы ещё нет — **после мержа Ticket-а 06 сверить
  формат с SKILL.md**.
- **Тип Subagent-а.** Helper `subagentTypeLabel` (`src/shared/agent/subagent-type.ts`) срезает
  только `worfy:`; другие префиксы, голые типы, `workflow` и `null` — как есть. Места показа типа
  (`grep -rn subagentType src/renderer`, кроме `session/fold.ts`, где тип только переносится):
  - `src/renderer/canvas/nodes/SubagentNode.tsx` — заголовок (`subagent-name`, полное имя в `title`,
    когда заголовок — тип) и строка вида (`subagent-kind`, полное имя в `title`);
  - `src/renderer/session/rail/SubagentsRail.tsx` — имя строки списка и тип после имени (`title` — полный тип);
  - `src/renderer/session/ExternalSessionPanel.tsx` — заголовок панели Subagent-а (в `title` заголовка —
    полный тип) и строка источника (`session-source`, `title` — полный тип);
  - `src/renderer/session/Transcript.tsx` — тип в строке запуска Subagent-а (`transcript-subagent-type`, `title` — полный тип).
- **Вердикты.** `VERIFIED`/`REJECTED` у `worfy:reviewer` с английским ответом и в комментарии PR
  вида `VERIFIED (round 1, head abc1234)` читаются без правки кода: test-ы зелёные сразу,
  `src/shared/transcript/subagents.ts` и `src/main/github/prs.ts` не менялись.
- **Как падали test-ы до правки:** `binding.test.ts` — Skill tool `other:ship-ticket` перезаписал
  сигнал (`expected { name: 'ship-ticket', … } to deeply equal …`), `/other:ship-ticket worfy-mvp 16`
  дал Binding (`expected { …(3) } to be null`); `subagent-nodes.test.tsx` — заголовок Node-а
  `expected 'worfy:implementer' to be 'implementer'`.
- Прежние test-ы Binding-а и Subagent-ов не менялись. `pnpm lint && pnpm typecheck && pnpm test` —
  код 0 (126 файлов, 2211 test-ов); `GATE_SCOPE=all bash ~/.claude/hooks/gate.sh full` — код 0,
  `[gate] зелено (full)`.
- Снимки (Session 7777 из фикстур с типами `worfy:implementer`, `worfy:reviewer`, `worfy:scout`,
  через `launchApp`, временные `WORFY_DATA_DIR` и `WORFY_CLAUDE_HOME`):
  [Canvas, светлая](../evidence/10-subagent-nodes-light.png), [Canvas, тёмная](../evidence/10-subagent-nodes-dark.png),
  [транскрипт Subagent-а, светлая](../evidence/10-subagent-transcript-light.png),
  [транскрипт Subagent-а, тёмная](../evidence/10-subagent-transcript-dark.png).
