# 13 — Modes с Linked machine: Full access меняет, Read only видит

Type: task
Status: claimed 2026-11-05T20:00Z
Blocked by: 12, 02
Source: [spec.md](../spec.md), «Решения владельца 2026-11-05», Q15–Q18; [ADR-0066](../../../docs/adr/0066-read-only-access-for-a-linked-machine.md) (уровни доступа Linked machine); [ADR-0052](../../../docs/adr/0052-machines-and-linking.md), п. 5–6

## Что происходит

- После Ticket-ов 12 и 02 у Orchestrator-а меню Modes с тремя пунктами: Eco mode, Auto-approval, Auto-continue. В окне
  Linked machine все три недоступны при любом уровне доступа и ничего не читают: сегодня так у Eco mode и
  Auto-approval (`elsewhere`, `src/renderer/session/composer/EcoMode.tsx:52`, `AutoApprove.tsx:85`; Ticket 12 переносит
  это правило в меню, Ticket 02 — в пункт Auto-continue).
- Причина — пометка каналов. `ecoMode.read` и `ecoMode.set` (`src/shared/ipc/eco-mode.ts:29`, `:54`),
  `autoApproval.read` и `autoApproval.set` (`src/shared/ipc/auto-approve.ts:30`, `:33`) помечены `local`: такой канал
  никогда не открыт Linked machine (`src/shared/ipc/channels.ts:30-31`), из окна Linked machine он ушёл бы в main этой
  Machine, где Project-а нет. Каналы `autoContinue.*` Ticket 02 создаёт тоже `local`.
- Как окно Linked machine уже пишет в Project той Machine: маршрут выбирает пометка канала — `project` и `desktop` идут
  на Machine окна (`routeOf`, `src/renderer/ipc.ts:60-63`) через `linked.invoke` этой Machine (`machineBridge`,
  `src/renderer/ipc.ts:123-134`; handler — `src/main/ipc/linked.ts:251-261`; `RemoteCalls.call`,
  `src/main/link/remote-calls.ts:153`). Так идут ввод Session (`agent.send`, `src/shared/ipc/agent.ts:61-69`, вызов —
  `src/renderer/session/SessionView.tsx:227`), смена модели в pickers (`agent.configure`, `agent.ts:93`, вызов —
  `src/renderer/session/composer/Pickers.tsx:401`) и Binding (`bindings.set`, `src/shared/ipc/bindings.ts:47`): все
  `project`, `write`.
- Read only: Machine Project-а отказывает каналу `write` до разбора входа, handler не запускается
  (`LinkIpcAdapter.call`, `src/main/link/ipc-adapter.ts:241-244`, текст — `readOnlyRefusal`, `:61`). Окно заранее
  гасит запись: `useReadOnly` (`src/renderer/projects/useProjects.ts:263-270`) для кнопок, `readOnlyNow`
  (`useProjects.ts:273-276`) для кода, который шлёт (пример — `src/renderer/binding/store.ts:85-86`).
- Рассылка: `toEveryWindow` доходит и до клиентов без окна (`src/main/broadcast.ts:29-31`), клиент `project`
  соединения — один из них (`src/main/link/ipc-adapter.ts:23-24`); клиент Read only пересылает только события `read`
  (`ipc-adapter.ts:109`). Смена настроек Machine рассылается как `appSettings.changed`
  (`src/main/ipc/app-settings.ts:11`), но этот канал `local` (`src/shared/ipc/app-settings.ts:18`) и на Linked machine
  не уходит. У `ecoMode.*` и `autoApproval.*` своего события нет.

## Что делаем (решения владельца Q15–Q18)

1. **Пометки каналов.** `ecoMode.read`, `autoApproval.read`, `autoContinue.read` → `project`, `read`;
   `ecoMode.set`, `autoApproval.set`, `autoContinue.set` → `project`, `write`. Запись идёт на Machine Project-а:
   Eco mode — в Profile через `bin/profile-set` той Machine (`src/main/ipc/eco-mode.ts:79` проверяет, что путь — Project
   той Machine), Auto-approval и Auto-continue — в `app-settings.json` той Machine. Списки
   `test/unit/link-access.test.ts` (`READ_CALLS` — `:174`, `WRITE_CALLS` — `:252`) получают новые имена.
2. **События смены** `ecoMode.changed`, `autoApproval.changed`, `autoContinue.changed` — `project`, `read`; main
   Machine Project-а шлёт их всем клиентам после каждой удачной записи, с какой бы Machine она ни пришла. Открытое меню
   на обеих Machine обновляется сразу (Q18). Смена Profile мимо worfy (командой Harness) события не даёт: её покажет
   следующее чтение или `conflict` при записи, как сегодня.
3. **Меню в окне Linked machine.** Правило `elsewhere` уходит: меню читает три состояния через `project`-каналы.
   Full access — пункты меняют (Q15). Read only — меню открывается, три состояния видны, каждый пункт
   `aria-disabled` с подсказкой `useReadOnly`; запись не уходит (`readOnlyNow`) (Q17). Off — Project-ов этой
   Machine окно не показывает (ADR-0066, п. 1).
4. **Debugging port на вызывающей Machine.** Сегодня Shadow и On не принимаются, пока worfy своей Machine запущен с
   debugging port или inspector-ом: окно тогда может вести любой локальный процесс (`src/main/ipc/auto-approve.ts:7-11`,
   `:45-46`). Через link та же дыра открывается с другой стороны: Machine Project-а не знает, что окно вызывающей
   Machine ведёт скрипт. Решение без владельца: `linked.invoke` вызывающей Machine (`src/main/ipc/linked.ts:251-261`)
   отказывает `autoApproval.set` с Shadow или On, пока её собственный `debugAccess()` (`src/main/settings/store.ts:427`)
   не пуст, тем же текстом; Off проходит. Пункт показывает причину, как `blockedTitle` сегодня.
5. **Страницы Feature**: раздел «On a Linked machine» (`docs/features/sessions.md:196-197`,
   `docs/features/ru/sessions.md:143`) — Full access меняет все три режима, Read only видит.

## Риски и их test-ы

1. **Link оборвался посреди записи.** Ответ не пришёл за `CALL_TIMEOUT_MS` (30 с, `src/main/link/connection.ts:13`,
   `:123-137`) или соединение закрылось: окно получает «did not answer in time» / «is unreachable»
   (`remote-calls.ts:167-168`), а запись на той Machine могла пройти. Пункт показывает toast с причиной
   (`readableReason`, `src/renderer/ipc.ts:222-224`) и читает состояние заново; не прочиталось — пункт недоступен с
   причиной, догадку не показывает. Вернулась связь — окно Linked machine загружается заново
   (`remote-calls.ts:19-21`) и читает всё. Contract test: запись дошла, ответ потерян → после переподключения меню
   показывает записанное; запись не дошла → прежнее.
2. **Уровень доступа сменили посреди записи.** Начатый вызов доходит, следующий проверяется по новому уровню
   (`ipc-adapter.ts:25-28`, ADR-0066, п. 5; образец — `test/contract/link-access.test.ts:591`). Contract test: Full
   access → запись начата → уровень Read only → запись завершилась, следующая получает `readOnlyRefusal`, меню
   переходит в Read only без перезагрузки окна (`useReadOnly` следит за уровнем).
3. **Обе Machine пишут одновременно.** Eco mode: запись несёт `--expect` с fingerprint-ом, вторая получает `conflict`
   (`src/main/ipc/eco-mode.ts:97`, `:100`) и toast `ECO_MODE_CHANGED` — ничего не затёрто молча. Auto-approval и
   Auto-continue: побеждает последняя запись на Machine Project-а; событие смены приводит оба меню к ней.
   Contract test: две записи с двух сторон → итог одинаков на обеих Machine, у Eco mode вторая — `conflict`.
4. **Read only пишет мимо окна.** Запись `set` от Machine с Read only отказана в `ipc-adapter.ts:241-244`, handler не
   запускается, файл и Profile не меняются. Contract test на каждый из трёх `set`.
5. **Debugging port на вызывающей Machine** (п. 4). Contract test: у вызывающей Machine `debugAccess()` не пуст →
   `autoApproval.set` On отказан, Off прошёл; на Machine Project-а режим не изменился.

## Готово, когда

- [ ] Full access: каждый из трёх пунктов меняется из окна Linked machine; запись — на Machine Project-а (Profile или
      `app-settings.json` той Machine), на вызывающей Machine ничего не записано.
  - evidence: test-run pass · `pnpm test` exit 0 (test/contract/modes-linked.test.ts full access, test/unit/modes-menu.test.tsx) · mac - · 06aff8e25a8b2f2f7bc6b25498783f4f29c30912
  - evidence: test-run pass · `pnpm test:e2e test/e2e/linked-modes.spec.ts` exit 0 · mac dev · 486677b1b4d134edcb1c30c9c0f329e8a7d02a37
  - evidence: test-run pass · `pnpm test:e2e test/e2e/linked-modes.spec.ts` exit 0 · mac dev · bd82c0c23
- [ ] Read only: меню открывается, три состояния видны, пункты недоступны с подсказкой Read only; запись отказана и
      на стороне Machine Project-а.
  - evidence: test-run pass · `pnpm test` exit 0 (test/contract/modes-linked.test.ts read-only, auto-approve-setting, auto-continue-setting) · mac - · 06aff8e25a8b2f2f7bc6b25498783f4f29c30912
  - evidence: test-run pass · `pnpm test:e2e test/e2e/linked-modes.spec.ts` exit 0 · mac dev · 486677b1b4d134edcb1c30c9c0f329e8a7d02a37
  - evidence: test-run pass · `pnpm test:e2e test/e2e/linked-modes.spec.ts` exit 0 · mac dev · bd82c0c23
- [ ] Смена на одной Machine видна в открытом меню другой без перезагрузки (Q18).
  - evidence: test-run pass · `pnpm test` exit 0 (test/contract/modes-linked.test.ts Q18 both ways) · mac - · 06aff8e25a8b2f2f7bc6b25498783f4f29c30912
  - evidence: test-run pass · `pnpm test:e2e test/e2e/linked-modes.spec.ts` exit 0 · mac dev · 486677b1b4d134edcb1c30c9c0f329e8a7d02a37
  - evidence: test-run pass · `pnpm test:e2e test/e2e/linked-modes.spec.ts` exit 0 · mac dev · bd82c0c23
- [ ] Пять contract test-ов из «Риски» зелёные.
  - evidence: test-run pass · `pnpm test` exit 0 (test/contract/modes-linked.test.ts risks 1-5) · mac - · 06aff8e25a8b2f2f7bc6b25498783f4f29c30912
  - evidence: test-run pass · `pnpm vitest run test/contract/modes-linked.test.ts` exit 0 (13 tests, debugging port on the Project Machine) · mac - · 87d54e9f2548e057a5bf24240db8ee9e6814faae
- [ ] Списки `test/unit/link-access.test.ts` обновлены.
  - evidence: test-run pass · `pnpm test` exit 0 (test/unit/link-access.test.ts) · mac - · 06aff8e25a8b2f2f7bc6b25498783f4f29c30912
- [ ] Страницы Feature EN и RU, раздел Linked machine.
  - evidence: commit pass · Modes from a Linked machine: full access changes all three modes, read-only access sees them · - - · aaa6d8a29
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 · mac - · 06aff8e25a8b2f2f7bc6b25498783f4f29c30912
  - evidence: gate pass · `gate fast` exit 0 · mac - · 4bb48b4822db5ed345838ad3e944f5e644bc139a
  - evidence: gate pass · `gate fast` exit 0 · mac - · 87d54e9f2548e057a5bf24240db8ee9e6814faae

## Тесты

- Contract `test/contract/modes-linked.test.ts` (новый) на двух Machine link bench (`test/contract/link-bench.ts`,
  как `test/contract/link-access.test.ts`): Full access пишет три режима; Read only — отказ; рассылка смены (Q18);
  риски 1–5.
- Unit `test/unit/modes-menu.test.tsx`: окно Linked machine с Full access — пункты доступны, вызовы идут через
  `linked.invoke`; Read only — пункты недоступны с подсказкой, вызова записи нет.
- Unit `test/unit/link-access.test.ts`: новые каналы в списках `read` и `write`.
- Сначала падающий: contract — `autoApproval.read` с Linked machine отказан «not open to Linked machines».

## Где в коде

- `src/shared/ipc/eco-mode.ts`, `src/shared/ipc/auto-approve.ts`, `src/shared/ipc/auto-continue.ts`
- `src/main/ipc/eco-mode.ts`, `src/main/ipc/auto-approve.ts`, `src/main/ipc/auto-continue.ts`, `src/main/ipc/linked.ts`
- `src/renderer/session/composer/Modes.tsx`, `src/renderer/session/modes/eco-mode.ts`,
  `src/renderer/session/modes/auto-approval.ts`, `src/renderer/session/modes/auto-continue.ts`
- `test/contract/modes-linked.test.ts` (новый), `test/unit/modes-menu.test.tsx`, `test/unit/link-access.test.ts`
- `docs/features/sessions.md`, `docs/features/ru/sessions.md`

Только читать: `src/renderer/ipc.ts`, `src/main/link/ipc-adapter.ts`, `src/main/link/remote-calls.ts`,
`src/main/link/connection.ts`, `src/main/broadcast.ts`, `src/renderer/projects/useProjects.ts`,
`test/contract/link-bench.ts`, `test/contract/link-access.test.ts`.

## Итог

Каналы трёх режимов стали `project`: `ecoMode.read`, `autoApproval.read`, `autoContinue.read` — `read`;
`ecoMode.set`, `autoApproval.set`, `autoContinue.set` — `write` (`src/shared/ipc/eco-mode.ts`, `auto-approve.ts`,
`auto-continue.ts`). Окно Linked machine само шлёт их на Machine Project-а через `linked.invoke` (маршрут по пометке,
`src/renderer/ipc.ts`), так что запись идёт в Profile и `app-settings.json` той Machine; Read only отказан в
`LinkIpcAdapter.call` до handler-а. Новые события `ecoMode.changed` (с fingerprint-ом после записи) и
`autoApproval.changed` — `project`, `read`, как и `autoContinue.changed`; main Machine Project-а шлёт их всем клиентам
после удачной записи (`src/main/ipc/eco-mode.ts`, `auto-approve.ts`, `auto-continue.ts`), hook-и меню
(`src/renderer/session/modes/*.ts`) подписаны на них. Правило `elsewhere` и тексты `*_ELSEWHERE` убраны: окно Linked
machine читает три режима всегда; с Read only пункты недоступны с подсказкой `useReadOnly`, а клик проверяет ещё и
`readOnlyNow()`. Запись без ответа (link оборвался) — toast с причиной, состояние сбрасывается до нового чтения, догадка
не показывается; чтение не удалось — пункт недоступен с причиной.

Debugging port (ADR-0005): Machine Project-а по-прежнему отказывает в Shadow и On при своём debugging port. Вызывающая
Machine при своём debugging port или inspector-е пропускает через `linked.invoke` только `autoApproval.set` с Off (вход,
который она не может разобрать, тоже отказан), тем же текстом (`autoApprovalDebugRefusal`, `src/main/ipc/linked.ts`);
Eco mode и Auto-continue идут, как и без link. Окно узнаёт причину по новому `local` каналу `autoApproval.blockedHere` и
показывает её в tooltip-е группы Auto-approval (`blockedHereTitle`). ADR 0005 получил строку Amendments 2026-11-05.

Test-ы: contract `test/contract/modes-linked.test.ts` (две Machine на link bench, настоящий `bin/profile-set`, настоящий
`linked.invoke` и RemoteCalls вызывающей Machine: Full access, Read only, рассылка Q18, риски 1–5); unit
`test/unit/modes-menu.test.tsx` (новый блок окна Linked machine), `test/unit/link-access.test.ts` (списки);
`test/contract/auto-approve-setting.test.ts` и `auto-continue-setting.test.ts` — старые проверки `local` заменены
новыми пометками. e2e `test/e2e/linked-modes.spec.ts` на двух собранных worfy: Full access меняет Eco mode и
Auto-continue на B, смена в окне B видна в открытом меню A, Read only — состояния видны, пункты недоступны, ничего не
записано; spec внесён в правило link таблицы `scripts/e2e-specs.table.json`. Mutation testing: 26 мутаций изменённых
строк (пометки каналов, проверка debugging port в `linked.invoke`, события, `readOnlyNow` и подсказка Read only в трёх
hook-ах, сброс догадки) — все убиты.

`pnpm lint && pnpm typecheck && pnpm test` на 06aff8e25 — exit 0. Gate fast — exit 2 дважды: lint и typecheck
зелёные, шаг test красный на test-ах, которых ветка не касается, и каждый раз на других:
`test/contract/codex-parity.test.ts` (Stop hook фейкового Codex увидел красный gate), затем
`test/contract/harness-scripts-4.test.ts` (`wave-gate-heartbeat.test.sh`: 1285 ms при лимите 1200) и
`test/contract/terminal-ai-zle.test.ts`. Отдельно все три зелёные (exit 0). Оба красных запуска шли, пока на Mac
работали чужие gate; на 4bb48b482, без чужих gate, gate fast — exit 0, `[gate] green`. e2e
`test/e2e/linked-modes.spec.ts` после rebase — exit 0 на 486677b1b.

Снимки меню (fixture build, `captureScreenshot`, светлая и тёмная тема, Full access и Read only) не закоммичены: на
них только текст меню, без имён Machine, хостов и путей (проверил агент), но правило Evidence требует проверки
человеком.

Раунд 2 после ревью high (#1458, два reviewer-а, high и medium нет). Исправлены 6 low:
- исправлены ложные комментарии в `src/main/ipc/linked.ts` (что он загружает Electron) и в
  `src/main/settings/store.ts` (что домен `autoApproval` — `local`);
- добавлен unit test: если `autoApproval.blockedHere` вернул ошибку, группа остаётся доступной, а выбор уходит через
  link, где `linked.invoke` проверяет debugging port сам;
- добавлен contract test debugging port на Machine Project-а: Shadow и On из Linked machine отказаны, Off в силе,
  Off и Auto-continue проходят;
- e2e: «ничего не записано» проверяется после того, как запись из окна B в другой файл дошла (`expect.poll`), а не
  сразу после принудительных кликов;
- риск 1: contract test-ы держат сторону link (ответ «unreachable» и что лежит на B). Сторону меню — без догадки, toast,
  повторное чтение — держат unit test-ы `test/unit/modes-menu.test.tsx` («a write through the link without an answer»
  и два после него); названия contract test-ов сужены до этого.

Mutation testing раунда: мутация R9 (ошибка `blockedHere` блокирует группу), отказ debugging port Machine Project-а
в `set` и в `read` — все три убиты.

### Решено без владельца

- **Причина debugging port в окне Linked machine — отдельный `local` канал** `autoApproval.blockedHere`, а не правка
  ответа `autoApproval.read`: `blocked` в ответе — это debugging port Machine Project-а, при котором режим там Off; порт
  вызывающей Machine режим на Machine Project-а не меняет, поэтому группа показывает режим как есть и недоступна с
  причиной.
- **При debugging port вызывающей Machine недоступна вся группа Auto-approval**, как и сегодня при своём порту, хотя
  `linked.invoke` пропустил бы Off: выбор Off оттуда — только через окно Machine Project-а.
- **Снимки не закоммичены**: их пиксели не проверял человек (правило Evidence, шаг 6 skill-а ship-ticket).
