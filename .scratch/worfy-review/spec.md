# worfy-review: ревью, минимальное изменение и диагностика по идеям Thermos, ponytail и pstack

Status: по решению владельца 2026-10-09 («Хорошие идеи, сохрани их и добавь в планы к имплементации» —
после разбора таблицы из 7 пунктов)
Source: исследование [2026-10-09-ponytail-pstack-thermos.md](../../docs/research/2026-10-09-ponytail-pstack-thermos.md)
(разбор трёх внешних наборов prompt-ов и skills для агентов); [CONTEXT.md](../../CONTEXT.md) — термины;
Epic [worfy-harness](../worfy-harness/spec.md) (Harness как plugin `worfy`) — формат и соглашения;
[ADR-0047](../../docs/adr/0047-harness-lessons-by-pr-early-owner-switch.md) (Harness меняется через PR в
`harness/`, Stable copy не пересобирается во время Autopilot); [ADR-0055](../../docs/adr/0055-harness-scripts-in-node.md)
(новые скрипты Harness — на Node, bash только в test-ах).
Ticket-ы: Epic `worfy-review`, 7 Ticket-ов, нумерация с `01`. Шапка — тот же диалект, что у worfy-harness
(`Type:` / `Status:` / `Blocked by:` / `Source:`), чтобы её читали `epic-status`, `ticket` и вычисление Wave в
worfy (`src/shared/workflow/waves.ts`).

## Откуда идеи

Три внешних источника, все под лицензией MIT. Устанавливать их целиком не будем: берём правила и
переписываем их своими словами.

- **Thermos** — plugin Cursor с двумя review-skills: ревью корректности и ревью качества кода.
  Отсюда — проверки поломки локальной сборки, утечки feature flag, правило «не сообщать о намеренной
  поломке», линза упрощения и правило 1000 строк.
- **ponytail** — skill, который просит агента делать самое маленькое полное изменение. Отсюда —
  порядок выбора решения, комментарий `shortcut:` и список таких комментариев.
- **pstack** — набор skills Lauren Tan (Cursor). Отсюда — сортировка находок по четырём группам,
  ревью на двух моделях и журнал решений `decisions.tsv`.

Кроме них — диагностика зависания Electron: в main process worfy сейчас нет обработчиков падения
renderer и дочерних процессов.

## Цель

Ревью в Harness находит больше настоящих дефектов и меньше лишнего. Implementer пишет меньше кода.
Зависание или падение worfy оставляет запись, по которой видно, что случилось.

Epic готов, когда:

1. Reviewer проверяет поломку локальной сборки и утечки feature flag. Orchestrator сортирует его
   находки на четыре группы, и в отчёте видны отклонённые находки с причиной (Ticket 01).
2. Есть линза «упрощение» с описанием в репозитории. Владелец добавил её в свой Profile (Ticket 02).
3. Gate предупреждает, когда diff делает файл длиннее 1000 строк (Ticket 03).
4. Падение renderer или дочернего процесса worfy оставляет запись. Таймаут шага Autopilot через CDP
   (Chrome DevTools Protocol — управление окном worfy снаружи) сохраняет стек процесса (Ticket 05).
5. Прогон Wave без человека пишет журнал решений (Ticket 06).
6. Implementer идёт по порядку выбора решения и помечает упрощения комментарием `shortcut:` (Ticket 04).
7. Есть режим расширенного ревью перед рискованным merge (Ticket 07, низкий приоритет).

## Как устроено

- **Исходник Harness — `harness/`.** Установленный plugin — копия этой папки. Правка вступает в силу
  только после `pnpm install:stable` (ADR-0047). Ticket проверяется test-ами в `harness/bin/tests/*.test.sh` и
  `harness/hooks/tests/`. Поведение агента проверяют eval-кейсы в `harness/evals/`. Их платный прогон
  сейчас заблокирован: Ticket 27 Epic-а worfy-harness (eval-кейсы через `claude plugin eval`) ждёт решения
  владельца о git в песочнице. Поэтому eval-кейс в этом Epic-е — желательный пункт, а не обязательный.
- **Линзы ревью** — названия в Profile, поле `review.lenses`. Profile лежит вне git:
  `~/.claude/worfy-harness/projects/worfy/profile.json`. Сейчас там `корректность`, `границы модулей`,
  `тесты`. Описаний линз в репозитории нет: reviewer получает только название. Правка Profile — шаг
  владельца на его машине, в PR её нет. В PR идёт описание линзы.
- **Где работают линзы.** Lens reviewers запускает ship-ticket, шаг 7. В Wave Implementer идёт по шагам
  1–8 Profile без шага 7. Diff в Wave проверяет один verifier (reviewer с линзой «отчёт Implementer-а»,
  `harness/skills/epic-wave/SKILL.md`, раздел 3). Ticket-ы 01 и 02 меняют оба места.
- **Уровни находок** остаются `high` / `med` / `low`. Четыре группы Ticket-а 01 — это способ, которым
  Orchestrator показывает находки. Это не новая шкала.

## Решения владельца

2026-10-09, после таблицы из 7 пунктов: все 7 пунктов принимаются в план реализации («Хорошие идеи,
сохрани их и добавь в планы к имплементации»).

Решения плана — по исследованию, без отдельного слова владельца; подтвердить при взятии Wave 1:

1. Внешние plugin-ы не ставим. Правила переписываем в `harness/` своими словами, с указанием источника.
2. Слова целиком заглавными буквами из источников («EXTREMELY», «NOTHING») не переносим. По
   исследованию, такой нажим даёт у новых моделей Claude лишние срабатывания.
3. Режим расширенного ревью (Ticket 07) — по запросу или по пометке риска у Ticket-а, низкий
   приоритет.

Открытые вопросы каждого Ticket-а — в его разделе «Риски»: решает исполнитель, а итог пишет в «Итог».

## Не в этом Epic-е

- Ревью на моделях другого семейства (не Claude): нужен внешний CLI.
- Сверка находок с комментариями других ботов в PR.
- Skill `verify-worfy`, который управляет приложением по CDP (идея из pstack).
- Несколько параллельных реализаций одного Ticket-а (`arena` из pstack).
- Карта кода в контексте Subagent-а (из ponytail).

## Риски

- **Больше ложных находок.** Ambitious prompt линзы упрощения находит и лишнее. Фильтры Ticket-а 02 и
  группа Dismissed Ticket-а 01 — ответ на это.
- **Стоимость.** Каждая новая линза — ещё один reviewer на diff. Режим Ticket-а 07 стоит в 2–4 раза
  больше обычного ревью.
- **Источники быстро меняются.** У ponytail пять релизов за четыре дня. Текст не синхронизируем, а
  переписываем один раз.

## Порядок относительно worfy-windows

Открытые Ticket-ы Epic-а [worfy-windows](../worfy-windows/spec.md) (порт worfy и Harness на Windows)
правят те же файлы, что и этот Epic (по их разделам «Где в коде»):

- [03](../worfy-windows/issues/03-gate-на-node.md) (Gate на Node) — `harness/hooks/gate.sh` (удаляет),
  `harness/skills/epic-wave/SKILL.md`, `harness/skills/ship-ticket/SKILL.md`,
  `harness/agents/implementer.md`, `harness/bin/tests/agents-text.test.sh`,
  `harness/bin/tests/epic-wave-ship-ticket.test.sh`, `harness/profiles/README.md`,
  `harness/README.md`, `harness/hooks/tests/rules-hooks.test.sh`;
- [04](../worfy-windows/issues/04-hooks-harness-на-node.md) (hooks Harness на Node) —
  `harness/profiles/README.md`, `harness/README.md`, `harness/hooks/tests/rules-hooks.test.sh`;
- [07](../worfy-windows/issues/07-тексты-skills-для-двух-систем.md) (тексты skills для двух систем) —
  `harness/skills/epic-wave/SKILL.md`, `harness/skills/ship-ticket/SKILL.md`,
  `harness/bin/tests/epic-wave-ship-ticket.test.sh`, `harness/profiles/README.md`.

Вычисление Wave (`src/shared/workflow/waves.ts`) смотрит на Ticket-ы одного Epic-а. Общие файлы двух
Epic-ов оно не видит. Поэтому Wave этого Epic-а и Wave worfy-windows с общими файлами не идут
параллельно. Правило: тот Ticket, который вливается в main вторым, делает rebase на main и заново
прогоняет свои test-ы текстов (`agents-text.test.sh`, `epic-wave-ship-ticket.test.sh`,
`rules-hooks.test.sh` — те, что есть в его «Где в коде»). Про Gate — отдельное правило в Ticket-е 03,
раздел «Риски».

## Волны

Wave — Ticket-ы, которые можно брать параллельно: все блокеры закрыты, общих файлов в «Где в коде»
нет. Таблица — план. Wave, которую берут в работу, вычисляется заново в момент запуска (CONTEXT.md,
термин Wave). Заголовок раздела и шапка таблицы остаются русскими: это формат, который читает skill
`epic-wave`.

| Тикет | Файлы из «Где в коде» | Волна |
| --- | --- | --- |
| 01 | `harness/agents/reviewer.md`, `harness/skills/ship-ticket/SKILL.md`, `harness/skills/epic-wave/SKILL.md`, `harness/bin/tests/agents-text.test.sh`, `harness/bin/tests/epic-wave-ship-ticket.test.sh` | 1 |
| 02 | `harness/agents/reviewer.md`, `harness/profiles/README.md`, `harness/bin/tests/agents-text.test.sh`, `harness/evals/reviewer-simplification/` | 2 |
| 03 | `harness/hooks/gate.sh`, `harness/hooks/tests/gate-file-size.test.sh` | 1 |
| 04 | `harness/agents/implementer.md`, `harness/skills/ship-ticket/SKILL.md`, `harness/bin/tests/agents-text.test.sh`, `harness/bin/tests/epic-wave-ship-ticket.test.sh`, `harness/bin/shortcut-ledger`, `harness/bin/tests/shortcut-ledger.test.sh` | 3 |
| 05 | `src/main/index.ts`, `src/main/diagnostics/process-gone.ts`, `test/unit/process-gone.test.ts`, `scripts/hang-sample.mjs`, `README.md` | 1 |
| 06 | `harness/bin/decision-log`, `harness/bin/tests/decision-log.test.sh`, `harness/skills/epic-wave/SKILL.md`, `harness/hooks/rules/orchestrator.md`, `harness/hooks/tests/rules-hooks.test.sh` | 2 |
| 07 | `harness/skills/max-review/SKILL.md`, `harness/skills/epic-wave/SKILL.md`, `harness/README.md`, `harness/bin/tests/max-review.test.sh` | 3 |

Правило плана. Ticket стоит в первой Wave, где закрыты все его блокеры (`Blocked by`). Если у двух
Ticket-ов одной Wave общий файл, Ticket с большим номером уходит в следующую Wave.

- **Wave 1 — 01, 03 и 05.** Блокеров нет. Общих файлов нет: 01 — тексты reviewer-а и двух skills,
  03 — `gate.sh`, 05 — код worfy и скрипт для Stable copy.
- **Wave 2 — 02 и 06.** 02 ждёт 01: общий `harness/agents/reviewer.md`. 06 блокеров не имеет, но делит
  с 01 `harness/skills/epic-wave/SKILL.md` и поэтому сдвинут из Wave 1. Между собой 02 и 06 файлов не
  делят.
- **Wave 3 — 04 и 07.** 04 ждёт 02: фильтр линзы упрощения ссылается на `shortcut:`. 07 ждёт 01 и 02.
  Общих файлов нет: 04 — `implementer.md` и `ship-ticket`, 07 — новый skill и `epic-wave`.

Пересечения проверены правилом `filesOverlap` (`src/shared/workflow/waves.ts:145`): папка с `/` на конце
пересекается с каждым файлом в ней. Внутри каждой Wave плана общих файлов нет, каждый блокер — в Wave
раньше.
