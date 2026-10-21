# 50 — Линза «отчёт implementer-а» и вердикт первой строкой — в `agents/reviewer.md`, а не только в skill `epic-wave`

Type: task
Status: done 2026-10-21T00:35Z
PR: #631
Blocked by: —
Source: follow-up Ticket-а 27 (eval-кейсы Harness): платный круг 2026-10-18, кейс `reviewer-verdict` — 0.67 при
пороге 0.8 («Итог» Ticket-а 27, «Ниже порога — нарушения правил Harness», на ветке `worfy-harness/27-eval`,
PR #496); решение владельца 2026-10-19, Q-d: набор из 25 run-ов, собранный из 8 вызовов, считается полным
прогоном, и Ticket 27 закрывается с двумя follow-up-ами — этим и 51.

## Что происходит

- Кейс eval `reviewer-verdict` (`harness/evals/reviewer-verdict/`) даёт reviewer-у отчёт implementer-а с ложным
  утверждением. Grader `rejected-first` требует, чтобы ответ начинался с `REJECTED`.
- В наборе 3 run-а из 3 не прошли этот grader: reviewer нашёл ложное утверждение (судья — PASS 3 из 3) и ответил
  списком находок, но без строки вердикта. Оценка кейса — 0.67, 3 run-а, 0.71 USD, 207 с.
- Правило «первая строка — `VERIFIED` или `REJECTED`» записано только в skill `epic-wave`, в разделе о проверке
  отчёта implementer-а: что проверяет verifier — `harness/skills/epic-wave/SKILL.md:437-443`, вердикт первой
  строкой — `:488-489`. В `harness/agents/reviewer.md` его нет: формат ответа там — список находок
  (`:173-184`), описана только линза `simplification` (`:186-`).
- Главная Session без skill `epic-wave` правило reviewer-у не передала: оно идёт со skill, а не с агентом.

## Что делаем

1. В `harness/agents/reviewer.md`, раздел «Lens descriptions», — линза «implementer's report»: перечитать каждый
   `file:line` из `claims`, сверить `exit_code` из `commands` со своим запуском, искать опровержение самого
   сильного утверждения отчёта; ответ этой линзы начинается строкой `VERIFIED` или `REJECTED` со списком
   неподтверждённых утверждений.
2. В `harness/skills/epic-wave/SKILL.md` — ссылка на линзу агента вместо второй копии правила; то, что относится
   только к Wave (запись вердикта в PR, отметка `review`), остаётся в skill.
3. Перепрогнать кейс `reviewer-verdict`: 3 run-а, оценка ≥ 0.8.

**Прогон платный.** Оценка по прайсу набора — около 0.7 USD за 3 run-а; run-ы тратят лимит подписки. Вызов:
`pnpm eval:harness -- --tag main --case reviewer-verdict --runs 3 --max-cost-usd 1.5`.

**Docker.** Eval с `Bash` Claude Code не запускает, пока в `~/.docker` лежат символические ссылки (папка
`~/.docker/bin/lib` от Docker Model Runner; «Итог» Ticket-а 27, «Прогон 2026-10-18, вечер»). Перед прогоном —
перенести `~/.docker/bin` вне `~/.docker` (например, `mv ~/.docker/bin ~/docker-bin.off`), после — вернуть
(`mv ~/docker-bin.off ~/.docker/bin`). Проверка: `find ~/.docker -type l -not -path '*/cli-plugins/*'` — пусто.

## Готово, когда

- [ ] `harness/agents/reviewer.md` содержит линзу «implementer's report» и правило вердикта первой строкой;
      `epic-wave/SKILL.md` ссылается на неё.
- [ ] `pnpm test` (`test/contract/harness-scripts.test.ts`, `harness/bin/tests/agents-text.test.sh`) — exit 0.
- [ ] `pnpm eval:harness -- --tag main --case reviewer-verdict --runs 3` — оценка ≥ 0.8; таблица вызова (оценка,
      run-ы, цена, время, код выхода) — в «Итог».
- [ ] `~/.docker/bin` возвращена на место после прогона.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0. gate full — шаг Orchestrator-а перед merge; после мержа —
      `pnpm install:stable` (ADR-0047).

## Тесты

Сначала падающий случай в `harness/bin/tests/agents-text.test.sh` (он уже сверяет текст `reviewer.md`): в
`reviewer.md` есть линза «implementer's report» и строка о `VERIFIED` / `REJECTED` первой строкой. Поведение
проверяет кейс eval `reviewer-verdict` (платно, см. выше).

## Где в коде

- `harness/agents/reviewer.md`
- `harness/skills/epic-wave/SKILL.md`
- `harness/bin/tests/agents-text.test.sh`

## Итог

PR [#631](https://github.com/IDSAD-XL/worfy/pull/631), merge 9f9529c9. Gate full Mac зелёный; Windows verdict (check/windows)
зелёный. Платформенный PR (`harness/bin/tests`). Ревью: один круг (корректность, тесты), high/med нет; 4 low исправлены.
**Шаг владельца не сделан:** платный eval `reviewer-verdict` ×3 (≥ 0.8, с переносом `~/.docker/bin` и возвратом) и
`pnpm install:stable`.

- **`harness/agents/reviewer.md`, «Lens descriptions»:** новая линза «implementer's report» — сначала `not_verified`,
  перечитать каждый `file:line` из `claims`, сверить каждый `exit_code` из `commands` со своим прогоном, искать
  опровержение самой сильной фразы. Ответ начинается строкой вердикта: `VERIFIED` или `REJECTED: <неподтверждённое>`;
  строка упавшего `profile` под этой линзой — второй. Gate 3 или 127 → `REJECTED: gate 3 — <строка причины>`.
- **`epic-wave/SKILL.md`, раздел 3:** вторая копия правила убрана, skill ссылается на линзу агента.
- **`agents-text.test.sh`, раздел 13:** линза и её текст по предложениям и по порядку; порядок строки профиля; ссылка из
  skill-а; копии в skill-е ловятся и по старой формулировке, и по пересказу.
- **`harness/evals/reviewer-verdict/prompt.md`** называет источник правила — `agents/reviewer.md`.
- **Мутанты красные:** правило убрано; линза убрана; копия в skill-е; предложения про улики и 30 строк убраны;
  противоречащее «summary before the verdict»; предложение про gate 3 убрано; пересказанная копия в skill-е.

### Платный прогон 2026-10-21 и исправление

Владелец разрешил прогон; `pnpm install:stable` сделан (Stable и Harness с main `cd77f454`). Прогон
`pnpm eval:harness -- --tag main --case reviewer-verdict --runs 3 --max-cost-usd 1.5`: **0.67 ×3, ниже порога 0.8**,
$0.84. `names-false-claim` и `one-reviewer` — PASS во всех трёх run-ах; `rejected-first` (`^REJECTED`) — FAIL во
всех: reviewer отклонял отчёт верно, но первая строка была `Verdict: REJECTED: …`, вводная фраза перед
`**REJECTED: …**` или `VERIFIED: nothing — REJECTED: …`. Правило в `reviewer.md` после #631 не менялось; после
#631 кейс не был зелёным ни разу.

Исправление (PR fix/reviewer-verdict-first-line): в линзе «implementer's report» — первые символы ответа ровно
`VERIFIED` или `REJECTED:`, без метки `Verdict:`, без разметки, без вводной фразы, один вердикт на строке; в общем
«Answer format» — отсылка, что под этой линзой вердикт идёт раньше всего. `agents-text.test.sh` закрепляет новые
фразы. Проверка — ещё один платный прогон кейса (×3) после merge и `pnpm install:stable`.
