# 29 — Onboarding и вход в Codex

Type: task
Status: done 2026-11-03T11:51Z
PR: #1283
Blocked by: 21, 24
Source: [spec.md](../spec.md), «Цель и что видит пользователь», п. 9, «Решено без владельца», п. 6; решение 07 ([07-что-получает-codex.md](07-что-получает-codex.md)); [ADR-0009](../../../docs/adr/0009-claude-code-login-check-account-info.md)

## Что происходит

- Проверки первого запуска — `src/main/ipc/first-run.ts` (вход в Claude Code обязателен); панель Getting started —
  `src/renderer/getting-started/GettingStartedPanel.tsx`.
- Раздела Vendor-ов в Settings нет (`src/renderer/settings/sections.ts`).

## Что делаем

1. Settings → Vendors (`VendorsSection.tsx`): на каждого Vendor-а — вход (email, план) или кнопка входа; у Codex —
   «Sign in to Codex» (`startLogin`, Ticket 21).
2. Getting started: необязательный шаг «Use Codex too» — только если бинарник Codex есть в сборке; пропуск ничего не
   ломает. Проверка входа в Claude Code остаётся как есть.
3. Нет входа в Codex, нет бинарника, ошибка `account/read` — Codex просто недоступен в «New session» с tooltip
   (Ticket 24); всплывающих ошибок нет.
4. Канал `vendors.*`: состояние входа каждого Vendor-а и `startLogin`.
5. Снимки в обеих темах — `.scratch/worfy-multi-vendor/evidence/29/`.

## Готово, когда

- [ ] e2e (фейк `login`): Settings → Vendors → «Sign in to Codex» → вход отмечен, Codex доступен в «New session».
- [ ] e2e (фейк `signed-out` и сборка без бинарника): ни одного toast или диалога ошибки; Codex недоступен с tooltip.
- [ ] Test-ы first-run Claude проходят без правок ожиданий.
- [ ] Снимки обеих тем в `evidence/29/`.
- [ ] `pnpm typecheck`, `pnpm lint`, test-ы first-run и e2e spec — exit 0.

## Где в коде

- `src/main/ipc/first-run.ts`
- `src/renderer/getting-started/GettingStartedPanel.tsx`
- `src/renderer/settings/VendorsSection.tsx` (новый), `src/renderer/settings/sections.ts`
- `src/main/ipc/vendors.ts`, `src/shared/ipc/vendors.ts` (новые)
- `test/e2e/onboarding-codex.spec.ts` (новый), `scripts/e2e-specs.table.json`

## Итог

- Settings → Vendors (`src/renderer/settings/VendorsSection.tsx`, order 58 — между Terminal AI и Sessions): строка на
  каждого Vendor-а сборки. Claude Code помечен `required`, Codex — `optional`. Вход показан как в проверке первого
  запуска: `Signed in: <email> · <plan>`. Без входа — «Sign in to <Vendor>». У Codex кнопка запускает `startLogin`
  Ticket-а 21 в main (страницу входа открывает main), строка пишет «Finish the sign-in in your browser…» с «Cancel» и
  потом показывает аккаунт, которым вход закончился. У Claude Code ответ `startLogin` — команда `claude`: строка говорит
  запустить её в Terminal Node и даёт «Check again». Vendor не из этой сборки — «Codex is not part of this build of
  worfy.», без кнопок. `sections.ts` не менялся: раздел находит `import.meta.glob`.
- Канал `vendors.*` (`src/shared/ipc/vendors.ts`, `src/main/ipc/vendors.ts`, все `local`): `vendors.list` (Vendor-ы, есть
  ли в сборке, обязателен ли; процессов не запускает), `vendors.account`, `vendors.startLogin` (ждёт конца входа; второй
  вызов во время входа получает ответ первого), `vendors.cancelLogin`; вход, ещё идущий при выходе из worfy, отменяется.
  Handlers спрашивают ту же account-часть драйвера, что и `signInRefusal` списка «New session»: логика доступности не
  продублирована.
- «Есть ли Codex в сборке» — необязательный `inBuild()` account-части (`src/main/vendors/account.ts`), у Codex —
  `codexInBuild` (`src/main/vendors/codex/launch.ts`): фейк — да, иначе есть ли файл закреплённого бинарника.
  `WORFY_CODEX=absent` — сборка без Codex для e2e: ничего не запускается, как на платформе без пакета Codex. Это правки
  вне «Где в коде» (`account.ts`, `codex/account.ts`, `codex/launch.ts`): без них e2e сборки без бинарника пришлось бы
  гонять на настоящем Codex.
- Getting started: ссылка «Use Codex too» в нижней строке панели, между «worfy Guide» и «Skip», только когда Codex в
  сборке; tooltip объясняет, что шаг необязательный. Это не шаг: не отмечается, в счёт `n/6` не входит; ссылка
  открывает Settings → Vendors (решено без владельца, подтверждено владельцем 2026-11-05: вход один, в Settings, а не вторая кнопка входа в
  панели). Сначала это был отдельный блок под «Connect your own project», но он делал панель выше на ~100 px: в
  Session view toast «Skip» больше не помещался под панелью, вставал наверх и закрывал Hide tools
  (`test/e2e/getting-started.spec.ts`, красный CI на macOS и Windows). Ссылка в нижней строке высоты не добавляет
  (решено без владельца, подтверждено владельцем 2026-11-05). Проверка входа в Claude Code (`src/main/ipc/first-run.ts`) не менялась,
  test-ы first-run — без правок ожиданий.
- Нет входа, нет бинарника: Codex в «New session» неактивен с tooltip `Sign in to Codex in Settings → Vendors`
  (Ticket 24); toast-ов и диалогов ошибок нет. В сборке без бинарника tooltip тот же (решено без владельца, подтверждено владельцем 2026-11-05):
  особый текст потребовал бы правки `app-node-sessions.ts`, который правит параллельный Ticket 27; Settings → Vendors
  уже говорит, что Codex нет в сборке.
- Ошибка `account/read`: в Settings — строка «Could not check the sign-in: …» с «Check again», без toast. В списке
  «New session» осталось правило Ticket-а 24 — проверка, которая упала, ничего не запрещает, Session покажет ошибку
  Vendor-а (решено без владельца, подтверждено владельцем 2026-11-05). Пункт 3 тикета просит здесь «недоступен», но это сломало бы
  `vendor-picker.spec.ts`: фейк `turn` отвечает на `account/read` ошибкой, и spec выбирает Codex.
- e2e `test/e2e/onboarding-codex.spec.ts`: фейк `login` — «Use Codex too» → Settings → Vendors → «Sign in to Codex» →
  `Signed in: user@example.com · plus`; адрес страницы входа попал только в recorder вместо `shell.openExternal`, браузер
  не открывался. Фейк играет один сценарий с начала в каждом процессе и вход не помнит (настоящий Codex помнит его в
  `CODEX_HOME`), поэтому после входа spec переключает фейк на `account-plus`, и Codex доступен в «New session». Фейк
  `signed-out` и `WORFY_CODEX=absent`: ни одного toast, `alertdialog` и нативного диалога; Codex неактивен с tooltip.
  Правило spec-а — в `scripts/e2e-specs.table.json` (`VendorsSection.tsx` → этот spec и `settings.spec.ts`).
- Снимки обеих тем: [Getting started](../evidence/29/29-getting-started-light.png) ([тёмная](../evidence/29/29-getting-started-dark.png)),
  [Vendors без входа](../evidence/29/29-vendors-signed-out-light.png) ([тёмная](../evidence/29/29-vendors-signed-out-dark.png)),
  [Vendors после входа](../evidence/29/29-vendors-signed-in-light.png) ([тёмная](../evidence/29/29-vendors-signed-in-dark.png)),
  [Vendors без Codex в сборке](../evidence/29/29-vendors-without-codex-light.png) ([тёмная](../evidence/29/29-vendors-without-codex-dark.png)),
  [«New session» без Codex в сборке](../evidence/29/29-picker-without-codex-light.png) ([тёмная](../evidence/29/29-picker-without-codex-dark.png)).
