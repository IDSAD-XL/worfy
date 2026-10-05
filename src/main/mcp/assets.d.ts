// Text files imported as strings (Vite's `?raw`), in main and in vitest alike.
declare module '*.md?raw' {
  const text: string
  export default text
}
