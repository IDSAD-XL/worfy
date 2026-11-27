# 03: Footer и chip версии

Type: task
Status: done 2026-11-27T07:42Z
PR: #2315
Branch: worfy-layout/03
Blocked by: None — can start immediately
Source: [spec.md](../spec.md), «Ticket-ы», 03; «Решения по реализации» («Footer», «Chip версии и popover», «Ширина окна»); «Решения по test-ам», Seam 1 и Seam 4; «Риски»; решения владельца Q7, Q10, Q14; «Волны», Wave 1

Кто: агент.

## Что строить

- Footer нет: окно — ряд из sidebar и main area (`.w-shell`, `shell.css:3-7`). Колонка Harness в header
  (`toolbar/HarnessStatus.tsx`, `order` 500; `shell.css:456-470`) обрезается многоточием при 1100 px.
- Окно становится колонкой; `src/renderer/shell/footer/Footer.tsx` пока только с chip-ом справа.
- Колонка Harness уходит из header; `VersionChip`, `versionDot`, popover из четырёх строк; шаг Codex hooks
  открывается сам, как раньше.
- Подпись памяти в Settings; `--footer-height`; toast keep-out; в focus mode footer виден и chip работает; темы Guide
  с новым путём.

## Где в коде

- `src/renderer/shell/footer/Footer.tsx` (новый), `src/renderer/shell/footer/VersionChip.tsx` (новый),
  `src/renderer/shell/footer/version-dot.ts` (новый)
- `src/renderer/shell/AppShell.tsx` — focus mode `:118`; `src/renderer/shell/shell.css` — `.w-shell` `:3-7`, правило
  1100 px `:384-389`, колонка Harness `:456-470`
- `src/renderer/theme/tokens.css` — `--footer-height`
- `src/renderer/shell/toolbar/HarnessStatus.tsx` → `src/renderer/harness/HarnessStatus.tsx` (`opensHooksStep`
  `:462-464`)
- `src/renderer/update/UpdateChip.tsx` — `updateSignal` `:48-60`, меню chip-а `:192`
- `src/renderer/settings/GeneralSection.tsx` — подпись памяти
- `src/renderer/guide/topics/harness/topic.json`, `en.json`, `ru.json` — ссылки на старый путь
- Только читать: `src/renderer/shell/Toolbar.tsx` (glob `./toolbar/*.tsx` `:11`),
  `src/renderer/settings/PipelineSection.tsx` (`:230`), `src/renderer/toast/ToastRegion.tsx` (`data-toast-keep-out`
  `:109`), `src/renderer/settings/interface-scale.ts` (`:28-30`), `src/main/window-frame.ts`,
  `src/renderer/theme/kit/Popover.tsx`

## Решения

spec.md, раздел «Решения по реализации», «Footer» и «Chip версии и popover»; решения владельца Q7, Q10, Q14:

- Сверху ряд sidebar + main area (`.w-shell__body`), снизу `<footer className="w-footer" aria-label="Footer">` на всю
  ширину окна (Q7). Высота — `--footer-height: 28px` (`theme/tokens.css`). Слева кнопки зоны Footer, середина пустая,
  справа chip версии. Пустой footer показывает только chip версии.
- Масштаб интерфейса: footer растёт вместе с окном — решено без владельца; деление на `--interface-scale`, как у
  `--toolbar-height`, ему не нужно.
- Footer — не область перетаскивания окна (`-webkit-app-region` не ставится) и `data-toast-keep-out`: toast у правого
  края не закрывает chip.
- Windows и Linux: окно в системной рамке со своим title bar (`src/main/window-frame.ts`). Footer там тот же; правок
  title bar нет.
- Focus mode рисует свой слой в `.w-shell__main`. Footer вне этого слоя и остаётся видимым; chip версии остаётся
  рабочим. `inert` для View button-ов ставит Ticket 04; Ticket 03 отвечает только за footer и chip в focus mode.
- `HarnessStatus.tsx` больше не toolbar-item. Компонент остаётся, его рисует ещё Settings → Pipeline. Ссылки на старый
  путь в темах Guide правятся в том же PR.
- Chip — кнопка с текстом версии (`numberedVersion`). Пока идёт сборка Update — её шаг, как сейчас (`UpdateChip.tsx`),
  с многоточием и полным текстом в tooltip-е. Справа точка (Q14).
- Правило точки — чистая функция `versionDot(update, harness, migration, failure)` (решено без владельца, где Q14
  молчит):
  - красная — «Harness unavailable», Harness `not-installed` или `error`, когда кнопка есть (`canInstall`), или
    предложен «Move old Harness…»;
  - янтарная — сигнал Update приложения, как точка chip-а сейчас (`dot` из `updateSignal`, тихий Available update
    точки не даёт); или Harness `outdated` с акцентной «Update Harness»; или у строки Codex есть кнопка или «Codex:
    approve hooks»;
  - нет — иначе. «Replace Harness» (тот же semver) точки не даёт. Dev-запуск без `canInstall` точки не даёт.
- Tooltip и `aria-label` chip-а — версия и причина точки: «worfy v0.4.N — Harness needs Install».
- Popover — kit Popover, над chip-ом, Esc и клик снаружи закрывают (Q14). Строки:
  1. Приложение: версия и действия меню chip-а сейчас — Update worfy, Restart now, Restart when idle, What's new. Меню
     chip-а сливается со строкой; «Later» не нужен.
  2. Harness: строка `HarnessLine` с её кнопками — Install, Update Harness, Replace Harness, Retry, Move old Harness….
  3. Codex: строка `CodexLine` с её кнопкой — пока Harness есть у Claude Code, по правилу `codexPartOf`.
  4. Память: `AppMemory`, пока включён `memoryIndicator`. Подпись в Settings → General «Memory in the toolbar» →
     «Memory in the version popover» — решено без владельца.
- Окна согласия, MigrationForm и CodexHooksStep открываются, как сейчас. Логика `HarnessStatus` — подписки
  `harness.changed`, `harnessMigration.changed` и сам открывающийся шаг Codex hooks (`opensHooksStep`) — живёт в
  chip-е, который смонтирован всегда, а не в popover-е. Иначе шаг перестанет открываться сам (раздел «Риски»).
- Toast-ы Update не меняются (Q14). Каналы Harness и Update — `local`: в окне Linked machine chip показывает этот
  компьютер, как сейчас.
- Ширина окна (решено без владельца): правило 1100 px про колонку Harness (`shell.css:384-389`, многоточие) уходит
  вместе с колонкой. При 1100 px и уже chip — только версия (раздел «Набросок функции»).
- Риск высоты (раздел «Риски»): footer забирает 28 px у Canvas, Session view и sidebar.

## Test-ы

- Unit `test/unit/version-dot.test.ts` (новый): каждая строка правила точки, «Replace Harness» и dev-запуск без точки
  (spec.md, «Решения по test-ам», Seam 1).
- E2e `test/e2e/footer.spec.ts` (новый): footer под sidebar и main area на всю ширину; chip; popover со строками; Esc
  и клик снаружи закрывают; точка красная при «Harness not installed», янтарная при Update; Install из popover
  открывает окно согласия; focus mode — footer виден, chip работает (Seam 4).
- `codex-hooks-step.spec.ts` ловит шаг Codex hooks, который перестал открываться сам (раздел «Риски»).
- Test-ы, которые сейчас закрепляют header и rail и меняются в Ticket-ах 03 и 04 (spec не делит список между ними):
  - e2e: `toolbar`, `sidebar-rail`, `sidebar-sections`, `limits-vendors`, `limits`, `update-toolbar`,
    `focus-sidebar`, `interface-scale`, `window`, `acceptance`, `linked-acceptance`, `pipeline`, `flight-recorder`,
    `work-track`, `pr-inbox`, `message-draft`, а также `codex-hooks-step`, `first-run`, `harness-install`,
    `harness-migrate`, `launch`, `memory`, `packaged`, `settings` (они ищут `app-version`, `harness-action`,
    `harness-column` или `getByRole('banner')`);
  - unit: `toolbar-runs`, `shell`, `shell-discovery`, `sidebar-scope`, `sidebar-all-projects`, `health-rail-button`,
    `limits-meter`, `harness-status`, `update-chip`, `acceptance-view`, `pr-inbox-view`, `focus-mode`, `kit-tooltip`, а
    также `app-memory`, `settings-pipeline`, `version-number-screen`, `whats-new-view`, `kit-groups`, `session-view`.
- Без моделей и без сети: агент — `WORFY_AGENT=fake`. Update — снимок, который test шлёт в окно как
  `worfy:update.changed` (так делает `test/e2e/toolbar.spec.ts`). Harness в e2e — «not installed», как сейчас.
- Сначала падающий test: красный на старом поведении, это пишется в «Итог».
- `src/renderer/shell/` не описан в `scripts/e2e-specs.table.json`, поэтому PR запускает все spec-файлы e2e.

## Готово, когда

- [ ] Footer на всю ширину окна под sidebar и main area, 28 px при масштабе 100 %; в header нет колонки Harness.
  - evidence: review pass · PR #2315 · - - · 84bc66b1c72446696b65e1f02d9487bd01c32ea5
- [ ] Точка chip-а красная, янтарная и без точки по правилу; popover закрывается Esc и кликом снаружи; Install,
      Update Harness, Retry, Move old Harness… и Update worfy работают из popover (`footer.spec.ts`).
  - evidence: review pass · PR #2315 · - - · 84bc66b1c72446696b65e1f02d9487bd01c32ea5
- [ ] Test-ы header, которые искали версию и Harness, ищут их в footer.
  - evidence: commit pass · worfy-layout/03: footer across the window with the version chip, its dot and popover · - - · 20f738e3db7d4e7c59f2c432419d1c83e1e6ad69
  - evidence: review pass · PR #2315 · - - · 84bc66b1c72446696b65e1f02d9487bd01c32ea5
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 · mac - · 20f738e3db7d4e7c59f2c432419d1c83e1e6ad69
  - evidence: gate pass · `gate fast` exit 0 · mac - · 20f738e3db7d4e7c59f2c432419d1c83e1e6ad69
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 · mac - · f8556b1dcc8cba48ebcb83e58724b2c3ae43a139
  - evidence: gate pass · `gate fast` exit 0 · mac - · f8556b1dcc8cba48ebcb83e58724b2c3ae43a139
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 · mac - · 5504d4100d8922ff50004971a154f67a8b092a3d
  - evidence: gate pass · `gate fast` exit 0 · mac - · 5504d4100d8922ff50004971a154f67a8b092a3d
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/45957417595/job/140375166140 · ci - · 84bc66b1c72446696b65e1f02d9487bd01c32ea5

## Итог

Код — ветка `worfy-layout/03`, PR #2315. Как устроено и почему — Code story
[03-footer-и-chip-версии.md](../stories/03-footer-и-chip-версии.md).

**Повторный раунд 1 (после REJECTED ревью PR #2315).**
- Четыре сообщения, которые отправляли к удалённому пункту Harness в toolbar-е, теперь называют chip версии в
  footer-е: Settings → Plan, Code stories в Project settings, Eco mode («Update it from the version chip in the
  footer.») и строки формы переноса старого Harness о плагине «not installed» и «outdated».
- `docs/features/autopilot.md`: «Codex: approve hooks» — на строке Codex в popover-е chip-а версии.
- Новый test: пока идёт install (`busy`) при Harness «not installed», у chip-а нет точки
  (`test/unit/update-chip.test.tsx`).
- Комментарии в коде, называвшие пункт Harness в toolbar-е, переписаны.
- Сначала красный: шесть мутантов (старый текст каждого сообщения, правило точки без `busy`) — каждый валит свой test,
  exit 1.
