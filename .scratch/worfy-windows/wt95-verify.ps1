# Measures whether a dev start of worfy that fails right after `ready` (step loadURL, through
# ELECTRON_RENDERER_URL='not a url') leaves a Chromium child process behind on Windows.
#
# Written for worfy-windows ticket 95. NOT RUN when written (2026-10-22): the owner's focus pause
# forbids starting Electron. Run it only once that pause is lifted and no game is running.
#
# Usage (Windows PowerShell or pwsh) from the repository root, after `pnpm build` in the tree it
# measures:
#   powershell -NoProfile -ExecutionPolicy Bypass -File .scratch\worfy-windows\wt95-verify.ps1 [-Repo <tree>] [-Runs 10]
# -Repo defaults to the repository this script lies in (two folders up). For the "before" numbers
# point -Repo at a tree on main; for "after", leave it at the tree of the fix.
#
# Each run gets fresh temporary USERPROFILE, APPDATA, LOCALAPPDATA, HOME, HOMEDRIVE, HOMEPATH,
# WORFY_DATA_DIR and WORFY_CLAUDE_HOME, WORFY_GH = the gh stub, WORFY_STARTUP_DIALOG=off. While
# the run lives, every 200 ms it records the processes whose command line contains the run's
# temporary folder (pid, creation time, command line). 5 s after the main process exits it lists
# them again. A survivor is stopped only when its pid, creation time and command line all match a
# process this script recorded itself.

param(
  [string]$Repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path,
  [int]$Runs = 10
)

$ErrorActionPreference = 'Stop'

$electron = Join-Path $Repo 'node_modules\electron\dist\electron.exe'
$ghStub = Join-Path $Repo 'test\fixtures\gh\gh-stub.mjs'
$mainEntry = Join-Path $Repo 'out\main'
foreach ($needed in @($electron, $ghStub, $mainEntry)) {
  if (-not (Test-Path -LiteralPath $needed)) { throw "missing $needed (run pnpm install and pnpm build in $Repo first)" }
}

$games = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match '^(cod|payday)' }
if ($games) { throw "a game is running ($($games.ProcessName -join ', ')): not starting Electron" }

# The owner's shell histories must not change (read only: size and SHA256, before and after).
function HistoryMarks {
  foreach ($file in @("$env:APPDATA\Microsoft\Windows\PowerShell\PSReadLine\ConsoleHost_history.txt", "$env:USERPROFILE\.bash_history")) {
    if (Test-Path -LiteralPath $file) {
      $item = Get-Item -LiteralPath $file
      '{0} {1} {2}' -f $file, $item.Length, (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
    } else {
      "$file missing"
    }
  }
}
$historyBefore = HistoryMarks

function ProcessesWith([string]$text) {
  @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($text) } |
    ForEach-Object { [pscustomobject]@{ Pid = [int]$_.ProcessId; Parent = [int]$_.ParentProcessId; Created = $_.CreationDate; CommandLine = [string]$_.CommandLine } })
}

function KeyOf($p) { '{0}|{1}|{2}' -f $p.Pid, $p.Created.ToUniversalTime().ToString('o'), $p.CommandLine }

$results = @()
for ($run = 1; $run -le $Runs; $run++) {
  $root = Join-Path $env:TEMP ('wt95-run-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
  $dataDir = Join-Path $root 'data'
  $claudeHome = Join-Path $root 'claude'
  $profileDir = Join-Path $root 'profile'
  foreach ($dir in @($root, $claudeHome, $profileDir, "$profileDir\AppData\Roaming", "$profileDir\AppData\Local")) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }

  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $electron
  $psi.Arguments = '"' + $Repo + '" -ApplePersistenceIgnoreState YES'
  $psi.WorkingDirectory = $Repo
  $psi.UseShellExecute = $false
  $psi.RedirectStandardError = $true
  $psi.RedirectStandardOutput = $true
  $vars = @{
    ELECTRON_RENDERER_URL = 'not a url'
    WORFY_STARTUP_DIALOG = 'off'
    WORFY_DATA_DIR = $dataDir
    WORFY_CLAUDE_HOME = $claudeHome
    WORFY_GH = $ghStub
    USERPROFILE = $profileDir
    HOME = $profileDir
    APPDATA = "$profileDir\AppData\Roaming"
    LOCALAPPDATA = "$profileDir\AppData\Local"
    HOMEDRIVE = $profileDir.Substring(0, 2)
    HOMEPATH = $profileDir.Substring(2)
  }
  foreach ($name in $vars.Keys) { $psi.EnvironmentVariables[$name] = $vars[$name] }
  [void]$psi.EnvironmentVariables.Remove('ELECTRON_RUN_AS_NODE')

  $recorded = @{}
  $started = Get-Date
  $main = [System.Diagnostics.Process]::Start($psi)
  $stderrTask = $main.StandardError.ReadToEndAsync()
  $stdoutTask = $main.StandardOutput.ReadToEndAsync()
  while (-not $main.HasExited -and ((Get-Date) - $started).TotalSeconds -lt 30) {
    foreach ($p in ProcessesWith $root) { $recorded[(KeyOf $p)] = $p }
    Start-Sleep -Milliseconds 200
  }
  $timedOut = -not $main.HasExited
  if ($timedOut) { $main.Kill(); $main.WaitForExit() }
  $exitCode = $main.ExitCode
  $stderr = $stderrTask.Result
  [void]$stdoutTask.Result

  Start-Sleep -Seconds 5
  $survivors = @(ProcessesWith $root)
  foreach ($p in $survivors) { $recorded[(KeyOf $p)] = $p }

  $stopped = @()
  foreach ($p in $survivors) {
    $now = Get-CimInstance -Query "SELECT ProcessId, CreationDate, CommandLine FROM Win32_Process WHERE ProcessId = $($p.Pid)"
    if ($null -eq $now) { continue }
    $current = [pscustomobject]@{ Pid = [int]$now.ProcessId; Created = $now.CreationDate; CommandLine = [string]$now.CommandLine }
    if ($recorded.ContainsKey((KeyOf $current))) {
      Stop-Process -Id $current.Pid -Force -ErrorAction SilentlyContinue
      $stopped += $current.Pid
    }
  }

  $result = [pscustomobject]@{
    Run = $run
    ExitCode = $exitCode
    TimedOut = $timedOut
    StepLoadUrl = $stderr.Contains('worfy could not start') -and $stderr.Contains('Step: loadURL')
    Seen = $recorded.Count
    AliveAfter5s = $survivors.Count
    Survivors = (($survivors | ForEach-Object { '{0} {1}' -f $_.Pid, ($_.CommandLine -replace '^.*--utility-sub-type=(\S+).*$', '$1') }) -join '; ')
    Stopped = ($stopped -join ',')
  }
  $results += $result
  $result | Format-List | Out-String | Write-Host

  try { Remove-Item -LiteralPath $root -Recurse -Force } catch { Write-Host "could not remove $root : $($_.Exception.Message)" }
}

$results | Format-Table Run, ExitCode, TimedOut, StepLoadUrl, Seen, AliveAfter5s, Stopped -AutoSize | Out-String | Write-Host
$withOrphans = @($results | Where-Object { $_.AliveAfter5s -gt 0 }).Count
$notOne = @($results | Where-Object { $_.ExitCode -ne 1 }).Count
Write-Host ("runs: {0}; with a process alive 5 s after exit: {1}; exit code other than 1: {2}" -f $Runs, $withOrphans, $notOne)

$historyAfter = HistoryMarks
if (Compare-Object $historyBefore $historyAfter) {
  Write-Host 'HISTORY CHANGED:'; $historyBefore; $historyAfter
  exit 2
}
Write-Host 'histories unchanged:'; $historyAfter
if ($withOrphans -gt 0 -or $notOne -gt 0) { exit 1 }
exit 0
