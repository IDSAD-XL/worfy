# 167 — Кнопка Enable у выключенного Harness-а в строке статуса

Type: feature
Status: done 2026-11-27T13:21Z
PR: #2326
Branch: worfy-polish/167-redo
Blocked by: worfy-layout 03 (footer и chip версии: строка Harness переезжает в popover chip-а и в `src/renderer/harness/HarnessStatus.tsx`)
Source: вопрос владельца 2026-11-26 о строке статуса у знакомого: «Harness 0.4.0+08d75598c · disabled · removed
mattpocock-skills». Plugin worfy был выключен в Claude Code, а строка только говорит «disabled» и не даёт его включить.
Решение владельца 2026-11-27 (раунд вопросов, Q5): «да» — завести ticket на кнопку Enable.

## Что происходит

Когда plugin worfy установлен, но выключен в Claude Code, строка Harness в toolbar показывает
«Harness <версия> · disabled» и tooltip «The plugin worfy is disabled in Claude Code». Кнопки нет: человеку нужно
знать команду `claude plugin enable worfy@worfy-harness` или открыть `/plugin` в Claude Code.

## Что строить

- В состоянии `installed` с `enabled: false` рядом со строкой — кнопка Enable (тот же вид, что Install и Update).
- Нажатие включает plugin worfy в Claude Code тем же способом, каким это делает сам Claude Code (команда
  `claude plugin enable worfy@worfy-harness` или прямая запись в его настройки — решает исполнитель по тому, что
  надёжнее и не требует sign-in), затем перечитывает статус: строка становится «Harness <версия>».
- Ошибка включения показывается в tooltip-е и не меняет строку на «enabled».
- Кнопки нет там, где нет и Install/Update (`canInstall` false).

## Где в коде

- `src/renderer/harness/HarnessStatus.tsx` — строка `HarnessLine` в popover chip-а версии: кнопка Enable
  (`harness-enable`) рядом с Install, Update Harness, Retry; ошибка Enable — в tooltip-е текста и кнопки.
  Прежний путь `src/renderer/shell/toolbar/HarnessStatus.tsx` ушёл с worfy-layout 03.
- `src/renderer/harness/harness-lines.ts` — `harnessPart`: у `installed` с `enabled: false` кнопка Enable с accent,
  отсюда янтарная точка chip-а (`src/renderer/shell/footer/version-dot.ts`).
- `src/renderer/harness/useHarnessStatus.tsx` — `onEnable` через `harness.enable`, «Enabling Harness…», `enableFailure`.
- `src/shared/ipc/harness.ts` — channel `harness.enable` и его ответ (`status`, `error`); шаг `enable`.
- `src/main/harness/install.ts` — `HarnessInstaller.enable()`: `claude plugin enable worfy@worfy-harness --scope user`,
  затем статус заново. `src/main/ipc/harness.ts` — handler и `harness.changed` всем окнам после удачного Enable.
- Test-ы: `test/contract/harness-install.test.ts`, `test/contract/harness-changed.test.ts`,
  `test/unit/harness-status.test.tsx`, `test/unit/version-dot.test.tsx`.
- `docs/features/harness.md` — строка Disabled и абзац «Enable».

## Готово, когда

- [ ] При выключенном plugin-е строка показывает кнопку Enable; после нажатия статус перечитан и строка без
      «disabled»; ошибка включения видна в tooltip-е.
  - evidence: test-run pass · `pnpm test test/contract/harness-install.test.ts test/contract/harness-changed.test.ts test/unit/harness-status.test.tsx test/unit/version-dot.test.tsx` exit 0 · mac - · cc476fac0478366d40b7f75d6d9b8592ad8b6bd1
  - evidence: test-run pass · `pnpm test test/contract` exit 0, harness-install file 3 plain + 4 shuffled runs exit 0 · mac - · 083f742b2012e506e368ec6066e7506bf9e11d51
  - evidence: review pass · PR #2326 · - - · 3a22c9450a18a23499b808c2117ed6a5b8a64a7f
- [ ] Unit- и contract-test-ы на действие Enable и на строку; test-ы красные до правки.
  - evidence: test-run pass · `pnpm test` exit 0, 17 new tests red before the change · mac - · cc476fac0478366d40b7f75d6d9b8592ad8b6bd1
  - evidence: test-run pass · `pnpm test test/contract/harness-install.test.ts` exit 0; new install-waits-for-enable test red without the fix · mac - · 083f742b2012e506e368ec6066e7506bf9e11d51
  - evidence: review pass · PR #2326 · - - · 3a22c9450a18a23499b808c2117ed6a5b8a64a7f
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate fast зелёный; `ci-ok` зелёный на head PR.
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 · mac - · cc476fac0478366d40b7f75d6d9b8592ad8b6bd1
  - evidence: gate pass · `gate fast` exit 0 · mac - · cc476fac0478366d40b7f75d6d9b8592ad8b6bd1
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 · mac - · 083f742b2012e506e368ec6066e7506bf9e11d51
  - evidence: gate pass · `gate fast` exit 0 · mac - · 083f742b2012e506e368ec6066e7506bf9e11d51
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/45996863116/job/140529143997 · ci - · 3a22c9450a18a23499b808c2117ed6a5b8a64a7f
- [x] (вручную) Сделай: в Claude Code выключи plugin worfy (`/plugin`), в Stable worfy нажми Enable в строке
      Harness → Должно быть: строка без «disabled», в Claude Code plugin worfy снова включён.
  - needs: mac stable
  - evidence: owner-check pass · 2026-11-28: принимаем · mac stable · 660928a5946898d0c8d3488f20dd9b0b2da4ec09

## Откат 2026-11-27

PR #2317 откачен: после merge contract test `test/contract/harness-install.test.ts:1421` («enabling a disabled Harness (worfy-polish ticket 167) > during an install it waits for the install, then reads the state the install left») висел 90 s на обеих попытках в push run-ах main на macOS, Linux и Windows (run 45970580081 и 45972473732), хотя CI PR-а был зелёным. Main стоял красным больше часа (правило: fix forward 1 h, затем revert). Переделка — заново с этого Ticket-а.

### Причина зависания и переделка

Root cause — в test-е, не в коде приложения. Test ждал записи `plugin marketplace list` в журнале stub-а
(`vi.waitFor(() => expect(commands()).toEqual([LIST, MARKETPLACES]))`) и сразу отвечал «да» диалогу установки. Stub
пишет эту строку в самом начале своего запуска, а установщик зовёт диалог позже: после выхода stub-а, разбора его
ответа и плана. Если `vi.waitFor` успевал увидеть строку раньше, `agree(true)` звал пустую функцию — диалог ещё не
открылся, ответ на него не приходил никогда, и `await install` висел до timeout-а. Без нагрузки test проходил по
удаче: временный повтор старого test-а 21 раз (`repeats: 20`) локально дал зависание; проба на 41 запуск показала,
что `vi.waitFor` срабатывал раньше диалога в 35 случаях из 41.

Переделка (ветка `worfy-polish/167-redo`): cherry-pick #2317, test отвечает только после того, как установщик
действительно спросил (promise диалога), и проверяет, что к этому моменту выполнены ровно два чтения. Заодно закрыт
[low] ревью: `runInstall` ждёт идущего `enabling`, чтобы Install из другого окна не запускал `plugin install` рядом
с `plugin enable` (новый contract test, красный без правки).
