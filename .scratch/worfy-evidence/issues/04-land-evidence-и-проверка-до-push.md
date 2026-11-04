# 04 — `land`: строки Evidence при закрытии и privacy check до push

Type: task
Status: open
Blocked by: 01, 02
Source: [spec.md](../spec.md), «Модель» («Кто пишет какие строки»), «Где privacy check бежит», п. 3, «Вопросы владельцу», Q2, Q6

## Что происходит

- `land` сливает PR-ы и закрывает их Ticket-ы одним documents PR: в своём worktree `ticket done … --root`, затем `docs_check`,
  commit, push, `gh pr create` (`harness/bin/land:32-36`, `:431-448`). State-файл пишет Orchestrator: `prs [{number, epic, ticket,
  head, checks}]` (`harness/bin/land:52-55`).
- Verdict ревью и зелёный `ci-ok` известны Orchestrator-у до merge, но в Ticket не попадают. Писать их в ветку после CI — новый
  head и ещё один полный CI run.
- Documents PR `land` пушит без проверки личных данных.
- При `tickets_root: null` (Silent mode, Ticket-ы в Workflow folder) documents PR нет и `ticket done` делает Orchestrator
  (`harness/bin/land:48-51`).
- С `--root` `ticket` не читает Profile (`harness/bin/ticket:220`): заголовок раздела берётся по умолчанию и старым русским
  (Ticket 01).

## Что делаем

Ответ Q6 — вариант (а); Ответ Q2 — вариант (а).

1. **Поле `prs[].evidence`** state-файла — необязательный список `{item, kind, verdict, ref, platform?, copy?, sha?}`; в
   documents worktree перед `ticket done` для каждого — `ticket evidence <epic> <NN> <item> <kind> <verdict> --ref … [--sha …]
   --root <tree>/<tickets_root>`, как у `ticket done` (`harness/bin/land:430`); SHA по умолчанию — `prs[].head`, платформа — `ci` у
   `ci-check`, `-` у `review`, копия — `-`. Ошибка — `Wait` с текстом, как у `ticket done`.
2. **Privacy check до push**: после `docs_check` и `git add -A` — `evidence-check --changed --root <tree>/<tickets_root> --base
   refs/remotes/<remote>/<branch>` в documents worktree. Exit 1 — `Wait` «evidence-check found N findings», commit и push не делаются, `docs[].result` — `red`.
3. **Silent mode** (`tickets_root: null`): `prs[].evidence` не пишется — documents PR нет. `land` печатает строку «evidence of #N is
   the orchestrator's (tickets outside the repository)», как для `ticket done`. Строки `review` и `ci-check` Orchestrator пишет сам:
   `ticket evidence …` в Workflow folder (07).
4. Описание поля и шагов — в шапке `land`.

Не входит: текст skill `epic-wave`, где Orchestrator заполняет `prs[].evidence` (07).

## Готово, когда

- [ ] Shell test `land`: `prs[].evidence` с `review pass` и `ci-check pass` — в documents PR у Ticket-а две строки Evidence под
      пунктами, `Status: done`, SHA — `prs[].head`.
- [ ] Shell test: неверная запись (номер пункта вне раздела) — `Wait`, documents PR не создан, state-файл называет причину.
- [ ] Shell test: файл с находкой в documents worktree — push не было (журнал stand-in-а `gh` и git remote пусты), `docs[].result`
      `red`, в выводе нет полного значения.
- [ ] Shell test: старый state-файл без `evidence` работает как раньше.
- [ ] Shell test: `tickets_root: null` и `prs[].evidence` — `ticket evidence` не зовётся (журнал stand-in-а `LAND_TICKET`), строка
      «evidence of #N is the orchestrator's» в выводе.
- [ ] Shell test: и `ticket evidence`, и `evidence-check` получили `--root <tree>/<tickets_root>` (журнал stand-in-а).
- [ ] `bash harness/bin/tests/land.test.sh` — exit 0; Windows verdict до merge (platform PR).

## Тесты

- Shell `harness/bin/tests/land.test.sh` — новые случаи.
- Сначала падающий: state-файл с `prs[].evidence` — строки не появились.
- Прогнать `harness/bin/tests/land.test.sh`, `wave-gate-merge.test.sh`, все `ticket-*.test.sh`.

## Где в коде

- `harness/bin/land`
- `harness/bin/tests/land.test.sh`

Только читать: `harness/bin/ticket`, `harness/bin/evidence-check` (зовутся).
