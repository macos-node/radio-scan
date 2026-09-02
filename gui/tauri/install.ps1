<#
  install.ps1 - build ntune (release) and point the Windows launch shortcuts at
  it, then relaunch. The Windows analog of install.sh (macOS). On Windows the
  shortcuts run straight from the build tree, so "install" here means: refresh the
  Taskbar / Start / Desktop shortcuts to the latest build (scripts/win-shortcuts.ps1).

    ./install.ps1               # build (release, no bundle) + refresh + relaunch
    ./install.ps1 -SkipBuild    # refresh shortcuts to the last build, no rebuild

  Or via npm:  npm run install:win

  ASCII-only on purpose: Windows PowerShell 5.1 reads a BOM-less .ps1 as the system
  codepage, so non-ASCII here would break parsing.
#>
param([switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$exe = Join-Path $PSScriptRoot 'src-tauri\target\release\ntune.exe'

if (-not $SkipBuild) {
  # The linker can't overwrite a running ntune.exe, so quit it before building.
  Write-Host '--- Quitting running ntune (if any) ---'
  Get-Process -Name ntune -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 500
  # Same first-run gap as install.sh: `npm run tauri` resolves the CLI out of
  # node_modules\.bin, so a fresh clone fails with "tauri: command not found",
  # which reads like a missing global tool. If the shim is ever named something
  # else the check simply re-runs npm install, which is wasteful but not wrong.
  if (-not (Test-Path 'node_modules\.bin\tauri.cmd')) {
    Write-Host '--- Installing npm dependencies (first build here) ---'
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed (exit $LASTEXITCODE)" }
  }
  Write-Host '--- Building ntune (release, no bundle) ---'
  npm run tauri build -- --no-bundle
  if ($LASTEXITCODE -ne 0) { throw "build failed (exit $LASTEXITCODE)" }
}

if (-not (Test-Path $exe)) {
  throw "No built exe at $exe - run without -SkipBuild first."
}

Write-Host '--- Refreshing shortcuts ---'
& (Join-Path $PSScriptRoot 'scripts\win-shortcuts.ps1')

Write-Host '--- Relaunching ---'
Get-Process -Name ntune -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 300
Start-Process $exe

$ver = (Get-Item $exe).VersionInfo.ProductVersion
Write-Host "Installed + relaunched: $exe (v$ver)"
