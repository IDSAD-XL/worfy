# 09: Health: Harness на версии Claude Code

Type: task
Status: claimed 2026-11-28T17:26Z
Branch: worfy-harness-guarantees/09
Blocked by: 08
Source: [spec.md](../spec.md), «Ticket-ы», 09; «Решение», 4; «Набросок функции» (шаг 7, экран Settings → Health);
«Решения по реализации» («Health: Harness на версии Claude Code»); «Решения по test-ам», Seams (e2e — строка Health и
toast); «Вопросы владельцу», Q6 (а) и Q7 (б); «Волны», Wave 3

Кто: агент. Глубина ревью — `medium`.

Платформенный PR (ADR-0056, пункт 2): запуск binary Claude Code терминала и кэш в данных worfy на macOS и Windows; до
merge нужен Windows verdict.

## Что происходит

- Claude Code в терминале обновляется сам; Health только предупреждает, если он старше копии worfy (check
  `claude-version`, `src/main/first-run/checks.ts:230`, `claudeVersion` `:347`). Harness в терминале работает на любой
  версии, и worfy не знает, держатся ли там hooks.
- Contract set без модели (Ticket 08) идёт в `pnpm test` на binary SDK, но не на Claude Code терминала.

## Что строить

- Check `harness-claude` (имя — предложение) рядом с `claude-version` и `harness` (`checks.ts:230`, `:243`, запуск —
  `:1032`); строка в Settings → Health (`src/renderer/settings/HealthSection.tsx`):

  ```text
  ✓ Harness on Claude Code   2.1.322 (worfy) · 6 of 6 checks · Nov 14, 10:02
  ✗ Harness on Claude Code   2.1.330 (terminal) · the guard did not refuse "git reset --hard"
                             [Run again]  [Copy details]
  ```

- Версии: копия worfy (binary SDK) и Claude Code терминала — `claude --version`, как `claudeVersion` (`checks.ts:347`).
- Набор Ticket-а 08 идёт один раз на пару — версия Claude Code и версия Harness (`bundledHarnessVersion()`,
  `src/main/harness/bundled.ts:25`); итог кэшируется в данных worfy; есть Run again.
- Провал — toast (как у check-а Harness, `checks.ts:23-28`) и красная строка с именем case-а и Copy details. «Не смог
  запустить» и «guard не отказал» — разные тексты строки (runner Ticket-а 08 их различает).
- Q7 (б): строка с новой версией Claude Code терминала даёт ссылку на changelog Claude Code. Заметки в Workflow folder
  нет (Ticket 11 снят).
- Q6 (а): платного `pnpm eval:harness` на новой версии нет; полный eval — как сейчас, при смене SDK, модели или Stable
  copy (`harness/README.md:247-251`).
- `engines["claude-code"]` в `harness/.claude-plugin/plugin.json` (сегодня там только name, description и author) —
  нижняя версия, на которой набор прошёл. Ставится, только если spike 01 показал, что невыполненный `engines` Claude
  Code называет ошибкой, а не молча пропускает plugin. Test «has no version» (`test/contract/harness-plugin.test.ts:51-53`)
  остаётся.

## Где в коде

- `src/main/first-run/checks.ts` — список check-ов `:225-250`, `claudeVersion` `:347`, запуск check-ов `:1032`, toast
  `:23-28`
- `src/renderer/settings/HealthSection.tsx` — строка, Run again, Copy details, ссылка на changelog
- `src/main/harness/bundled.ts` — `bundledHarnessVersion()` `:25`
- `src/main/harness/contract/` (Ticket 08) — только вызов runner-а
- `harness/.claude-plugin/plugin.json` — `engines`, только по ответу spike-а 01
- `test/unit/` — check `harness-claude`: пара версий, кэш, повтор по Run again (новый файл, имя — предложение)
- `test/e2e/` — строка Health и toast (существующий spec Health или новый)

## Test-ы

- Unit: check идёт один раз на пару версий; кэш в данных worfy; новая версия терминала — новый запуск; Run again
  запускает снова; провал даёт toast и красную строку с case-ом; «не смог запустить» — свой текст.
- E2e: строка Health и toast на fake runner-е (агент — `WORFY_AGENT=fake`).
- Сначала падающий test: красный на старом поведении, это пишется в «Итог».
- Без моделей и без денег: набор на stand-in Messages API.

## Готово, когда

- [ ] Settings → Health показывает строку «Harness on Claude Code» для копии worfy и для Claude Code терминала; набор
      идёт один раз на пару версий, итог в кэше, Run again повторяет.
  - evidence: test-run pass · `pnpm test test/unit/harness-claude-health.test.ts test/unit/harness-claude-toasts.test.tsx test/unit/settings-health.test.tsx` exit 0 · mac - · 1a30deccb03e0bf11e6c78c2700e9228c7f415d5
- [ ] Провал — toast и красная строка с именем case-а и Copy details; «не смог запустить» отличается от «guard не
      отказал».
  - evidence: test-run pass · `pnpm test test/unit/harness-claude-health.test.ts test/unit/harness-claude-toasts.test.tsx test/unit/settings-health.test.tsx` exit 0 · mac - · 1a30deccb03e0bf11e6c78c2700e9228c7f415d5
- [ ] Строка с новой версией Claude Code терминала даёт ссылку на changelog (Q7 (б)); платного eval-а нет (Q6 (а)).
  - evidence: test-run pass · `pnpm test test/unit/harness-claude-health.test.ts test/unit/harness-claude-toasts.test.tsx test/unit/settings-health.test.tsx` exit 0 · mac - · 1a30deccb03e0bf11e6c78c2700e9228c7f415d5
- [ ] `engines["claude-code"]` в `plugin.json` стоит, только если spike 01 подтвердил ошибку при невыполненном
      `engines`; иначе «Итог» называет причину.
  - evidence: commit pass · worfy-harness-guarantees/09: Health runs the Harness contract set on worfy's and the terminal's Claude Code · - - · 1a30deccb03e0bf11e6c78c2700e9228c7f415d5
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR, включая Windows verdict.

## Итог

Сделано 2026-11-28 на `@anthropic-ai/claude-agent-sdk` 0.3.322 (Claude Code 2.1.322), macOS arm64. Модели, ключа и входа
нет; настоящий Codex не запускался; платного eval-а нет (Q6 (а)).

- **Две строки Health** «Harness on Claude Code» — check-и `harness-claude` (копия worfy, binary SDK или
  `WORFY_CLAUDE`) и `harness-claude-terminal` (`claude` с PATH login shell, на Windows — из окружения Session). Код —
  `src/main/first-run/harness-claude.ts`: набор Ticket-а 08 (`CONTRACT_CASES` через `runContractSet`, runner и case-ы
  не тронуты) с копией Harness этой сборки (`bundledHarnessDir()`, версия — `bundledHarnessVersion()`).
- **Один раз на пару** версии Claude Code и версии Harness; итог — `<данные worfy>/harness-claude.json` (последние 12
  пар). Новая версия терминала или Harness — новый запуск; обе копии на одной версии делят один запуск. Run again —
  новый канал `firstRun.harnessClaude`, без диалога подтверждения: он меняет только кэш worfy.
- **Тексты строки.** Всё прошло — `2.1.322 (worfy) · 6 of 6 checks · Nov 14, 10:02`. Case провалился (`failed`
  runner-а: Harness не сделал своё) — красная строка `<версия> (<копия>) · <case>: <причина>`, Run again, Copy details
  (ответ каждого case-а) и toast «The Harness failed a check on Claude Code …» с Open Health
  (`src/renderer/shell/harness-claude-toasts.ts`). Case не запустился (`not-run`) — строка «Couldn't check: … the
  checks could not run: …», статус `unknown`, без toast-а: о Harness она ничего не говорит.
- **Changelog (Q7 (б)).** Строка терминала на версии новее копии worfy даёт кнопку Changelog
  (https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md); `open-link` с полем `url` открывается через
  `shell.openExternal`.
- **plugin_warnings.** Предупреждения `plugin_warnings` из `system/init` (Claude Code 2.1.332 так сообщает
  невыполненный `engines["claude-code"]`, `type: "engine-range-exempt"`) Health теперь показывает: строка с ними —
  Warning, текст первого в подсказке, все — в Copy details. На 2.1.322 поля нет; test идёт на записанной форме, на
  настоящем 2.1.332 не проверено.
- **`engines["claude-code"]` не поставлен.** Spike 01 (пункт 5 его «Итог»): на 2.1.322 невыполненный `engines` Claude
  Code молча пропускает и грузит plugin, `plugin_errors` пуст; по наблюдению polish 175 на 2.1.332 plugin тоже грузится,
  только с `plugin_warnings`. Ошибки нет ни там, ни там — условие Ticket-а не выполнено. Test «has no version» не тронут.
- **PATH login shell.** Каждый case получает PATH (и `CLAUDE_CODE_GIT_BASH_PATH`, если он есть) login shell через
  `prepare`: `claudeEnv` берёт PATH процесса worfy, а у копии из Finder он без `node`, и hooks Harness не стартовали бы.
- **Windows.** `claude.exe` (нативная установка) запускается; `claude.cmd` npm runner без cmd.exe не стартует — строка
  терминала тогда «could not run» с версией. Кэш — в `dataRoot()` (`%APPDATA%\worfy` на Windows). Локально Windows не
  проверен: verdict — job Windows в CI.
- **Сначала падающий test.** `test/unit/harness-claude-health.test.ts` написан до кода и был красным (`Cannot find module
  '../../src/main/first-run/harness-claude'`). Test кнопок в `test/unit/settings-health.test.tsx` красный на старом
  `FirstRunChecks.tsx` (проверено подменой файла: 1 failed). Отдельно, временным test-ом (не в PR), набор через
  `contractSetRun` прошёл на binary SDK 2.1.322 с `harness/`: строка `ok`.
- **E2e** — `test/e2e/health-harness-claude.spec.ts` на fake runner-е (`WORFY_HARNESS_CONTRACT`, агент
  `WORFY_AGENT=fake`): строки, toast, кэш, Run again. Локально не запускался (локальный e2e запрещён), его гонит CI на
  macOS; на Windows spec пропускается — stand-in `claude` там `.cmd`.

Отличия от текста Ticket-а:
- Строки рисует `src/renderer/shell/FirstRunChecks.tsx` (общий для First run и Health), а не `HealthSection.tsx`:
  Run again, Copy details и Changelog — там. Ещё вне «Где в коде»: `src/shared/ipc/first-run.ts` (id, действия, канал),
  `src/shared/health/severity.ts` (уровень строк — non-critical), `src/main/ipc/first-run.ts` (связка),
  `src/renderer/main.tsx` (toast), `docs/features/onboarding.md` (строка таблицы Health).
- Строки идут вместе с сетевыми строками Health (`registerNetworkRows`): новая пара занимает секунды, и старт их не ждёт.
- Под `WORFY_AGENT=fake` без `WORFY_HARNESS_CONTRACT` строк нет: e2e других функций считают строки Health.
