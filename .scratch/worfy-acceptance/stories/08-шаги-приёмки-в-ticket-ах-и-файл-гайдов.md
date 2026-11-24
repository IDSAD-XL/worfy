# Code story — worfy-acceptance 08: Шаги приёмки в Ticket-ах: правило Harness для ручных пунктов, перенос гайдов, файл гайдов до приёмки владельцем

Kind: pr · Epic: worfy-acceptance · Ticket: 08 · PR: - · Language: ru

## 1. Что было не так

Шаги приёмок жили в файле `.scratch/owner-acceptance-guides.md` («Сделай → Должно быть», «Перед началом Orchestrator
сделает»), а пункты — в Ticket-ах, и они расходились. Вид Acceptance (Ticket 05) показывает ручные пункты Ticket-ов, так
что шаг, которого нет в Ticket-е, владелец там не увидит. Правила, как писать ручной пункт для владельца, в Harness не
было.

- Требование: [Что происходит](../issues/08-шаги-приёмки-в-ticket-ах-и-файл-гайдов.md#что-происходит)

## 2. Правило ручного пункта в шаге 6 ship-ticket

Code: `harness/skills/ship-ticket/step-6-manual-gui-checks.md:55-63` · key lines: 56, 57, 59

```markdown
**A manual item is written for the owner.** One step per item:
`Do: <what the owner does> → Expect: <what the owner should see>`, the two labels in the language of
the project's documents. Under it goes a `needs: <platform> [<copy>]` line that names where the owner
checks it. A longer check is several such items, one per step, never one item with a list of steps.
What the orchestrator prepares before the owner's steps (a sandbox, a fixture, an update of the stable
copy) is not a manual item: it goes into the same ticket as items without the manual mark, before the
step it serves. The owner reads the steps in the ticket itself, in the order of its items; worfy's
Acceptance view shows each manual item with the prepared items of its ticket, and a separate file of
steps is not kept once the owner has accepted the Acceptance view.
```

- Что делает: один ручной пункт — один шаг владельца в форме «Do → Expect» на языке документов Project-а, со строкой
  `needs:`; подготовка Orchestrator-а — пункты того же Ticket-а без метки, перед шагом, которому она служит.
- Почему здесь: Ticket, «Что делаем», пункт 1, называет этот файл и `harness/skills/to-tickets/SKILL.md`; текст английский
  по ADR-0074.
- Без него: агенты продолжали бы писать один ручной пункт со списком шагов, и вид Acceptance показывал бы владельцу
  пункт без шагов.
- Требование: [Что делаем, пункт 1](../issues/08-шаги-приёмки-в-ticket-ах-и-файл-гайдов.md#что-делаем)
- Риски и пробелы test-ов: test проверяет, что фразы есть, а не что агенты по ним пишут; метки «Do» и «Expect» выбраны
  без владельца, в русских Ticket-ах это «Сделай» и «Должно быть».

## 3. Шаблон Ticket-а to-tickets показывает такой пункт

Code: `harness/skills/to-tickets/SKILL.md:89-94` · key lines: 93, 94

```markdown
## Done when

- [ ] Acceptance criterion 1
- [ ] Acceptance criterion 2
- [ ] (manual) Do: <what the owner does> → Expect: <what the owner should see>
  - needs: mac stable
```

- Что делает: в шаблоне локального Ticket-а третий пункт — ручной, с `needs: mac stable`; разбор Evidence читает его как
  ручной пункт с требованием, без ошибок.
- Почему здесь: Ticket, «Что делаем», пункт 1, называет шаблон `to-tickets`. Skill — копия mattpocock-skills 1.3.1, поэтому
  правка записана в `harness/skills/THIRD_PARTY.md`, а новый sha256 закреплён в
  `test/contract/harness-third-party-skills.test.ts`.
- Без него: новый Ticket, нарезанный skill-ом, получал бы только автоматические пункты, и правило было бы только словами.
- Требование: [Что делаем, пункт 1](../issues/08-шаги-приёмки-в-ticket-ах-и-файл-гайдов.md#что-делаем)
- Риски и пробелы test-ов: в шаблоне буквальная метка `(manual)`; Project с другой меткой берёт свою из Profile-а, как
  сказано в правиле выше.

## 4. Test держит фразы правила в обоих файлах, и копия без любой из них красная

Code: `harness/bin/tests/agents-text.test.sh:1124-1136` · key lines: 1126, 1131, 1132

```bash
for f in "$SK/to-tickets/SKILL.md" "$GUI"; do
    name="${f#"$SK/"}"
    manual_rule_ok "$f" && ok "$name: a manual item is one Do → Expect step with needs:, the preparation items without the mark" \
        || bad "$name: no rule that a manual item is one Do → Expect step with needs: and the preparation is items without the mark"
    tr '\r\n' '  ' <"$f" | tr -s ' ' >"$T/manual-rule-flat.md"
    while IFS= read -r s; do
        [ -z "$s" ] && continue
        strip "$T/manual-rule-flat.md" "$s" >"$T/manual-rule-mutant.md"
        manual_rule_ok "$T/manual-rule-mutant.md" && bad "$name: a copy without '$s' still passes" || ok "$name: a copy without '$s' fails"
    done <<EOF
$MR_SENTENCES
EOF
done
```

- Что делает: для `to-tickets` и шага 6 проверяет каждую фразу `MR_SENTENCES` в тексте с переносами строк как пробелами,
  потом для каждой фразы строит копию без неё и ждёт, что проверка на копии упадёт.
- Почему здесь: Ticket, «Готово, когда», первый пункт, требует этот test, mutant с убранной фразой и exit 0 всего файла.
- Без него: правку текста skill-а, которая выкинет правило, никто бы не заметил.
- Требование: [Готово, когда](../issues/08-шаги-приёмки-в-ticket-ах-и-файл-гайдов.md#готово-когда)
- Риски и пробелы test-ов: сверяется буквальный текст; перефразированное правило test сочтёт пропавшим.

## 5. Что сознательно не меняли

- Существующие пункты Ticket-ов приёмок: текст, порядок, строки Evidence. Шаги дописаны после них, чтобы номера пунктов,
  на которые ссылаются строки Evidence, `Source:` Ticket-ов доработки и слова владельца, не сдвинулись.
- `HANDOFF.md`: ссылку «Ждёт владельца» на вид правит Orchestrator (Ticket, «Что делаем», пункт 4).
- Файл гайдов не удалён (Q5): в начале — ссылка на Ticket-ы и вид Acceptance.

## 6. Как проверено

- `bash harness/bin/tests/agents-text.test.sh` — exit 0 (527 passed); до правки текста — exit 1, 3 failed.
- Mutant: копия `harness/` в `mktemp -d` без фразы «A longer check…» в шаге 6 и, отдельно, в `to-tickets` — exit 1.
- `pnpm test test/contract/harness-third-party-skills.test.ts` — exit 0; `ticket evidence` всех 31 изменённых Ticket-ов —
  exit 0, ошибок разбора нет; `node harness/bin/evidence-check` — exit 0.

## Проверить себя

1. Проверка владельца из пяти действий: сколько ручных пунктов получает Ticket и что стоит под каждым?
   Answer: пять пунктов, по одному на шаг, и под каждым строка `needs:` с платформой и копией.
   Lines: `harness/skills/ship-ticket/step-6-manual-gui-checks.md:55-58`
2. Чем подготовка Orchestrator-а отличается от шага владельца в Ticket-е?
   Answer: это пункт того же Ticket-а без ручной метки, и стоит он перед шагом, которому служит.
   Lines: `harness/skills/ship-ticket/step-6-manual-gui-checks.md:59-61`
