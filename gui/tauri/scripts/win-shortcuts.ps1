<#
  win-shortcuts.ps1 - point ntune's Windows launch shortcuts at the latest build.

  Called by `make install` on Windows (see ../Makefile). Repoints the Taskbar pin,
  the Start-menu entry, and the Desktop shortcut at the freshly built release exe
  so all three always launch the current build. Start-menu + Desktop are created
  if missing; the Taskbar pin can only be *updated* (Windows blocks programmatic
  pinning) - it's reported as missing if you've never pinned ntune by hand.

  Idempotent: re-running just rewrites the same targets. 5.1-compatible.
#>
$ErrorActionPreference = 'Stop'

# Resolve the release exe relative to this script: scripts/ -> gui/tauri -> src-tauri/...
$tauriDir = Split-Path (Split-Path $PSCommandPath -Parent) -Parent
$exe = Join-Path $tauriDir 'src-tauri\target\release\ntune.exe'
if (-not (Test-Path $exe)) {
  Write-Error "latest build not found: $exe`nRun 'make build' (or 'npm run tauri build') first."
}
$exe     = (Resolve-Path $exe).Path
$workdir = Split-Path $exe
$ver     = (Get-Item $exe).VersionInfo.ProductVersion
Write-Host "ntune shortcuts -> v$ver"
Write-Host "  $exe"

$sh = New-Object -ComObject WScript.Shell

# name, path, whether we may create it if absent
$links = @(
  @{ name = 'Taskbar'; path = Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\ntune.lnk'; create = $false },
  @{ name = 'Start';   path = Join-Path ([Environment]::GetFolderPath('Programs')) 'ntune.lnk';                                  create = $true  },
  @{ name = 'Desktop'; path = Join-Path ([Environment]::GetFolderPath('Desktop'))  'ntune.lnk';                                  create = $true  }
)

foreach ($l in $links) {
  $exists = Test-Path $l.path
  if (-not $exists -and -not $l.create) {
    Write-Host ("  {0,-8} skipped (not pinned - pin ntune to the taskbar once, by hand)" -f $l.name)
    continue
  }
  $lnk = $sh.CreateShortcut($l.path)
  $lnk.TargetPath       = $exe
  $lnk.WorkingDirectory = $workdir
  $lnk.IconLocation     = "$exe,0"
  $lnk.Description       = "ntune - radio-scan L4 tuner/player"
  $lnk.Save()
  $verb = if ($exists) { 'updated' } else { 'created' }
  Write-Host ("  {0,-8} {1}" -f $l.name, $verb)
}
