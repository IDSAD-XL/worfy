# 05 — Окна Project-ов на Dialog kit

Type: task
Status: open
Blocked by: 04
Source: [spec.md](../spec.md), «Ticket-ы», строка 05; «Решения по реализации» (остальные модальные окна); истории 1, 2, 9;
заметка темы `docs/product/ui-overhaul/notes/inventory-overlays.md`, раздел 1.1

## Что происходит

Шесть окон Project-ов — свой `createPortal`, свой backdrop, свой Esc. Focus trap нет ни у одного; фокус возвращается
только из Edit profile, и то через Project settings:

- Project settings — `shell/ProjectSettings.tsx`;
- выбор Machine при Add project (`MachineChoice`) — `shell/sidebar/ProjectsSection.tsx:166-215`;
- Remove project — `projects/RemoveProject.tsx`;
- Connect project — `projects/ConnectProject.tsx`;
- Folder browser — `projects/FolderBrowser.tsx`;
- Edit profile — `projects/EditProfile.tsx`.

## Что делаем

1. Шесть окон переходят на Dialog kit (Ticket 04): роль и имя прежние, focus trap, возврат фокуса, слой из шкалы.
2. Свои backdrop, Esc и inline `zIndex` этих окон удаляются. Правила «не закрывать во время работы» (Remove project,
   :137) сохраняются.
3. Вложенное окно (Folder browser из Connect project, Edit profile из Project settings) закрывается первым по Esc, фокус
   возвращается в родительское окно.

## Готово, когда

- [ ] Unit test-ы окон: Tab не уходит из окна; после закрытия фокус на кнопке, которая окно открыла; Esc во вложенном
      окне закрывает только его.
- [ ] Существующие unit test-ы и e2e `projects-connect.spec.ts`, `edit-profile.spec.ts` зелёные без правок ролей и
      `data-testid`.
- [ ] Своих focus trap, backdrop и inline `zIndex` в этих шести окнах нет.
- [ ] Правка вида, если она есть, названа в PR отдельной строкой.
- [ ] lint, typecheck, test-ы модуля и gate fast — exit 0.

## Где в коде

- `src/renderer/shell/ProjectSettings.tsx`
- `src/renderer/shell/sidebar/ProjectsSection.tsx`
- `src/renderer/projects/RemoveProject.tsx`
- `src/renderer/projects/ConnectProject.tsx`
- `src/renderer/projects/FolderBrowser.tsx`
- `src/renderer/projects/EditProfile.tsx`
- `test/unit/project-settings-shell.test.tsx`
- `test/unit/remove-project.test.tsx`
- `test/unit/connect-project.test.tsx`
- `test/unit/folder-browser.test.tsx`
- `test/unit/edit-profile.test.tsx`
- `test/e2e/projects-connect.spec.ts`
- `test/e2e/edit-profile.spec.ts`

## Вне скоупа

- Context menu Project-а в sidebar (тот же `ProjectsSection.tsx`): Ticket 12.
