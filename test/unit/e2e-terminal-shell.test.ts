// The PowerShell script the Terminal e2e specs list a shell's children with (test/e2e/terminal-shell.ts,
// windowsChildrenScript). Only e2e on Windows run it, and the quit test SIGKILLs what it lists, so its
// whole text is pinned here, as test/unit/terminal-shell.test.ts pins descendantsScript: a change of
// the text is to be run on a Windows machine again.
import { describe, expect, it } from 'vitest'
import { windowsChildrenScript } from '../e2e/terminal-shell'

describe('windowsChildrenScript', () => {
  it('lists the children of one pid created no earlier than it, and none when the pid has no process', () => {
    expect(windowsChildrenScript(4242)).toBe(
      "$parent = Get-CimInstance -Query 'SELECT CreationDate FROM Win32_Process WHERE ProcessId = 4242' | Select-Object -First 1; " +
        "if ($null -eq $parent -or $null -eq $parent.CreationDate) { '[]'; exit 0 }; " +
        '$born = $parent.CreationDate.ToUniversalTime(); ' +
        "ConvertTo-Json -Compress -InputObject @(Get-CimInstance -Query 'SELECT ProcessId, Name, CommandLine, CreationDate FROM Win32_Process WHERE ParentProcessId = 4242' | " +
        'Where-Object { $null -ne $_.CreationDate -and $_.CreationDate.ToUniversalTime() -ge $born } | ' +
        'ForEach-Object { @{ pid = $_.ProcessId; name = [string]$_.Name; commandLine = [string]$_.CommandLine } })',
    )
  })

  it('takes the whole part of the pid and has no double quote: it goes to PowerShell as one argument', () => {
    expect(windowsChildrenScript(4242.9)).toBe(windowsChildrenScript(4242))
    expect(windowsChildrenScript(4242)).not.toContain('"')
  })
})
