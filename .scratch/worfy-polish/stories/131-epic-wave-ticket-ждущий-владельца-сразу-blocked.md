# Code story — worfy-polish 131: epic-wave: Ticket, который Orchestrator остановил ради решения владельца, сразу `blocked --waits owner`

Kind: pr · Epic: worfy-polish · Ticket: 131 · PR: - · Language: ru

## 1. Что было не так

Skill epic-wave говорил только о развилке, которую Orchestrator решает сам по рекомендации. Ticket, которому нужен
ответ владельца, оставался `claimed`. Autopilot считает `claimed` Ticket застрявшим и шлёт continuation-ы; 2026-11-20
worfy-changes-view 03 ждал владельца по issue с меткой `pc-main-red`, получил два continuation-а и был отложен с
причиной «stuck: claimed after 2 continuations».

- Требование: [Что происходит](../issues/131-epic-wave-ticket-ждущий-владельца-сразу-blocked.md#что-происходит)

## 2. Правило в разделе 2 skill-а: Ticket, остановленный ради владельца, сразу `blocked` с `Waits: owner`, в своём worktree

Code: `harness/skills/epic-wave/SKILL.md:376-395` · key lines: 380, 384, 385, 387, 392, 393

```md
**A ticket stopped for the owner's answer is `blocked` at once.** The wave stops a ticket for the
owner when no option is the orchestrator's to pick (money, deleted data, an irreversible step, a
direction nobody recorded) or when only the owner can clear what holds it, such as an open issue.
The orchestrator then runs, right away,
`"${CLAUDE_PLUGIN_ROOT}/bin/ticket" block <epic> <NN> "<reason>" --waits owner`; `<reason>`
names the question and what it waits for (the issue, the decision). It does not stay `claimed`:
worfy Autopilot counts a `claimed` ticket as stuck and spends its continuations on it, while a
`blocked` ticket with `Waits: owner` shows as waiting for the owner. The orchestrator runs the
block in the ticket's own worktree and commits it on the ticket's branch, where the claim is
("How to resume a wave"): worfy reads the main branch with the committed ticket branch of each
worktree laid over it, so a push is not needed. A block left uncommitted, or written in the
orchestrator's own tree, stays invisible until the documents PR merges, and Autopilot goes on
sending continuations. A ticket with no worktree (not dispatched yet, or its worktree removed)
gets the block on the main branch, the way the documents PR carries statuses (section 4, item 4).
The rest is that of any other block: a line in the state file's list of what waits for the owner,
a `blocked` row in the wave report (section 5), and the same `ticket block` in the documents PR.
Once the owner answers, `ticket claim <epic> <NN>` again, and the ticket goes on in the wave. The
re-claim goes the same way: in the ticket's worktree, committed on its branch. A ticket whose PR
waits for People in the Pipeline (`human-review`, `awaiting-merge`, section 0) stays `claimed`:
this rule does not cover it.
```

- Что делает: называет, когда Wave останавливает Ticket ради владельца, и даёт Orchestrator-у точную команду
  `ticket block … --waits owner` сразу, а не в конце Wave-а. Команда идёт в worktree самого Ticket-а и commit-ится на его
  ветке, там же, где лежит claim; Ticket без worktree получает блок на main ветке. После ответа — `ticket claim` снова,
  тем же путём. Дальше — как у любой блокировки: строка в state file, строка `blocked` в отчёте, тот же статус в
  documents PR. Ticket-ы, чей PR ждёт людей Pipeline-а, правило не трогает.
- Почему здесь: Ticket называет раздел 2 «Dispatch», абзац «Questions for the owner do not stop the wave»; новый абзац
  стоит сразу после него. Место записи — по тому, что читает worfy: main ветку (`src/main/workflow/main-ref.ts`, при
  `pr-green-ci` — `origin/main`) и поверх неё commit-нутое дерево локальной ветки каждого worktree Ticket-а
  (`src/main/workflow/reader.ts`: `ticketWorktrees` по `git worktree list --porcelain`, `epic-status --json --ref
  <branch>`, `branchOverrides`). Push для этого не нужен.
- Без него: Ticket, ждущий владельца, остаётся `claimed`, Autopilot тратит на него два continuation-а и откладывает его
  сам, с причиной «stuck», которая не называет вопрос. Блок, записанный не в той ветке, тоже остаётся невидимым до
  documents PR.
- Требование: [Что делаем, п. 1–3](../issues/131-epic-wave-ticket-ждущий-владельца-сразу-blocked.md#что-делаем)
- Риски и пробелы test-ов: поведение агента проверяет только текст; eval-случая нет (причина — в «Итог» Ticket-а).
  Ticket, чей блок уже влит в main documents PR-ом, повторный claim на ветке не перекроет: `branchOverrides` не даёт
  ветке отменить `blocked` из main; этот случай правило не описывает.

## 3. Text contract test: абзац на месте, команда, место записи и границы правила в нём

Code: `harness/bin/tests/epic-wave-ship-ticket.test.sh:1295-1321` · key lines: 1298, 1301, 1309, 1311, 1316, 1317

```bash
# worfy-polish 131: a ticket the orchestrator stops for the owner's answer is blocked at once with
# Waits: owner. Left claimed, worfy Autopilot takes it for stuck and spends its continuations on it.
# Tickets whose PR waits for people of the Pipeline keep their own rule and stay claimed.
owner_stop="$(para_of "$EW" '**A ticket stopped for the owner'"'"'s answer is `blocked` at once.**')"
check "epic-wave: the paragraph on a ticket stopped for the owner is in section 2" test -n "$owner_stop"
for p in \
    '"${CLAUDE_PLUGIN_ROOT}/bin/ticket" block <epic> <NN> "<reason>" --waits owner' \
    'right away' \
    'It does not stay `claimed`' \
    'names the question and what it waits for' \
    'a `blocked` row in the wave report' \
    'the state file'"'"'s list of what waits for the owner' \
    '`ticket claim <epic> <NN>` again' \
    'People in the Pipeline (`human-review`, `awaiting-merge`, section 0) stays `claimed`' \
    'in the ticket'"'"'s own worktree and commits it on the ticket'"'"'s branch' \
    'worfy reads the main branch with the committed ticket branch of each worktree laid over it' \
    'A block left uncommitted, or written in the orchestrator'"'"'s own tree, stays invisible' \
    'A ticket with no worktree' \
    'The re-claim goes the same way'; do
    check "epic-wave: a ticket stopped for the owner — '$p'" grep -qF -- "$p" <<<"$owner_stop"
done
check "epic-wave: the owner-stop block is not run from the orchestrator's own tree" \
    lacks_re <(printf '%s\n' "$owner_stop") 'right away and from its own tree'
check "epic-wave: the owner-stop rule follows 'Questions for the owner do not stop the wave'" \
    awk '/^\*\*Questions for the owner do not stop the wave\.\*\*/ { q = NR } /^\*\*A ticket stopped for the owner/ { if (q && NR > q && NR - q < 20) found = 1 } END { exit !found }' "$EW"
check "epic-wave: human-review and awaiting-merge tickets still stay claimed (section 0)" has_flat "$EW" \
    'Such a ticket stays `claimed` with its PR open, the wave goes on without it, and its report row says whom it waits for (section 5): it is not `blocked`.'
```

- Что делает: берёт абзац целиком (`para_of`, абзац между пустыми строками) и ищет в нём команду, слово «right away»,
  отказ от `claimed`, причину, строки отчёта и state file, повторный `claim`, исключение для людей Pipeline-а и место
  записи: worktree Ticket-а с commit-ом на его ветке, Ticket без worktree, повторный claim тем же путём. Отдельно — что
  в абзаце нет прежней формы «from its own tree», что абзац стоит сразу после «Questions for the owner…» и что фраза
  раздела 0 про `human-review` / `awaiting-merge` не изменилась.
- Почему здесь: Ticket называет этот файл местом проверки (`has`/`lacks` по тексту SKILL.md).
- Без него: правило можно убрать из skill-а или вернуть запись в дерево Orchestrator-а, и ни одна проверка не
  покраснеет.
- Требование: [Что делаем, п. 4](../issues/131-epic-wave-ticket-ждущий-владельца-сразу-blocked.md#что-делаем)
- Риски и пробелы test-ов: проверяет слова, а не поведение агента; mutant-ы с убранной командой и с местом «from its
  own tree» красные, перефразировка с теми же фразами — зелёная.

## 4. Что сознательно не меняли

Раздел 0 (люди Pipeline-а: `human-review`, `awaiting-merge` — Ticket остаётся `claimed`) не тронут. Eval-случай не
добавлен, хотя scaffold мог бы его поставить: новый случай на `skills/epic-wave/SKILL.md` меняет набор, который
`--changed` выбирает для этого файла, а ровно три случая закрепляют contract test-ы runner-а
(`test/contract/harness-evals-run.test.ts`, `test/contract/harness-evals-shared.ts`) вне следа Ticket-а.

## 5. Как проверено

`bash harness/bin/tests/epic-wave-ship-ticket.test.sh`: первая редакция — до правки exit 1 (10 красных), после exit 0
(634); mutant без команды `ticket block … --waits owner` — exit 1. Раунд 1 — новые проверки места записи до правки
exit 1 (6 красных), после exit 0 (640); mutant «from its own tree» — exit 1 (1 красная). `bash
harness/bin/tests/agents-text.test.sh`, `pnpm test test/contract/codex-parity.test.ts`, `pnpm lint` — exit 0. gate fast
не запускался по брифу: на этом Mac `fseventsd` делает test-ы watcher-а файлов красными; вердикт — CI, включая job-ы
Windows (платформенный PR).

## Проверить себя

1. Почему блок пишется в worktree Ticket-а с commit-ом, а не в дереве Orchestrator-а?
   - Ответ: worfy читает main ветку и поверх неё commit-нутые ветки worktree-ов Ticket-ов; правка в дереве
     Orchestrator-а или без commit-а не видна до documents PR, и Autopilot продолжает слать continuation-ы.
   - Строки: `harness/skills/epic-wave/SKILL.md:383-388`
2. Почему Ticket с PR в `awaiting-merge` остаётся `claimed`, а ждущий ответа владельца — нет?
   - Ответ: Ticket людей Pipeline-а ждёт по собственному правилу раздела 0, и его строка отчёта говорит, кого он ждёт;
     правило про ответ владельца его прямо исключает.
   - Строки: `harness/skills/epic-wave/SKILL.md:393-395`
