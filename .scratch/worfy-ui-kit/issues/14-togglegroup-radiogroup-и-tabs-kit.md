# 14 — ToggleGroup, RadioGroup и Tabs kit вместо своих групп

Type: task
Status: claimed 2026-11-12T14:52Z
Branch: worfy-ui-kit/14
Blocked by: 03
Source: [spec.md](../spec.md), «Ticket-ы», строка 14; «Решения по реализации» (группы); история 7; заметка темы
`docs/product/ui-overhaul/notes/inventory-foundation.md`, раздел 2

## Что происходит

- `SegmentedControl` (`theme/primitives.tsx:123-144`) и его копии — режим Autopilot
  (`autopilot/StartAutopilotModal.tsx:514-530`), язык Guide (`guide/GuideWindow.tsx:161-173`; Ticket 04 переводит его на
  общий `SegmentedControl`), шаги схемы Guide (`guide/scene/LivingScene.tsx:327-343`). Роли есть, стрелок нет.
- Свои `role="radio"`: окно Start Autopilot (`StartAutopilotModal.tsx:519`) и карточка вопроса
  (`session/QuestionCard.tsx:213`). Стрелок нет.
- Tabs Flight recorder (`flight-recorder/DetailPanel.tsx:489-509`): стрелок нет, tabpanel без `aria-labelledby`.
- Tabs Sidebar (`shell/Sidebar.tsx`) уже доступны с клавиатуры и остаются.

## Что делаем

1. `theme/kit/ToggleGroup.tsx`, `theme/kit/RadioGroup.tsx`, `theme/kit/Tabs.tsx`: обёртки Base UI — роли, roving
   focus, стрелки, Home, End.
2. `SegmentedControl` становится обёрткой над ToggleGroup kit с прежним API: его места вызова не меняются. Копии в
   Start Autopilot и схеме Guide переходят на него.
3. Radio окна Start Autopilot и карточки вопроса — RadioGroup kit.
4. Tabs Flight recorder — Tabs kit; tabpanel получает `aria-labelledby`.

## Готово, когда

- [ ] Unit test `test/unit/kit-groups.test.tsx`: в каждой группе стрелки двигают выбор, Home и End — к краям, Tab
      входит в группу одним шагом.
- [ ] Существующие `start-autopilot-modal`, `question-card` unit test-ы и e2e `autopilot-start-modal.spec.ts`,
      `flight-recorder-detail.spec.ts` зелёные без правок ролей и `data-testid`.
- [ ] Своих копий segmented control и своих `role="radio"` в этих местах нет.
- [ ] Правка вида, если она есть, названа в PR отдельной строкой.
- [ ] lint, typecheck, test-ы модуля и gate fast — exit 0.

## Где в коде

- `src/renderer/theme/kit/ToggleGroup.tsx` (новый)
- `src/renderer/theme/kit/RadioGroup.tsx` (новый)
- `src/renderer/theme/kit/Tabs.tsx` (новый)
- `src/renderer/theme/primitives.tsx`
- `src/renderer/theme/primitives.css`
- `src/renderer/autopilot/StartAutopilotModal.tsx`
- `src/renderer/guide/scene/LivingScene.tsx`
- `src/renderer/session/QuestionCard.tsx`
- `src/renderer/flight-recorder/DetailPanel.tsx`
- `src/renderer/flight-recorder/flight-recorder.css`
- `test/unit/kit-groups.test.tsx` (новый)
- `test/unit/start-autopilot-modal.test.tsx`
- `test/unit/question-card.test.tsx`
- `test/e2e/autopilot-start-modal.spec.ts`
- `test/e2e/flight-recorder-detail.spec.ts`

## Вне скоупа

- Tabs Sidebar. Нативные radio (`<input type="radio">`) — они уже доступны.
