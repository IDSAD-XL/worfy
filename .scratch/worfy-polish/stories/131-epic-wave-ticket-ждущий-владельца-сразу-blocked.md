# Code story — worfy-polish 131: epic-wave: Ticket, который Orchestrator остановил ради решения владельца, сразу `blocked --waits owner`

Kind: pr · Epic: worfy-polish · Ticket: 131 · PR: - · Language: ru

## 1. Что было не так

Skill epic-wave говорил только о развилке, которую Orchestrator решает сам по рекомендации. Ticket, которому нужен
ответ владельца, оставался `claimed`. Autopilot считает `claimed` Ticket застрявшим и шлёт continuation-ы; 2026-11-20
worfy-changes-view 03 ждал владельца по issue с меткой `pc-main-red`, получил два continuation-а и был отложен с
причиной «stuck: claimed after 2 continuations».

- Требование: [Что происходит](../issues/131-epic-wave-ticket-ждущий-владельца-сразу-blocked.md#что-происходит)

## 2. Правило в разделе 2 skill-а: Ticket, остановленный ради владельца, сразу `blocked` с `Waits: owner`

Code: `harness/skills/epic-wave/SKILL.md:376-388` · key lines: 379, 380, 381, 386, 387

```md
**A ticket stopped for the owner's answer is `blocked` at once.** The wave stops a ticket for the
owner when no option is the orchestrator's to pick (money, deleted data, an irreversible step, a
direction nobody recorded) or when only the owner can clear what holds it, such as an open issue.
The orchestrator then runs, right away and from its own tree,
`"${CLAUDE_PLUGIN_ROOT}/bin/ticket" block <epic> <NN> "<reason>" --waits owner`; `<reason>`
names the question and what it waits for (the issue, the decision). It does not stay `claimed`:
worfy Autopilot counts a `claimed` ticket as stuck and spends its continuations on it, while a
`blocked` ticket with `Waits: owner` shows as waiting for the owner. The rest is that of any other
block: a line in the state file's list of what waits for the owner, a `blocked` row in the wave
report (section 5), and the same `ticket block` in the documents PR (section 4, item 4). Once the
owner answers, `ticket claim <epic> <NN>` again, and the ticket goes on in the wave. A ticket whose
PR waits for People in the Pipeline (`human-review`, `awaiting-merge`, section 0) stays `claimed`:
this rule does not cover it.
```

- Что делает: называет, когда Wave останавливает Ticket ради владельца, и даёт Orchestrator-у точную команду
  `ticket block … --waits owner` сразу, а не в конце Wave-а. Дальше — как у любой блокировки: строка в state file,
  строка `blocked` в отчёте, тот же статус в documents PR. После ответа — `ticket claim` снова. Ticket-ы, чей PR ждёт
  людей Pipeline-а, правило не трогает.
- Почему здесь: Ticket называет раздел 2 «Dispatch», абзац «Questions for the owner do not stop the wave»; новый абзац
  стоит сразу после него. Почему Orchestrator запускает команду «из своего дерева»: так же Autopilot просит отложить
  Ticket (`src/shared/autopilot/continuation.ts`, `setAsideText`) — команду запускает Orchestrator там, где работает.
- Без него: Ticket, ждущий владельца, остаётся `claimed`, Autopilot тратит на него два continuation-а и откладывает его
  сам, с причиной «stuck», которая не называет вопрос.
- Требование: [Что делаем, п. 1–3](../issues/131-epic-wave-ticket-ждущий-владельца-сразу-blocked.md#что-делаем)
- Риски и пробелы test-ов: поведение агента проверяет только текст; eval-случая нет (причина — в «Итог» Ticket-а).
  Что Autopilot читает статус из того дерева, где Orchestrator запустил `ticket block`, не проверено: не записано.

## 3. Text contract test: абзац на месте, команда и границы правила в нём

Code: `harness/bin/tests/epic-wave-ship-ticket.test.sh:1295-1314` · key lines: 1298, 1301, 1308, 1313

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
    'People in the Pipeline (`human-review`, `awaiting-merge`, section 0) stays `claimed`'; do
    check "epic-wave: a ticket stopped for the owner — '$p'" grep -qF -- "$p" <<<"$owner_stop"
done
check "epic-wave: the owner-stop rule follows 'Questions for the owner do not stop the wave'" \
    awk '/^\*\*Questions for the owner do not stop the wave\.\*\*/ { q = NR } /^\*\*A ticket stopped for the owner/ { if (q && NR > q && NR - q < 20) found = 1 } END { exit !found }' "$EW"
check "epic-wave: human-review and awaiting-merge tickets still stay claimed (section 0)" has_flat "$EW" \
    'Such a ticket stays `claimed` with its PR open, the wave goes on without it, and its report row says whom it waits for (section 5): it is not `blocked`.'
```

- Что делает: берёт абзац целиком (`para_of`, абзац между пустыми строками) и ищет в нём команду, слово «right away»,
  отказ от `claimed`, причину, строки отчёта и state file, повторный `claim` и исключение для людей Pipeline-а.
  Отдельно — что абзац стоит сразу после «Questions for the owner…» и что фраза раздела 0 про `human-review` /
  `awaiting-merge` не изменилась.
- Почему здесь: Ticket называет этот файл местом проверки (`has`/`lacks` по тексту SKILL.md).
- Без него: правило можно убрать из skill-а или переписать так, что команда пропадёт, и ни одна проверка не покраснеет.
- Требование: [Что делаем, п. 4](../issues/131-epic-wave-ticket-ждущий-владельца-сразу-blocked.md#что-делаем)
- Риски и пробелы test-ов: проверяет слова, а не поведение агента; mutant с убранной командой красный, перефразировка
  с той же командой — зелёная.

## 4. Что сознательно не меняли

Раздел 0 (люди Pipeline-а: `human-review`, `awaiting-merge` — Ticket остаётся `claimed`) не тронут. Eval-случай не
добавлен: новый случай на `skills/epic-wave/SKILL.md` меняет набор, который `--changed` выбирает для этого файла, а его
закрепляют contract test-ы runner-а (`test/contract/harness-evals-run.test.ts`, `test/contract/harness-evals-shared.ts`)
вне следа Ticket-а.

## 5. Как проверено

`bash harness/bin/tests/epic-wave-ship-ticket.test.sh` до правки текста — exit 1 (10 красных), после — exit 0 (634).
Mutant без команды `ticket block … --waits owner` — exit 1, красная одна проверка. `bash
harness/bin/tests/agents-text.test.sh` — exit 0; `pnpm test test/contract/codex-parity.test.ts` — exit 0; `pnpm lint` —
exit 0. gate fast не запускался по брифу: на этом Mac `fseventsd` делает test-ы watcher-а файлов красными; вердикт — CI,
включая job-ы Windows (платформенный PR).

## Проверить себя

1. Почему Ticket, ждущий решения владельца, нельзя оставить `claimed`, а Ticket с PR в `awaiting-merge` можно?
   - Ответ: `claimed` Autopilot считает застрявшим и тратит на него continuation-ы; Ticket людей Pipeline-а ждёт по
     собственному правилу раздела 0, и его строка отчёта говорит, кого он ждёт.
   - Строки: `harness/skills/epic-wave/SKILL.md:381-388`
2. Что делает Orchestrator, когда владелец ответил?
   - Ответ: снова `ticket claim <epic> <NN>`, и Ticket идёт дальше в Wave-е.
   - Строки: `harness/skills/epic-wave/SKILL.md:386-387`
