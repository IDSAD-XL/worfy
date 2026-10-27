# 29 — Платформенный PR с вердиктом Windows `success` входит в набор wave-gate

Type: task
Status: open
Blocked by: 07, 24
Source: [spec.md](../spec.md), раздел «Решения владельца 2026-10-28: процесс», предложение 3, решение 6;
ADR-0065 (один gate full на набор PR Wave), пункт 5 —
платформенные PR вне набора; ADR-0067 (Check `windows` — метка `check/windows`); ADR-0071.

## Что происходит

- `harness/bin/wave-gate:595` — `if (pr.platform === true) st.excluded.push({ number, reason: "platform" })`:
  платформенный PR вливается по-старому, по одному, со своим rebase и gate full.
- Windows-Ticket-ов — 57 % (аналитика 2026-10-27), и с ними набор Wave почти пуст: экономия wave-gate не
  работает там, где ожидание дольше всего (2,5 h против 0,6 h).
- Вердикт Windows ставится на head PR (`check/windows`), а набор проверяется на общем дереве.

Правка 2026-10-28 (решение 0 spec-а, «Переходим на CI раннеры»): Ticket нужен, только если оценка Ticket-а 07 оставит `wave-gate`
путём по умолчанию. С `ci-ok` (Ticket 35) платформенный PR со scope `runner` получает Windows `full` в своём
`ci-ok`, и `windows_verdict` `success` = зелёный Windows job этого `ci-ok`. Если `wave-gate` уходит — Ticket
закрывается этим ответом.

## Что делаем

1. Новый ADR: платформенный PR с `check/windows` `success` на его проверенном head входит в набор; PR со
   `pending`, `failure` или без метки — вне набора, как сейчас. После merge Wave с таким PR — run
   `windows-full` на `main` (уже в правилах Profile-а, ADR-0071); красный — исправление вперёд. ADR-0065 не
   правится; в его конец — `## Amendments` со ссылкой на новый ADR.
2. `wave-gate`: поле PR `windows_verdict` (`success` / `pending` / `failure` / `none`); исключение `platform` —
   только без `success`. Поле пишется в state file; для scope `runner` его значение — вывод
   `scripts/windows-run-verdict.mjs` (Ticket 24) по автоматическому run-у «Windows tests» на head PR.
3. Skill `epic-wave`, «Gate before merge»: `ready, PLATFORM` с `success` — в `PRS=(…)` набора.

Нужен ПК: нет. **Трогает Harness: да** — `harness/bin/wave-gate`, skill `epic-wave`; слово владельца дано
2026-10-28 (решение 1); новый ADR (номер — `bin/preflight` при claim; на main `f85f8bc8` свободен 0083). Вердикт
Windows: runner `full`.

## Готово, когда

- [ ] `harness/bin/tests/wave-gate.test.sh`: платформенный PR с `windows_verdict: success` — в наборе; с
      `pending` — `excluded` с причиной `platform`; без поля — как сейчас (`excluded`).
- [ ] ADR в `docs/adr/`, раздел `## Amendments` в ADR-0065 — одной датированной строкой.
- [ ] Текст skill-а; `harness/bin/tests/epic-wave-ship-ticket.test.sh` — exit 0.
- [ ] Shell test-ы Harness — exit 0; вердикт Windows — runner `full`; условие merge — `ci-ok` (Ticket 35; до него — gate full Orchestrator-а).
- [ ] (вручную) Первая Wave с платформенным PR в наборе и зелёный `windows-full` на `main` после неё — ссылки в
      «Итог».

## Где в коде

- `harness/bin/wave-gate` (`:29-30`, `:43`, `:595`), `harness/bin/tests/wave-gate.test.sh`
- `harness/skills/epic-wave/SKILL.md` — раздел 4, «Checks before merge» и «Gate before merge» (`:928-950`)
- `docs/adr/0083-…` (номер на claim), `docs/adr/0065-one-gate-full-per-wave-merge-set.md` — только `## Amendments`

## Вне скоупа

- PR со scope `pc` и gate full на ПК — Ticket 30.

## Итог
