# 09 — Проверка подключения `<webview>` отклоняет и то, что ослабляет страницу: `webSecurity`, insecure content, Blink features

Type: task
Status: open
Blocked by: 02
Source: review PR #576 (Ticket 02), находка low verifier-а, группа Consider; [ADR-0078](../../../docs/adr/0078-browser-node.md),
пункт 3. Код перечитан по main `ae547cc2`.

## Что происходит

- `webviewAttachRefusal` (`src/main/browser/attach-policy.ts:32`) читает только preload,
  `nodeIntegration`, `nodeIntegrationInSubFrames`, `contextIsolation`, `sandbox` и partition. Всё
  остальное в `webPreferences` пропускается.
- Поэтому `<webview partition="worfy-browser" disablewebsecurity>` или атрибут
  `webpreferences="webSecurity=no, allowRunningInsecureContent=yes, enableBlinkFeatures=…"`
  подключится, и guest-страница получит выключенную same-origin policy.
- Сейчас это не атака: Electron 44.5.1 создаёт `<webview>` только из main frame renderer-а worfy, не
  из iframe Card и не из guest-страницы. Но проверка должна отказывать сама, а не надеяться на это.

## Что делаем

1. `webviewAttachRefusal` отклоняет ещё: `webSecurity === false`,
   `allowRunningInsecureContent === true`, непустые `enableBlinkFeatures` и `experimentalFeatures`
   (`true`), `plugins === true`, `webviewTag === true` у guest (вложенный `<webview>`).
2. Отказ называет причину так же, как сейчас (строка в лог main).
3. Комментарий `src/renderer/canvas/canvas.css:23` («CardNode marks the root with data-pointer-pressed»)
   поправить: маркер ставит `src/renderer/canvas/nodes/frames-step-aside.ts` для Card и слоя Browser-ов.

## Готово, когда

- [ ] Unit `test/unit/webview-attach-policy.test.ts`: по тесту на каждый новый отказ из пункта 1;
      правильная guest-страница по-прежнему разрешена.
- [ ] Мутанты красные: каждая новая проверка снята по одной.
- [ ] e2e `test/e2e/browser-webview-guard.spec.ts`: `<webview disablewebsecurity>` на partition
      Browser-а не подключается.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

## Тесты

- Сначала падающий: unit на `webSecurity === false`.

## Где в коде

- `src/main/browser/attach-policy.ts`
- `test/unit/webview-attach-policy.test.ts`
- `test/e2e/browser-webview-guard.spec.ts`
- `src/renderer/canvas/canvas.css` (только комментарий `:23`)

## Вне скоупа

- Ответы владельца на вопросы 1, 2, 5 Ticket-а 02 — Ticket 10.

## Итог

Заполняется при закрытии.
