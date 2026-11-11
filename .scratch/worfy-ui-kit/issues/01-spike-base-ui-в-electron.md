# 01 — Spike Base UI в Electron

Type: spike
Status: open
Blocked by: —
Source: [spec.md](../spec.md), «Ticket-ы», строка 01; «Решения по реализации» (`Select` внутри окна kit, Esc); «Риски»
(spike ответит «нет», `<webview>`, перетаскивание Node-а, размер); истории 24 и 32;
[критик](../../../docs/product/critic/worfy-ui-kit-2026-11-11.md), возражение 1

## Что происходит

Epic переводит окна, popover-ы и menu worfy на Base UI (`@base-ui/react`). Уживается ли Base UI с Electron worfy,
никто не проверял. Известные места риска: клик внутри `<webview>` Browser Node не доходит до document
([Base UI #5410](https://github.com/mui/base-ui/issues/5410)), menu открывается на нажатие кнопки мыши и может мешать
тащить Node ([#6150](https://github.com/mui/base-ui/issues/6150)), три guard-а клавиатуры окон Settings, Keyboard
shortcuts и Guide ловят Esc и Tab в capture phase на window, свой `Select` рисует список в `document.body` поверх всех
окон (`src/renderer/theme/Select.tsx:17`), а модальный Dialog Base UI отключает клики снаружи окна.

## Что делаем

1. На одноразовой ветке (в `main` не вливается) ставим `@base-ui/react` и собираем Dialog, Popover, Menu и Tooltip
   поверх Canvas, в Node с перетаскиванием, рядом с Terminal и Browser, под focus mode и поверх Settings.
2. Проверяем: клик внутри `<webview>` закрывает popover (или закрывает blur окна); фокус рядом с xterm не уходит после
   закрытия; menu на Node-е не мешает тащить Node; Esc рядом с guard-ами окон закрывает только верхний слой и как
   Base UI даёт отметить нажатие обработанным (`preventDefault`); есть ли у пакета install scripts
   (`pnpm-workspace.yaml`, `allowBuilds`).
3. Свой `Select` внутри модального Dialog kit: выбор пункта мышью, Esc на открытом списке, список виден screen
   reader-у. Сравниваем три решения из spec-а: список внутри открытого окна; kit считает список частью окна; окна с
   `Select` в режиме `modal: 'trap-focus'`. Выбираем одно.
4. Меряем размер сборки renderer-а и время старта против e2e test-а бюджета 3 s (`test/e2e/start-budget.ts`).
5. Пишем заметку с ответами, выбранным решением для `Select` и итогом «да» или «нет». При «нет» Epic стоит после
   Wave 1, решает владелец.

## Готово, когда

- [ ] Заметка `.scratch/worfy-ui-kit/spike-base-ui.md`: ответ на каждый пункт шагов 2–4 с тем, как проверено
      (команда, test или запись экрана), выбранное решение для `Select` и итог «да» или «нет».
- [ ] Разница размера сборки и времени старта записана числами; e2e test бюджета старта на ветке spike-а прогнан, exit
      code в заметке.
- [ ] Ветка spike-а не влита; в PR Ticket-а только заметка.
- [ ] lint и gate fast — exit 0.

## Где в коде

- `.scratch/worfy-ui-kit/spike-base-ui.md` (новый)

## Вне скоупа

- Код kit в `main`: он начинается в Ticket-е 03.
