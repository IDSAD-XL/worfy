# 01 — Один gate full на все готовые PR Wave вместо rebase и gate full на каждый PR

Type: task
Status: open
Blocked by: —
Source: [spec.md](../spec.md), решение владельца 2026-10-16, пункт 1; замер критического пути (раздел
«Откуда» spec-а: Gate → merge — 25 % времени, Wave 1 `worfy-polish` — Σ Gate → merge 611 min);
[ADR-0056](../../../docs/adr/0056-windows-checks-and-two-sessions.md), пункт 6;
[ADR-0034](../../../docs/adr/0034-autopilot-keeps-display-awake.md).

## Что происходит

- **Каждый PR с кодом перед мержем — rebase и свой gate full.** Правило — в `rules.md` Profile-а
  worfy (`~/.claude/worfy-harness/projects/worfy/rules.md:25-28`, файл вне репозитория): «Перед мержем
  любого PR с кодом — `GATE_SCOPE=all … gate.sh full` на ветке после rebase, код 0 и строка
  «[gate] зелено»». Gate full — около 11,5 min (замер на #360 и #345), потом CI на Linux заново:
  rebase меняет head PR.
- **Мерж — строго по одному, под замком.** Skill `epic-wave`, раздел 4: замок главной ветки
  `main.lock` (`harness/skills/epic-wave/SKILL.md:548-566`), «Ordinary PRs with code — one after another,
  as `VERIFIED` verdicts arrive» (`:569`). Skill `ship-ticket`, шаг 9 — тот же замок
  (`harness/skills/ship-ticket/SKILL.md:470-482`). Сам generic Harness gate full перед мержем PR не
  требует: это делает только правило Profile-а worfy.
- **ADR-0056, пункт 6** (`docs/adr/0056-windows-checks-and-two-sessions.md:55-57`): «За раз
  вливается один PR. Второй перед мержем обновляется от свежего main, и его проверки идут заново».
- **Цена очереди.** Каждый следующий PR ждёт rebase, gate full и CI предыдущего — около 30 min на PR.
  Wave 1 `worfy-polish` (10 Ticket-ов): последний PR готов на 293-й минуте, последний мерж — на 307-й,
  Σ Gate → merge — 611 min. Wave от 2026-10-15 16:17: последний PR готов на 592-й минуте, последний
  мерж — на 892-й.
- **GitHub не требует обновлять ветку перед мержем:** у main нет branch protection и rulesets
  (`gh api repos/IDSAD-XL/worfy/branches/main/protection` — 404 «Branch not protected»,
  `…/rulesets` — `[]`). Rebase перед мержем требует только наше правило. CI идёт и на push в main
  (`.github/workflows/ci.yml:12-14`), так что каждый мерж всё равно проверяет Linux.

## Что делаем

1. **ADR-0065** «Один gate full на набор готовых PR Wave» (`docs/adr/0065-one-gate-full-per-wave-merge-set.md`,
   по-русски, формат `rules.md` Profile-а, раздел ADR). Уточняет ADR-0056, пункт 6, для проверок Mac:
   мерж по-прежнему по одному, но gate full — один на набор, и PR набора перед мержем не
   перепроверяется заново, если его head не менялся. Rebase без правки кода (diff PR `merge-base..head`
   тот же) вердикт Windows-ПК и Gate сохраняет. «Considered Options»: gate full на каждый PR (сейчас);
   один на набор с делением пополам (выбрано); merge queue GitHub (нужен macOS-раннер — запрещено ценой).
2. **Скрипт `harness/bin/wave-gate`** (Node, без зависимостей). Вход: репозиторий, базовая ветка и
   список PR в порядке мержа (номер и head SHA). Шаги:
   - временный worktree от свежего `origin/<base>` в git-папке репозитория (фиксированный путь, как
     `worfy-wave-docs` в `harness/skills/epic-wave/SKILL.md`, — после обрыва Session его находят и
     переиспользуют);
   - в нём — слияние head каждого PR по порядку. PR с конфликтом выходит из набора с причиной
     `DIRTY` (назад implementer-у на rebase, как сейчас), остальные идут дальше;
   - один `GATE_SCOPE=all node <plugin>/hooks/gate.mjs full` на этом дереве — под замком e2e Profile-а;
   - зелёный (код 0 и `[gate] зелено (full)`) — печатает JSON: порядок PR, head SHA каждого, хеш дерева
     набора;
   - красный — сначала повторяет отдельно каждый упавший e2e-файл (flaky test не валит набор, урок
     `docs/lessons/agents.md:38-46`); красный и при повторе — деление пополам по префиксам порядка
     мержа: самый короткий красный префикс называет виноватый PR. Зелёный префикс перед ним можно
     вливать; виноватый идёт в круг доработки; остаток — новый набор;
   - «не удалось проверить» (код 3, 127, 130, 143, «ничего не прогналось») — не зелено, мержа нет;
   - worktree удаляется в конце и при ошибке.
3. **Skill `epic-wave`, раздел 4.** Новый блок «Gate before merge» для `pr-green-ci`: когда Profile
   просит gate перед мержем, Orchestrator собирает все `VERIFIED` PR Wave, у которых CI на head
   зелёный, и зовёт `wave-gate`. При зелёном — под замком `main.lock` по порядку
   `gh pr merge <N> --squash --match-head-commit <sha>`, без rebase и gate full на каждый PR. После
   последнего мержа — сверка `git rev-parse origin/<base>^{tree}` с хешем дерева набора. Не совпало
   (squash дал другое дерево или main двигал кто-то ещё) — gate full на main сразу и новых мержей нет,
   пока он не зелёный; итог — в отчёт Wave. PR, готовый после начала прогона набора, ждёт следующего
   набора.
4. **Поле Profile-а** `workflow.merge_gate`: `null` или нет поля — gate перед мержем не требуется (как
   сейчас для других Project-ов); `"each"` — gate full на каждый PR после rebase (сегодняшнее правило
   worfy); `"wave"` — набор через `wave-gate`. `harness/profiles/README.md` (таблица полей) и
   `harness/bin/profile` (проверка значения) знают его.
5. **Skill `ship-ticket`, шаг 9** — ссылка на блок из пункта 3: один Ticket вне Wave — набор из одного PR.
6. **(вручную, Orchestrator после мержа)** `rules.md` Profile-а worfy: правило `:25-28` переписано на
   «gate перед мержем — `workflow.merge_gate: "wave"`, ADR-0065»; в `profile.json` — поле. Diff обоих
   файлов — в «Итог».

## Готово, когда

- [ ] ADR-0065 принят в этом PR; ADR-0056 не изменён.
- [ ] `wave-gate` на временном репозитории с stub-ом gate: зелёный набор из трёх PR — JSON с порядком,
      SHA и хешем дерева; конфликт второго PR — он вне набора с `DIRTY`, остальные проверены.
- [ ] Красный третий PR из пяти: виноватый найден за ⌈log₂ 5⌉ прогонов stub-а, префикс 1–2 назван
      зелёным, ни один PR не помечен к мержу при красном наборе.
- [ ] Красный e2e-файл, зелёный при повторе отдельно, — набор зелёный, повтор назван в выводе.
- [ ] Код gate 3 и «ничего не прогналось» — не зелено, мержа нет.
- [ ] Временный worktree удалён и после зелёного, и после красного, и после ошибки посреди слияния;
      worktree, оставленный оборванным прогоном, переиспользуется.
- [ ] `profile --field workflow.merge_gate` читает `"wave"`, `"each"`, `null`; другое значение — Profile
      сломан (exit 1).
- [ ] Блоки skill `epic-wave` о наборе проходят под bash и zsh (как `harness/bin/tests/skill-blocks.test.sh`).
- [ ] (вручную) Первая Wave после обновления Harness на Mac влита по новой процедуре: число gate full,
      время от последнего готового PR до последнего мержа — в «Итог».
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; shell test-ы Harness — exit 0; gate full —
      шаг Orchestrator-а перед merge (последний раз по старой схеме); Linux CI зелёный.

## Тесты

- `harness/bin/tests/wave-gate.test.sh` — временный git-репозиторий с «origin», ветки PR, stub gate
  (скрипт, который краснеет на файле-маркере нужного PR и считает свои запуски). Без сети и без `gh`:
  список PR — аргументом.
- `harness/bin/tests/profile.test.sh` — поле `workflow.merge_gate`.
- Сначала красный: test «красный набор не даёт ни одного PR к мержу» до появления скрипта.
- Мутанты: вливать при красном наборе; делить без повтора упавшего файла; не удалять worktree после
  ошибки; не сверять хеш дерева. Каждый краснит свой test; итог — в «Итог».

## Где в коде

- `harness/bin/wave-gate`
- `harness/bin/tests/wave-gate.test.sh`
- `harness/skills/epic-wave/SKILL.md`
- `harness/skills/ship-ticket/SKILL.md`
- `harness/profiles/README.md`
- `harness/bin/profile`
- `harness/bin/tests/profile.test.sh`
- `docs/adr/0065-one-gate-full-per-wave-merge-set.md`

Только читать: `harness/hooks/gate.mjs` (коды выхода и строки вердикта), `harness/bin/tests/skill-blocks.test.sh`.
Вне репозитория (шаг Orchestrator-а): `~/.claude/worfy-harness/projects/worfy/rules.md`, `profile.json`.

## Вне скоупа

- Проверка заблокированного экрана и keep-awake на время мержей — Ticket 02.
- Gate full на Windows-ПК для платформенных PR — Ticket 04 и `worfy-windows`; правило «rebase без
  правки кода сохраняет вердикт Windows» только записывается в ADR-0065.
- Merge queue GitHub и macOS-раннер.
- `local-green` Project-ы (локальный мерж, `ship-ticket` шаг 11) — у них свой порядок; поле
  `merge_gate` на них не действует.

## Итог
