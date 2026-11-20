# Code story — worfy-polish 131: epic-wave: Ticket, который Orchestrator остановил ради решения владельца, сразу `blocked --waits owner`

Kind: pr · Epic: worfy-polish · Ticket: 131 · PR: - · Language: ru

## 1. Что было не так

Skill epic-wave говорил только о развилке, которую Orchestrator решает сам по рекомендации. Ticket, которому нужен
ответ владельца, оставался `claimed`. Autopilot считает `claimed` Ticket застрявшим и шлёт continuation-ы; 2026-11-20
worfy-changes-view 03 ждал владельца по issue с меткой `pc-main-red`, получил два continuation-а и был отложен с
причиной «stuck: claimed after 2 continuations».

- Требование: [Что происходит](../issues/131-epic-wave-ticket-ждущий-владельца-сразу-blocked.md#что-происходит)

## 2. Правило: Ticket, остановленный ради владельца, сразу `blocked` с `Waits: owner`

Code: `harness/skills/epic-wave/SKILL.md:376-389` · key lines: 379, 381, 382, 387, 388

```md
**A ticket stopped for the owner's answer is `blocked` at once.** The wave stops a ticket for the
owner when no option is the orchestrator's to pick (money, deleted data, an irreversible step, a
direction nobody recorded) or when only the owner can clear what holds it, such as an open issue.
The orchestrator then runs, right away — once the ticket's implementer has ended its turn (its
report came, or it was stopped), so nothing else writes in its worktree —
`"${CLAUDE_PLUGIN_ROOT}/bin/ticket" block <epic> <NN> "<reason>" --waits owner`; `<reason>`
names the question and what it waits for (the issue, the decision). It does not stay `claimed`:
worfy Autopilot counts a `claimed` ticket as stuck and spends its continuations on it, while a
`blocked` ticket with `Waits: owner` shows as waiting for the owner. The rest is that of any other
block: a line in the state file's list of what waits for the owner, a `blocked` row in the wave
report (section 5), and the same `ticket block` in the documents PR (section 4, item 4). Once the
owner answers, the ticket is claimed again and goes on in the wave. A ticket whose PR waits for
People in the Pipeline (`human-review`, `awaiting-merge`, section 0) stays `claimed`: this rule
does not cover it.
```

- Что делает: называет, когда Wave останавливает Ticket ради владельца, и даёт Orchestrator-у точную команду
  `ticket block … --waits owner` сразу, но после конца хода implementer-а этого Ticket-а. Дальше — как у любой
  блокировки: строка в state file, строка `blocked` в отчёте, тот же статус в documents PR. Ticket-ы, чей PR ждёт людей
  Pipeline-а, правило не трогает.
- Почему здесь: Ticket называет раздел 2 «Dispatch», абзац «Questions for the owner do not stop the wave»; новый абзац
  стоит сразу после него. Ждать конца хода implementer-а — находка review (раунд 2): иначе commit в его worktree
  захватывает его недописанные файлы или сталкивается на `index.lock`.
- Без него: Ticket, ждущий владельца, остаётся `claimed`, Autopilot тратит на него два continuation-а и откладывает его
  сам, с причиной «stuck», которая не называет вопрос.
- Требование: [Что делаем, п. 1–3](../issues/131-epic-wave-ticket-ждущий-владельца-сразу-blocked.md#что-делаем)
- Риски и пробелы test-ов: поведение агента проверяет только текст; eval-случая нет (причина — в «Итог» Ticket-а).

## 3. Где записывается статус: worktree Ticket-а, main при `blocked` в main, открытый PR, Silent mode

Code: `harness/skills/epic-wave/SKILL.md:391-410` · key lines: 391, 392, 395, 401, 404, 407, 409

```md
**Where the owner-stop status is written.** worfy reads the main branch with the committed ticket
branch of each worktree laid over it, and a branch never undoes `blocked` or `done` of the main
branch. So:
- The block: in the ticket's own worktree, committed on the ticket's branch with only the ticket
  file, `git -C <worktree> commit -m "<message>" -- <ticket file>`, where the claim is ("How to
  resume a wave"); a push is not needed. A block left uncommitted, or written in the
  orchestrator's own tree, stays invisible until the documents PR merges, and Autopilot goes on
  sending continuations. A ticket with no worktree (not dispatched yet, or its worktree removed)
  gets the block on the main branch, the way the documents PR carries statuses.
- The owner's answer: `ticket claim <epic> <NN>` in the ticket's worktree, committed the same way.
  When the main branch already says `blocked` (the documents PR merged the block, or the ticket had
  no worktree), the main branch gets the answer too, by the same documents path: `ticket claim`
  when the ticket goes on in its worktree, `ticket open` when it has none, so that a later wave
  takes it (a wave takes only `open` tickets, section 1).
- An open PR: the status commit moves the PR's head at its next push, inside the tickets root
  only. `land` takes such a head and carries the `review` mark over from the verified head (section
  4, "Merge with land"); CI runs again on it, and `check/<name>` marks are never carried: the
  orchestrator sets them again on the new head (section 4, "Checks before merge").
- Silent mode (section 0): `ticket block` and `ticket claim` from any directory are enough; the
  status goes straight into the Workflow folder, with no commit.
```

- Что делает: говорит, куда писать блок и ответ владельца, чтобы их увидели worfy и Autopilot. Блок — commit одного
  файла Ticket-а на его ветке в его worktree; Ticket без worktree — main ветка путём documents. Ответ — `ticket claim`
  на ветке, а если main уже говорит `blocked` — ещё и в main (`ticket claim` или `ticket open`). Для открытого PR —
  что будет с отметками на новом head-е. В Silent mode — без commit-а.
- Почему здесь: так читает worfy — main ветку (`src/main/workflow/main-ref.ts`, при `pr-green-ci` — `origin/main`) и
  поверх неё commit-нутое дерево локальной ветки каждого worktree Ticket-а (`src/main/workflow/reader.ts`:
  `ticketWorktrees` по `git worktree list --porcelain`, `epic-status --json --ref <branch>`); `branchOverrides` не даёт
  ветке отменить `blocked`/`done` из main (ADR-0033). Поведение `land` с head-ом, сдвинутым только в корне тикетов, — по
  шапке `harness/bin/land`. Silent mode — раздел 0 skill-а.
- Без него: блок, записанный в дереве Orchestrator-а или без commit-а, не виден до documents PR, и Autopilot шлёт
  continuation-ы дальше; ответ владельца на ветке не снимает `blocked`, уже влитый в main, и Ticket так и висит «ждёт
  владельца»; Ticket без worktree, заблокированный в main, ни одна Wave больше не берёт.
- Требование: [Что делаем, п. 1–3](../issues/131-epic-wave-ticket-ждущий-владельца-сразу-blocked.md#что-делаем)
- Риски и пробелы test-ов: что отметки `review` и `check/<name>` ведут себя на новом head-е так, как сказано, проверено
  чтением шапки `land`, не прогоном. `setAsideText` Autopilot-а по-прежнему не говорит, где запускать `ticket block`
  (в «Итог» — почему не правился).

## 4. Text contract test: оба абзаца, команда, место записи и границы правила

Code: `harness/bin/tests/epic-wave-ship-ticket.test.sh:1295-1339` · key lines: 1298, 1308, 1314, 1319, 1322, 1331

```bash
# A ticket the orchestrator stops for the owner's answer is blocked at once with
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
    'People in the Pipeline (`human-review`, `awaiting-merge`, section 0) stays `claimed`' \
    'once the ticket'"'"'s implementer has ended its turn'; do
    check "epic-wave: a ticket stopped for the owner — '$p'" grep -qF -- "$p" <<<"$owner_stop"
done
# Where the status goes: worfy reads the main branch with each ticket worktree's committed branch laid
# over it, and a branch never undoes `blocked` or `done` of the main branch.
owner_where="$(para_of "$EW" '**Where the owner-stop status is written.**')"
check "epic-wave: the paragraph on where the owner-stop status goes is there" test -n "$owner_where"
for p in \
    'worfy reads the main branch with the committed ticket branch of each worktree laid over it' \
    'a branch never undoes `blocked` or `done` of the main branch' \
    'in the ticket'"'"'s own worktree, committed on the ticket'"'"'s branch with only the ticket file' \
    'git -C <worktree> commit -m "<message>" -- <ticket file>' \
    'A block left uncommitted, or written in the orchestrator'"'"'s own tree, stays invisible' \
    'A ticket with no worktree' \
    '`ticket claim <epic> <NN>` in the ticket'"'"'s worktree, committed the same way' \
    'When the main branch already says `blocked`' \
    '`ticket open` when it has none' \
    'carries the `review` mark over' \
    '`check/<name>` marks are never carried' \
    'Silent mode (section 0): `ticket block` and `ticket claim` from any directory are enough'; do
    check "epic-wave: where the owner-stop status goes — '$p'" grep -qF -- "$p" <<<"$owner_where"
done
check "epic-wave: the owner-stop block is not run from the orchestrator's own tree" \
    lacks_re <(printf '%s\n%s\n' "$owner_stop" "$owner_where") 'right away and from its own tree'
check "epic-wave: the re-claim does not always go on the branch alone" \
    lacks_re <(printf '%s\n%s\n' "$owner_stop" "$owner_where") 're-claim goes the same way'
check "epic-wave: the where-paragraph follows the owner-stop rule" \
    awk '/^\*\*A ticket stopped for the owner/ { q = NR } /^\*\*Where the owner-stop status is written\.\*\*/ { if (q && NR > q && NR - q < 20) found = 1 } END { exit !found }' "$EW"
check "epic-wave: the owner-stop rule follows 'Questions for the owner do not stop the wave'" \
    awk '/^\*\*Questions for the owner do not stop the wave\.\*\*/ { q = NR } /^\*\*A ticket stopped for the owner/ { if (q && NR > q && NR - q < 20) found = 1 } END { exit !found }' "$EW"
check "epic-wave: human-review and awaiting-merge tickets still stay claimed (section 0)" has_flat "$EW" \
    'Such a ticket stays `claimed` with its PR open, the wave goes on without it, and its report row says whom it waits for (section 5): it is not `blocked`.'
```

- Что делает: берёт каждый абзац целиком (`para_of`, абзац между пустыми строками) и ищет в нём нужные фразы: команду,
  «right away» после конца хода implementer-а, отказ от `claimed`, строки отчёта и state file, исключение для людей
  Pipeline-а; во втором — что читает worfy, commit одного файла, Ticket без worktree, ответ в main при `blocked` там,
  отметки на новом head-е, Silent mode. Отдельно — нет прежних форм («from its own tree», «re-claim goes the same
  way»), порядок абзацев и неизменная фраза раздела 0.
- Почему здесь: Ticket называет этот файл местом проверки (`has`/`lacks` по тексту SKILL.md).
- Без него: правило или место записи можно убрать или вернуть прежнюю форму, и ни одна проверка не покраснеет.
- Требование: [Что делаем, п. 4](../issues/131-epic-wave-ticket-ждущий-владельца-сразу-blocked.md#что-делаем)
- Риски и пробелы test-ов: проверяет слова, а не поведение агента; mutant-ы (без команды, «from its own tree», без
  «When the main branch already says `blocked`», `commit -am` вместо `-- <ticket file>`) красные, перефразировка с теми
  же фразами — зелёная.

## 5. Что сознательно не меняли

Раздел 0 (люди Pipeline-а: `human-review`, `awaiting-merge` — Ticket остаётся `claimed`) не тронут. Eval-случай не
добавлен, хотя scaffold мог бы его поставить: новый случай на `skills/epic-wave/SKILL.md` меняет набор, который
`--changed` выбирает для этого файла, а ровно три случая закрепляют contract test-ы runner-а
(`test/contract/harness-evals-run.test.ts`, `test/contract/harness-evals-shared.ts`) вне следа Ticket-а. Сообщение
`setAsideText` Autopilot-а не правилось: его текст дословно закреплён в двух contract test-ах и на feature page.

## 6. Как проверено

`bash harness/bin/tests/epic-wave-ship-ticket.test.sh`: каждая редакция — сначала красная (10, затем 6, затем 16
красных проверок), потом exit 0 (сейчас 650); каждый mutant — exit 1. `bash harness/bin/tests/agents-text.test.sh`,
`pnpm test test/contract/codex-parity.test.ts`, `pnpm lint` — exit 0. gate fast не запускался по брифу: на этом Mac
`fseventsd` делает test-ы watcher-а файлов красными; вердикт — CI, включая job-ы Windows (платформенный PR).

## Проверить себя

1. Почему ответ владельца иногда надо записать и в main, а не только на ветку Ticket-а?
   - Ответ: ветка никогда не отменяет `blocked` из main; если documents PR уже влил блок или у Ticket-а нет worktree,
     claim на ветке не виден, а Wave берёт только `open` Ticket-ы.
   - Строки: `harness/skills/epic-wave/SKILL.md:400-404`
2. Почему блок ждёт конца хода implementer-а и commit-ит только файл Ticket-а?
   - Ответ: commit в worktree, где implementer ещё пишет, захватит его недописанные файлы или столкнётся на
     `index.lock`.
   - Строки: `harness/skills/epic-wave/SKILL.md:379-380`, `harness/skills/epic-wave/SKILL.md:394-395`

## 7. Что нашёл review и что осталось

> VERIFIED — worfy-polish 131 (epic-wave: a Ticket stopped for the owner's answer goes `blocked --waits owner` at once), head 6a3fac24abdb9db83e9b5cee34d63049ec31548c
>
> Gate (depth medium, three rounds, cap reached): verifier (lens: implementer's report) round 1 one med (block in the Orchestrator's own tree is invisible to worfy) + one low (eval reason); reviewer (lens: correctness) round 2 two med (re-claim invisible once main says blocked; commit sweeping the implementer's work) + one low (Silent mode); round 3 low only. All med fixed test-first.
>
> - Rule (harness/skills/epic-wave/SKILL.md:376-410): after the implementer's turn ended, `ticket block <epic> <NN> "<reason>" --waits owner` in the ticket's own worktree, committed with only the ticket file; no worktree → on main by the documents-PR path; after the owner's answer `ticket claim` in the worktree, and on main too when main already says blocked (`ticket open` without a worktree); an open PR keeps its review mark for a tickets-root-only head move (land), check/* marks set again; Silent mode — ticket from any directory, no commit; human-review / awaiting-merge stay claimed. worfy reads committed local branches of worktrees over origin/main (reader.ts branchOverrides), so Autopilot stops continuations.
> - Tests: epic-wave-ship-ticket.test.sh red before the text (16 failed, exit 1), 650 passed EXIT=0 after; mutants (old «own tree» wording, no «main already blocked» clause, `commit -am`) each red; agents-text.test.sh, codex-parity, lint, story-check, evidence-check EXIT=0. Local gate fast not run: file-watcher tests red on this Mac (fseventsd); CI incl. Windows jobs is the verdict (platform PR, ADR-0056).
> - CI fix: 99c7ae775 was red on plugin-neutral.test.sh (a worfy ticket number and an app source path in two test comments); 6a3fac24a makes them neutral; plugin-neutral 37 passed, epic-wave-ship-ticket 650, agents-text, codex-parity, lint, story-check, evidence-check EXIT=0.
>
> Decided without the owner (to confirm): no eval case — the scaffold could set it up, but harness-evals-run.test.ts and harness-evals-shared.ts pin exactly three cases for this file; the rule is checked by text only.
>
> Consider [low]: SKILL.md:400-404 — the re-claim on main names no moment or tool (land's documents PR only runs `ticket done`), so worfy may show «waits owner» until a separate documents commit; SKILL.md:394 — `commit -- <ticket file>` has no fallback for an untracked ticket file or a commit during merge/rebase; SKILL.md:405-408 — the review carry needs the state file to keep the verified head; Autopilot's setAsideText (continuation.ts:40-46) still names no tree for its block (text pinned in two contract tests).

Code: `harness/skills/epic-wave/SKILL.md:376-410` · key lines: 376

```md
**A ticket stopped for the owner's answer is `blocked` at once.** The wave stops a ticket for the
owner when no option is the orchestrator's to pick (money, deleted data, an irreversible step, a
direction nobody recorded) or when only the owner can clear what holds it, such as an open issue.
The orchestrator then runs, right away — once the ticket's implementer has ended its turn (its
report came, or it was stopped), so nothing else writes in its worktree —
`"${CLAUDE_PLUGIN_ROOT}/bin/ticket" block <epic> <NN> "<reason>" --waits owner`; `<reason>`
names the question and what it waits for (the issue, the decision). It does not stay `claimed`:
worfy Autopilot counts a `claimed` ticket as stuck and spends its continuations on it, while a
`blocked` ticket with `Waits: owner` shows as waiting for the owner. The rest is that of any other
block: a line in the state file's list of what waits for the owner, a `blocked` row in the wave
report (section 5), and the same `ticket block` in the documents PR (section 4, item 4). Once the
owner answers, the ticket is claimed again and goes on in the wave. A ticket whose PR waits for
People in the Pipeline (`human-review`, `awaiting-merge`, section 0) stays `claimed`: this rule
does not cover it.

**Where the owner-stop status is written.** worfy reads the main branch with the committed ticket
branch of each worktree laid over it, and a branch never undoes `blocked` or `done` of the main
branch. So:
- The block: in the ticket's own worktree, committed on the ticket's branch with only the ticket
  file, `git -C <worktree> commit -m "<message>" -- <ticket file>`, where the claim is ("How to
  resume a wave"); a push is not needed. A block left uncommitted, or written in the
  orchestrator's own tree, stays invisible until the documents PR merges, and Autopilot goes on
  sending continuations. A ticket with no worktree (not dispatched yet, or its worktree removed)
  gets the block on the main branch, the way the documents PR carries statuses.
- The owner's answer: `ticket claim <epic> <NN>` in the ticket's worktree, committed the same way.
  When the main branch already says `blocked` (the documents PR merged the block, or the ticket had
  no worktree), the main branch gets the answer too, by the same documents path: `ticket claim`
  when the ticket goes on in its worktree, `ticket open` when it has none, so that a later wave
  takes it (a wave takes only `open` tickets, section 1).
- An open PR: the status commit moves the PR's head at its next push, inside the tickets root
  only. `land` takes such a head and carries the `review` mark over from the verified head (section
  4, "Merge with land"); CI runs again on it, and `check/<name>` marks are never carried: the
  orchestrator sets them again on the new head (section 4, "Checks before merge").
- Silent mode (section 0): `ticket block` and `ticket claim` from any directory are enough; the
  status goes straight into the Workflow folder, with no commit.
```
