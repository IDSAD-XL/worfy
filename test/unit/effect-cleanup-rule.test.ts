import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

// The repository's ESLint config keeps every effect of src/renderer returning a cleanup function or nothing
// (scripts/eslint-effect-cleanup.mjs, worfy-polish ticket 165): React 19 calls whatever an effect returns, and a
// returned Promise threw «destroy_ is not a function» in the Chat tab of the Assistant.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const eslint = new ESLint({ cwd: repoRoot })

async function effectErrors(code: string, file = 'src/renderer/probe.tsx'): Promise<string[]> {
  const [result] = await eslint.lintText(`import { useEffect, useLayoutEffect, useInsertionEffect } from 'react'\nimport * as React from 'react'\n${code}\n`, { filePath: join(repoRoot, file) })
  return (result?.messages ?? []).filter((m) => m.ruleId === 'worfy/effect-cleanup').map((m) => m.message)
}

describe('the effect cleanup lint rule', () => {
  it.each([
    // The line of the Chat tab that crashed.
    ["export function Chat(end: { current: HTMLElement | null }, count: number) { useEffect(() => end.current?.scrollIntoView?.({ block: 'end' }), [count]) }"],
    ['export function P(go: () => Promise<void>) { useEffect(() => go(), []) }'],
    ['export function P(ensure: (id: string) => void) { useLayoutEffect(() => ensure("a"), []) }'],
    ['export function P(go: () => void) { useInsertionEffect(() => go()) }'],
    ['export function P(go: () => void) { React.useEffect(() => go(), []) }'],
    ['export function P(ready: boolean, go: () => void) { useEffect(() => ready && go(), [ready]) }'],
    ['export function P(go: () => Promise<void>) { useEffect(async () => { await go() }, []) }'],
    ['export function P() { useEffect(() => { return { done: true } }, []) }'],
    ['export function P(ready: boolean) { useEffect(() => { if (ready) return 1 }, [ready]) }'],
    ['export function P() { useEffect(() => { return null }, []) }'],
    ['export function P(count: number) { useEffect(function () { return count + 1 }, [count]) }'],
    ['export function P() { useEffect(() => 0, []) }'],
  ])('rejects %s', async (code) => {
    expect(await effectErrors(code)).toHaveLength(1)
  })

  it.each([
    ["export function Chat(end: { current: HTMLElement | null }, count: number) { useEffect(() => { end.current?.scrollIntoView?.({ block: 'end' }) }, [count]) }"],
    ['export function P(follow: () => () => void) { useEffect(() => { return follow() }, []) }'],
    ['export function P(stop: () => void) { useEffect(() => stop, [stop]) }'],
    ['export function P(stop: () => void) { useEffect(() => () => stop(), []) }'],
    ['export function P(ready: boolean, stop: () => void) { useEffect(() => (ready ? stop : undefined), [ready]) }'],
    ['export function P(go: () => Promise<void>) { useEffect(() => void go(), []) }'],
    ['export function P(ready: boolean) { useEffect(() => { if (!ready) return; const t = setTimeout(() => 1, 5); return () => clearTimeout(t) }, [ready]) }'],
    // A return of a nested function is that function's own.
    ['export function P() { useEffect(() => { const pick = () => 1; pick() }, []) }'],
    // Not an effect.
    ['export function P(go: () => number) { const f = (cb: () => number) => cb(); f(() => go()) }'],
  ])('allows %s', async (code) => {
    expect(await effectErrors(code)).toEqual([])
  })

  it('does not check code outside src/renderer', async () => {
    expect(await effectErrors('export function P(go: () => Promise<void>) { useEffect(() => go(), []) }', 'test/unit/probe.tsx')).toEqual([])
  })
})
