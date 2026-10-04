# Стек: Electron, TypeScript, React, React Flow, Claude Agent SDK

Дата: 2026-10-05. Статус: принят.

worfy — Electron-приложение для macOS на TypeScript: React в renderer, холст на React Flow (`@xyflow/react`, MIT), агенты через Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) в main process, терминал через `node-pty` + `xterm.js`. Решающий фактор — Agent SDK существует только для Node и Python: Electron даёт один язык от UI до агента без моста между процессами на разных языках. Размер сборки и память для личного приложения не важны.

## Considered Options

- Tauri: лёгкая сборка, но рядом всё равно нужен Node-процесс для SDK — второй язык и мост.
- Нативный Swift: холст и карточки (веб-страницы) пришлось бы строить заново поверх WKWebView.
- tldraw вместо React Flow: доска с рисованием, которая здесь не нужна, и лицензия SDK с ключом для production.
- Обычный JS без сборки, как в Morphy: отвергнуто ради типов на границах IPC и в протоколе событий агента.
