# 09: Health: Harness на версии Claude Code

Type: task
Status: open
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
- [ ] Провал — toast и красная строка с именем case-а и Copy details; «не смог запустить» отличается от «guard не
      отказал».
- [ ] Строка с новой версией Claude Code терминала даёт ссылку на changelog (Q7 (б)); платного eval-а нет (Q6 (а)).
- [ ] `engines["claude-code"]` в `plugin.json` стоит, только если spike 01 подтвердил ошибку при невыполненном
      `engines`; иначе «Итог» называет причину.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR, включая Windows verdict.
