# 01 — Один gate full на все готовые PR Wave вместо rebase и gate full на каждый PR

Type: task
Status: claimed — 2026-10-16
Branch: worfy-throughput/01
Blocked by: —
Source: [spec.md](../spec.md), решение владельца 2026-10-16, пункт 1; замер критического пути (раздел
«Откуда» spec-а: Gate → merge — 25 % времени, Wave 1 `worfy-polish` — Σ Gate → merge 611 min);
[ADR-0056](../../../docs/adr/0056-windows-checks-and-two-sessions.md), пункты 2 и 6;
[ADR-0034](../../../docs/adr/0034-autopilot-keeps-display-awake.md); ревью PR #382 (Orchestrator,
2026-10-16): платформенные PR — вне набора, гарантия дерева на каждом мерже, замок e2e в скрипте.

## Что происходит

- **Каждый PR с кодом перед мержем — rebase и свой gate full.** Правило — в `rules.md` Profile-а
  worfy (`~/.claude/worfy-harness/projects/worfy/rules.md:25-28`, файл вне репозитория): «Перед мержем
  любого PR с кодом — `GATE_SCOPE=all … gate.sh full` на ветке после rebase, код 0 и строка
  «[gate] зелено»». Gate full — около 11,5 min (замер на #360 и #345), потом CI на Linux заново:
  rebase меняет head PR.
- **Мерж — строго по одному, под замком.** Skill `epic-wave`, раздел 4: замок главной ветки
  `main.lock` (`harness/skills/epic-wave/SKILL.md:548-566`), «Ordinary PRs with code — one after another,
  as `VERIFIED` verdicts arrive» (`:568`). Skill `ship-ticket`, шаг 9 — тот же замок
  (`harness/skills/ship-ticket/SKILL.md:470-482`). Сам generic Harness gate full перед мержем PR не
  требует: это делает только правило Profile-а worfy.
- **ADR-0056.** Пункт 2 (`docs/adr/0056-windows-checks-and-two-sessions.md:38-43`): платформенный PR —
  PR Epic-а `worfy-windows` и PR другого Epic-а, который трогает код с ветками по платформе, скрипты
  Harness или упаковку, — вливается после gate full на Windows-ПК. Пункт 6 (`:55-57`): «За раз вливается
  один PR. Второй перед мержем обновляется от свежего main, и его проверки идут заново: CI на Linux, а
  для платформенного PR — ещё и gate full на Windows». PR Session на Windows-ПК с общим кодом несут метку
  `needs-mac-gate` и ждут gate full на Mac (`.scratch/worfy-windows/spec.md:215-216`; очередь —
  `worfy-windows` 07 и 17).
- **Цена очереди.** Каждый следующий PR ждёт rebase, gate full и CI предыдущего — около 30 min на PR.
  Wave 1 `worfy-polish` (10 Ticket-ов): последний PR готов на 293-й минуте, последний мерж — на 307-й,
  Σ Gate → merge — 611 min. Wave от 2026-10-15 16:17: последний PR готов на 592-й минуте, последний
  мерж — на 892-й.
- **GitHub не требует обновлять ветку перед мержем:** у main нет branch protection и rulesets
  (`gh api repos/IDSAD-XL/worfy/branches/main/protection` — 404 «Branch not protected»,
  `…/rulesets` — `[]`). Rebase перед мержем требует только наше правило. CI идёт и на push в main
  (`.github/workflows/ci.yml:12-14`).
- **Замок e2e** `/tmp/worfy-e2e.lock` сейчас — текст команды в `rules.md` Profile-а (`:37-44`): `mkdir`,
  замок старше 30 min считается брошенным, фоновый `touch -c` раз в 5 min, снятие на выходе.

## Что делаем

1. **ADR-0065** «Один gate full на набор готовых PR Wave» (`docs/adr/0065-one-gate-full-per-wave-merge-set.md`,
   по-русски, формат раздела ADR `rules.md` Profile-а). Уточняет ADR-0056, пункт 6, и правило
   `rules.md:25-28`. Называет все три изменения правил:
   - **rebase и gate full на каждый PR** → один gate full на набор; PR набора перед мержем не
     перебазируется;
   - **CI на Linux заново перед мержем** → не нужен: CI зелёный на head PR, а слияние проверяет CI на
     push в main (`ci.yml:12-14`);
   - **gate full на Windows заново после rebase** → только для PR вне набора: платформенные PR и PR с
     меткой `needs-mac-gate` в набор не входят и вливаются по-старому (пункт 3).

   И что делать при красном CI на main после мержей набора: новых мержей нет; Orchestrator открывает
   revert squash-коммита первого красного push-run-а (`git revert`), revert-PR идёт по-старому — вне
   набора, со своим gate full; Ticket этого PR — в круг доработки. Revert, а не правка вперёд: дерево
   main возвращается к проверенному префиксу. «Considered Options»: gate full на каждый PR (сейчас);
   один на набор с делением пополам (выбрано); merge queue GitHub (нужен macOS-раннер — запрещено ценой).
2. **Скрипт `harness/bin/wave-gate`** (Node, без зависимостей), две команды.

   **`wave-gate check <state.json>`.** Вход — файл состояния: репозиторий, базовая ветка, список PR в
   порядке мержа (номер, head SHA, метки, флаг `platform`, который ставит Orchestrator по ADR-0056,
   пункт 2). Шаги:
   - PR с флагом `platform` или с меткой `needs-mac-gate` выходит из набора с причиной (`platform`,
     `needs-mac-gate`) — их вливают по-старому;
   - SHA `origin/<base>` записывается в состояние как `base`;
   - временный worktree от этого SHA в git-папке репозитория (фиксированный путь, как
     `worfy-wave-docs` в `harness/skills/epic-wave/SKILL.md`);
   - по порядку — `git merge --squash <head>` и commit для каждого PR, как это сделает squash-мерж
     GitHub; после каждого — хеш дерева префикса в состояние (`prefixes[i].tree`). PR с конфликтом
     выходит из набора с причиной `DIRTY` (назад implementer-у на rebase, как сейчас);
   - замок e2e из Profile-а (пункт 4) — сам скрипт: `mkdir`, heartbeat `touch -c` раз в 5 min, брошенный
     замок — старше 30 min, снятие на выходе и на ошибке; та же семантика, что `rules.md:37-44`;
   - один `GATE_SCOPE=all node <plugin>/hooks/gate.mjs full` на дереве всего набора. Зелёный (код 0 и
     `[gate] зелено (full)`) — `status: green`;
   - красный — gate full на том же дереве ещё раз. Зелёный при повторе — `status: green`, в состоянии
     `flaky: <упавшие test-ы первого прогона>`, мерж идёт. Красный и при повторе — деление пополам по
     префиксам порядка мержа: самый короткий красный префикс называет виноватый PR. В состоянии —
     `status: red`, виноватый PR, зелёный префикс перед ним и его хеш дерева (`green_prefix`,
     `green_tree`). Всего прогонов gate full — не больше 2+⌈log₂ N⌉: первый, повтор и деление;
   - «не удалось проверить» (код 3, 127, 130, 143, «ничего не прогналось») — `status: unverified`, не
     зелено, мержа нет;
   - worktree удаляется в конце и при ошибке.

   **Долгий прогон и возобновление.** До 2+⌈log₂ N⌉ прогонов по ~11,5 min не помещаются в один вызов
   Bash: skill запускает `wave-gate check` в фоне (`run_in_background`), ждёт его конца и читает
   состояние. Каждый законченный шаг (слияние префикса, прогон gate full с его деревом и итогом)
   записывается в `state.json` сразу. Повторный запуск на том же файле после обрыва Session-и
   продолжает с первого незаконченного шага: готовые прогоны gate не повторяет, worktree, оставленный
   оборванным прогоном, переиспользует. Если `origin/<base>` за это время ушёл — состояние
   сбрасывается, набор проверяется заново.

   **`wave-gate merge <state.json>`** (только при `status: green`) — под замком `main.lock`:
   - `git fetch`; `origin/<base>` должен равняться `base` из состояния. Не равен — ни одного мержа,
     выход с причиной `base moved`: набор проверяется заново (`check`);
   - по порядку: `gh pr merge <N> --squash --match-head-commit <sha>`, затем `git fetch` и сравнение
     `git rev-parse origin/<base>^{tree}` с `prefixes[i].tree`. Первое несовпадение — стоп: следующих
     мержей нет, причина и номер PR — в состояние и в отчёт Wave, затем gate full на main;
   - при `status: red` команда вливает только `green_prefix` — с той же проверкой дерева.
3. **Skill `epic-wave`, раздел 4.** Новый блок «Gate before merge» для `pr-green-ci`: когда Profile
   просит набор, Orchestrator собирает `VERIFIED` PR Wave с зелёным CI на head, ставит флаг `platform`
   по ADR-0056, пункт 2, зовёт `wave-gate check` в фоне, затем `wave-gate merge`. PR вне набора
   (`platform`, `needs-mac-gate`, `DIRTY`, виноватый) идут по-старому: по одному, rebase, свой gate full,
   для платформенного — вердикт Windows. PR, готовый после начала `check`, ждёт следующего набора.
4. **Поля Profile-а.** `workflow.merge_gate`: `null` или нет поля — gate перед мержем не требуется (как
   сейчас для других Project-ов); `"each"` — gate full на каждый PR после rebase (сегодняшнее правило
   worfy); `"wave"` — набор через `wave-gate`. `workflow.e2e_lock`: путь папки-замка e2e или `null` (без
   замка). Их знают `harness/profiles/README.md` (таблица полей), `harness/profiles/draft.schema.json`
   (объект `workflow`, `:99-108`) и `harness/bin/profile` (проверка значений). `harness/README.md:18` —
   `wave-gate` в списке скриптов `bin/`.
5. **Skill `ship-ticket`, шаг 9** — ссылка на блок из пункта 3: один Ticket вне Wave — набор из одного PR.
6. **(вручную, Orchestrator после мержа)** `rules.md` Profile-а worfy: правило `:25-28` — «gate перед
   мержем — `workflow.merge_gate: "wave"`, ADR-0065; платформенные PR и `needs-mac-gate` — по-старому»;
   правило замка `:37-44` ссылается на `workflow.e2e_lock`. В `profile.json` — оба поля
   (`e2e_lock: "/tmp/worfy-e2e.lock"`). Diff — в «Итог».

**Этот Ticket сам — платформенный PR** по ADR-0056, пункт 2: он меняет скрипты Harness
(`harness/bin/wave-gate`, `harness/bin/profile`). Он вливается по-старому, с вердиктом Windows.

## Готово, когда

- [ ] ADR-0065 принят в этом PR: три изменения правил, PR вне набора (`platform`, `needs-mac-gate`),
      revert при красном CI на main; ADR-0056 не изменён.
- [ ] `wave-gate check` на временном репозитории со stub-ом gate: зелёный набор из трёх PR — состояние с
      `base`, порядком, head SHA и деревом каждого префикса; конфликт второго PR — он вне набора с
      `DIRTY`, остальные проверены.
- [ ] PR с флагом `platform` и PR с меткой `needs-mac-gate` — вне набора с причиной; в слиянии и gate
      их нет.
- [ ] Красный третий PR из пяти: после повтора набора виноватый найден не больше чем за 1+⌈log₂ 5⌉
      прогонов stub-а (всего с первым прогоном — не больше 2+⌈log₂ 5⌉); в состоянии — `green_prefix`
      (PR 1–2) и его дерево; ни один PR вне зелёного префикса не помечен к мержу.
- [ ] Красный первый прогон, зелёный повтор — `status: green`, `flaky` с упавшими test-ами.
- [ ] Код gate 3 и «ничего не прогналось» — `unverified`, мержа нет.
- [ ] Возобновление: прогон, прерванный после первого gate full (stub считает запуски), на том же
      `state.json` продолжает без повтора готового прогона; ушедший `origin/<base>` — набор заново.
- [ ] `wave-gate merge` со stub-ом `gh`: `origin/<base>` ≠ `base` — ни одного мержа, `base moved`;
      дерево после второго мержа ≠ `prefixes[1].tree` — третий не вливается, причина в состоянии;
      `red` — вливается только `green_prefix`.
- [ ] Замок e2e: занятый живой замок — ждёт; замок старше 30 min — снимает и берёт; после выхода и
      после ошибки замка нет; во время прогона mtime обновляется.
- [ ] Временный worktree удалён после `green`, `red` и ошибки посреди слияния.
- [ ] `profile --field workflow.merge_gate` читает `"wave"`, `"each"`, `null`;
      `profile --field workflow.e2e_lock` — путь или `null`; другое значение — Profile сломан (exit 1).
- [ ] Блоки skill `epic-wave` о наборе проходят под bash и zsh (как `harness/bin/tests/skill-blocks.test.sh`).
- [ ] (вручную) Вердикт Windows по ADR-0056, пункт 2: на Windows-ПК — shell test-ы `wave-gate` и
      `profile` через Git Bash и gate full; код и строка вердикта — в «Итог». Пока `worfy-windows` 14 не
      `done` — правило «Последствий» ADR-0056 (`:73-77`).
- [ ] (вручную) Первая Wave после обновления Harness на Mac влита по новой процедуре: число gate full,
      время от последнего готового PR до последнего мержа — в «Итог».
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; shell test-ы Harness — exit 0; gate full —
      шаг Orchestrator-а перед merge (по старой схеме); Linux CI зелёный.

## Тесты

- `harness/bin/tests/wave-gate.test.sh` — временный git-репозиторий с «origin», ветки PR, stub gate
  (краснеет на файле-маркере нужного PR, считает свои запуски, умеет «красный один раз»), stub `gh`
  (`pr merge` двигает «origin» сам; режим «другое дерево»). Без сети: список PR — в `state.json`.
- `harness/bin/tests/profile.test.sh` — поля `workflow.merge_gate` и `workflow.e2e_lock`.
- Сначала красный: test «красный набор не даёт ни одного PR к мержу вне зелёного префикса» до
  появления скрипта.
- Мутанты: вливать при красном наборе; не повторять красный набор перед делением; не сверять `base`
  перед первым мержем; не сверять дерево после мержа; брать в набор PR с `platform`; не снимать замок
  e2e на ошибке; повторять готовый прогон при возобновлении. Каждый краснит свой test; итог — в «Итог».

## Где в коде

- `harness/bin/wave-gate`
- `harness/bin/tests/wave-gate.test.sh`
- `harness/skills/epic-wave/SKILL.md`
- `harness/skills/ship-ticket/SKILL.md`
- `harness/profiles/README.md`
- `harness/profiles/draft.schema.json`
- `harness/README.md`
- `harness/bin/profile`
- `harness/bin/tests/profile.test.sh`
- `docs/adr/0065-one-gate-full-per-wave-merge-set.md`

Только читать: `harness/hooks/gate.mjs` (коды выхода и строки вердикта), `harness/bin/tests/skill-blocks.test.sh`.
Вне репозитория (шаг Orchestrator-а): `~/.claude/worfy-harness/projects/worfy/rules.md`, `profile.json`.

## Вне скоупа

- Проверка заблокированного экрана и keep-awake на время проверки и мержей — Ticket 02.
- Gate full на Windows-ПК для платформенных PR — Ticket 04 и `worfy-windows`; ADR-0065 только выводит их
  из набора.
- Очередь `needs-mac-gate` (`worfy-windows` 17) — PR с этой меткой этот Ticket только не берёт в набор.
- Merge queue GitHub и macOS-раннер.
- `local-green` Project-ы (локальный мерж, `ship-ticket` шаг 11) — у них свой порядок; поле
  `merge_gate` на них не действует.

## Итог
