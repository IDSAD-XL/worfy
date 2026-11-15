# 18 — `eslint-plugin-jsx-a11y` в `pnpm lint`; axe в e2e главных экранов

Type: task
Status: claimed 2026-11-14T23:35Z
PR: #1879
Branch: worfy-ui-kit/18
Blocked by: 05, 06, 07, 08, 10, 12, 13, 14
Source: [spec.md](../spec.md), «Ticket-ы», строка 18; «Решения по реализации» (доступность под присмотром); «Решения по
test-ам» (axe); история 29; заметка темы `docs/product/ui-overhaul/notes/inventory-foundation.md`, раздел 7

## Что происходит

Tooling доступности нет: в `package.json` нет `eslint-plugin-jsx-a11y` и axe, в `eslint.config.js` подключены только
`@eslint/js`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`, `typescript-eslint` и своё правило
`noCyrillic`. Кнопка без имени или окно без роли сегодня проходят lint и test-ы.

## Что делаем

1. `eslint-plugin-jsx-a11y` точной версией в `devDependencies`; в `eslint.config.js` — те правила, которые код
   проходит после Ticket-ов 05–14. Правило, которое код не проходит, не включается; Ticket записывает в «Итог»,
   какие правила оставлены и почему.
2. axe (`@axe-core/playwright` или то, что выберет Ticket, по правилам зависимостей ADR Ticket-а 03): helper
   `test/e2e/axe.ts` и spec `test/e2e/a11y.spec.ts` — Canvas, Session, Settings, Command palette, Guide без нарушений
   уровней critical и serious.
3. Найденные нарушения в коде renderer-а исправляются в этом Ticket-е, если правка мелкая; крупное — отдельный Ticket
   с находкой в «Итог».

## Готово, когда

- [ ] `pnpm lint` с `eslint-plugin-jsx-a11y` — exit 0; mutant (кнопка-иконка без `aria-label`) роняет lint.
  - evidence: test-run pass · `pnpm lint` exit 0; mutant `pnpm test test/unit/a11y-lint.test.ts` exit 0 · mac - · 84352b5bad327dd473b91030dec139787c4762fd
- [ ] E2e `test/e2e/a11y.spec.ts` зелёный на macOS и Windows runner-е; mutant (dialog без имени) роняет его.
- [ ] axe в `a11y.spec.ts` проверяет и два места, которые остаются на своей вёрстке, а не на kit (решение владельца 2026-11-12, Q3): окно запроса команды Terminal AI и карточку Mind map.
- [ ] В «Итог» — включённые правила и оставленные вне lint с причиной.
  - evidence: commit pass · jsx-a11y in pnpm lint and axe on the main screens (worfy-ui-kit 18) · - - · 84352b5bad327dd473b91030dec139787c4762fd
- [ ] lint, typecheck, test-ы модуля и gate fast — exit 0; e2e test бюджета старта зелёный.
  - evidence: test-run pass · `pnpm lint && pnpm typecheck` exit 0 · mac - · 84352b5bad327dd473b91030dec139787c4762fd

## Где в коде

- `package.json`
- `pnpm-lock.yaml`
- `eslint.config.js`
- `test/e2e/axe.ts` (новый)
- `test/e2e/a11y.spec.ts` (новый)

Правки в `src/renderer/` по находкам lint и axe — заранее неизвестные файлы; Ticket называет их в PR.

## Итог

**Зависимости** (`devDependencies`, точные версии, `minimumReleaseAge` проходят, исключений нет):
`eslint-plugin-jsx-a11y` 6.10.2 (2024-10-26, MIT) и
`@axe-core/playwright` 4.14.0 (2026-10-15, MPL-2.0) с `axe-core` 4.14.0 (MPL-2.0); вместе +84 пакета в lockfile. Последний выпуск
`eslint-plugin-jsx-a11y` объявляет peer `eslint` до 9, у нас 10.12.0: `pnpm peers check` называет это, правила
работают (lint exit 0, unit test `test/unit/a11y-lint.test.ts`).

**Включено в `pnpm lint`** (`eslint.config.js`, только `src/renderer/**/*.tsx`):
- весь набор `recommended` плагина;
- `control-has-associated-label` с опциями набора `strict` плагина (поля `input`/`textarea` оставлены правилу
  `label-has-associated-control`) — оно ловит кнопку-иконку без имени: mutant (у кнопки закрытия toast-а убран
  `aria-label`) роняет lint на `ToastRegion.tsx:93`;
- `label-has-associated-control` с `depth: 3`: у radio-карточек `ConnectProject` и `GithubAccount` текст лежит в
  `label > span > span`, по умолчанию правило смотрит на два уровня;
- `anchor-ambiguous-text` и `lang` — код их уже проходит.

**Оставлены вне lint:**
- `prefer-tag-over-role` — 98 мест: свои виджеты и kit ставят роль на `div`/`span` намеренно (listbox, option,
  group, region); замена тегами — переделка вёрстки, не этот Ticket.
- `no-aria-hidden-on-focusable` — одно ложное срабатывание: `<canvas aria-hidden>` внутри кнопки `BrowserNode`,
  canvas фокус не берёт.
- `label-has-for`, `no-onchange`, `accessible-emoji` — плагин сам называет их устаревшими.
- `control-has-associated-label` с опциями по умолчанию — 23 места, все поля ввода с `aria-label` или `label`,
  которых правило не видит; отсюда опции `strict`.

**Отключения по строке** (25 комментариев в 20 файлах, у каждого причина после `--`): контейнеры, которые ловят
всплывающие клавиши (Esc, стрелки) от фокусируемых детей; listbox с `aria-activedescendant` (`theme/Select.tsx`,
`session/SlashMenu.tsx`); separator-ползунок `SplitDivider` (паттерн window splitter WAI-ARIA); прокручиваемые
области с `tabIndex={0}` (`ReviewExample`, `ShortcutsOverlay`); backdrop Dialog kit; `autoFocus` поля нового тега;
`alt="Image"` (это вид Node); `aria-description` (ARIA 1.3) у вкладок Sidebar; ссылка `href="#"` на Session-источник
в `ExternalSessionPanel` (переход внутри приложения без URL; unit test `session-back` ищет её по роли link).

**Находка для отдельного Ticket-а:** в Run history (`flight-recorder/Timeline.tsx`: строки и полосы) и в Work track
(`work-track/WorkTrackView.tsx`, полосы `Lanes.tsx`) span выбирается только мышью, пути с клавиатуры нет. Правка —
фокусируемые строки с навигацией стрелками, не мелкая; здесь — отключение по строке со ссылкой на эту находку.

**axe:** helper `test/e2e/axe.ts` гоняет все правила axe по умолчанию и роняет экран на нарушениях impact
critical и serious (soft-проверка: один прогон перечисляет нарушения всех экранов; меньшие пишутся в вывод).
Legacy mode — axe идёт в самой странице: обычный режим доделывает прогон в новой пустой странице, которой у
Electron нет. `test/e2e/a11y.spec.ts`: Canvas, Command palette, Settings, Guide, Session view; Mind map Product
Session с открытой карточкой узла; панель Command request Terminal AI (только она, на Windows пропуск — нет zsh,
как у остальных test-ов Terminal AI). Проверка самого helper-а: окно `role="dialog"` без имени на Canvas даёт
`aria-dialog-name serious`.

**Исправлено по находкам axe** (первый прогон CI, Windows, светлая тема):
- color-contrast: версия приложения и память worfy в toolbar — `--text-muted` с `opacity: 0.8` давал 3.52:1 на
  `--surface-raised`; opacity убрана, цвет тот же token (`shell.css`, `memory/AppMemory.tsx`). Правка вида: эти две
  подписи чуть темнее (светлая тема) или светлее (тёмная).
- label-content-name-mismatch: кнопка Command palette в toolbar — имя теперь содержит и shortcut («Search or run… ⌘K»,
  на Windows «Ctrl+K»), который виден на кнопке; кнопка Effort — пробел между «Effort» и уровнем (кнопка — flex,
  пробел не рисуется; `textContent` стал «Effort high» вместо «Efforthigh», test-ы поправлены); блоки сцены Guide —
  пробел между заголовком и заметкой и между строками заметки (вне `<text>`, не рисуется).
- label (critical): checkbox-ы task list в markdown (`markdown/Markdown.tsx`) получили имя — слова своего пункта без
  вложенных списков.
- Mind map (второй прогон): метка свёртки ветки внутри узла была `<button tabIndex={-1}>` внутри узла с
  `role="button"` (nested-interactive) — стала `<span role="button">` без фокуса: клавиши свёртки — ← и → на самом
  узле, как и были; роль, имя и `data-testid` прежние. Ссылка карточки без цитаты читает своё имя целиком («Show
  the message in the chat» вместо «Show in the chat»; правка вида). Кнопка Agents в полосе Product Session называет
  своё число: «Agents (2)».
- Осталось вне этого Ticket-а: у той же ссылки с цитатой («#5 Advisor») видимый текст не входит в имя; в e2e его
  нет (в фикстуре чата нет сообщения), а правка меняет имя, по которому ищут unit test-ы `node-chips` и
  `mind-map-view`.
