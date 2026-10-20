# 09 — Проверка подключения `<webview>` отклоняет и то, что ослабляет страницу: `webSecurity`, insecure content, Blink features

Type: task
Status: done 2026-10-20T14:44Z
PR: #601
Branch: worfy-browser/09
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

Сделано в PR (ветка `worfy-browser/09`) — всё из «Что делаем» и все пункты «Готово, когда».

- `webviewAttachRefusal` (`src/main/browser/attach-policy.ts`) отклоняет ещё `webSecurity`,
  `allowRunningInsecureContent`, `enableBlinkFeatures`, `experimentalFeatures`, `plugins`,
  `webviewTag`. Все шесть имён есть в `WebPreferences` из `electron.d.ts` Electron 44.5.1 и в
  аргументе `will-attach-webview`; ни одно из названных Ticket-ом не пропущено.
- Проверка строже, чем в «Что делаем»: значение проходит, только если оно безопасное (`webSecurity`
  — `true`, остальные булевы — `false`, `enableBlinkFeatures` — пустая строка) или отсутствует
  (тогда Electron берёт безопасное по умолчанию). Причина: атрибут `webpreferences` передаёт любую
  строку, а Electron читает строку как булево по truthy/falsy, так что `webSecurity=` выключил бы
  web security, а `plugins=maybe` включил бы plugins. Проверка `=== false` / `=== true` их бы
  пропустила.
- Отказ называет причину, как раньше: строка `[worfy] a <webview> was not attached: …` в лог main.
- Комментарий `src/renderer/canvas/canvas.css:22` называет `nodes/frames-step-aside.ts` (для
  CardNode и слоя Browser-ов) вместо CardNode.

Проверки:

- unit `test/unit/webview-attach-policy.test.ts`: по test-у на каждый новый отказ, test-ы на
  строковые значения, правильная guest-страница разрешена — и с безопасными значениями, и без них.
- mutation testing на копии в отдельном detached worktree: снят каждый новый отказ по одному
  (6 мутантов) и ослаблены две строгости (`webSecurity === false`, `=== true` для булевых) — все 8
  дают exit 1.
- e2e `test/e2e/browser-webview-guard.spec.ts`: `<webview disablewebsecurity>` на partition Browser-а
  не подключается; spec под замком e2e — exit 0. С мутантом без проверки `webSecurity` тот же spec
  падает (подключился guest `?no-web-security`) — exit 1.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, gate fast — exit 0.

Вне скоупа замечено: `nodeIntegrationInWorker`, `disableBlinkFeatures` и `javascript` проверка не
читает. `nodeIntegrationInWorker` по `electron.d.ts` даёт Node только worker-ам frame-а, у которого
Node уже есть, а `nodeIntegration` и `nodeIntegrationInSubFrames` проверка отклоняет; остальные два
страницу не ослабляют. Если решим отказывать и им — отдельный Ticket.

**Ревью и merge.** Ревью — VERIFIED, находок high и med нет. Gate full зелёный на слиянии с main
`219a6111`, Windows runner зелёный. Merge — `d3596546` (gate queue Session «Worfy продолжение»).
