# Antigravity debug-port helper for the Chinese pack (keep this file ASCII only).
#
# Since Antigravity 2.33.0 (2026-11) the app opens its DevTools (CDP) port only when it is started
# with --remote-debugging-port. Older versions always opened it. inject.mjs needs that port to reach
# the window (i18n, status bar, fonts), so this script adds the flag to the Antigravity shortcuts.
# Only shortcuts whose target is %LOCALAPPDATA%\Programs\antigravity\Antigravity.exe are touched:
# Start menu, desktop, and taskbar pins of the current user.
#
# Modes:
#   add     add --remote-debugging-port=0 to shortcuts that lack it (default)
#   remove  take the flag off again (used by the uninstaller)
#   check   only list the shortcuts, change nothing
#   watch   add, then print "nodebug=<pid>" for a running Antigravity that was started without the flag
#   notify  show a tray notification (-Title / -Text) that tells the user to reopen Antigravity
# Output lines: "added|removed|ok|missing <path>", "found=N changed=M", "nodebug=<pid>".
# Test mode: with AGY_SETUP_TEST=1 the desktop folder is %USERPROFILE%\Desktop (never the real one).
param(
  [ValidateSet('add', 'remove', 'check', 'watch', 'notify')][string]$Mode = 'add',
  [string]$Title = 'Antigravity',
  [string]$Text = ''
)
$ErrorActionPreference = 'Stop'
$flag = '--remote-debugging-port=0'
$flagRe = '\s*--remote-debugging-port(=\S*)?'
$exe = Join-Path $env:LOCALAPPDATA 'Programs\antigravity\Antigravity.exe'

if ($Mode -eq 'notify') {
  Add-Type -AssemblyName System.Windows.Forms, System.Drawing
  $n = New-Object System.Windows.Forms.NotifyIcon
  try { $n.Icon = [System.Drawing.Icon]::ExtractAssociatedIcon($exe) } catch { $n.Icon = [System.Drawing.SystemIcons]::Information }
  $n.Text = 'Antigravity'
  $n.BalloonTipTitle = $Title
  $n.BalloonTipText = $Text
  $n.Visible = $true
  $n.ShowBalloonTip(20000)
  Start-Sleep -Seconds 20
  $n.Dispose()
  exit 0
}

$desktop = if ($env:AGY_SETUP_TEST -eq '1') { Join-Path $env:USERPROFILE 'Desktop' } else { [Environment]::GetFolderPath('Desktop') }
$roots = @(
  (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'),
  $desktop,
  (Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned')
)
$sh = New-Object -ComObject WScript.Shell
$found = 0; $changed = 0
foreach ($r in $roots) {
  if (-not $r -or -not (Test-Path -LiteralPath $r)) { continue }
  # watch runs every 2 minutes, so it looks only at the top level of the desktop (a full walk took 8.5 s on one PC);
  # add / remove / check (installer, uninstaller) still walk the whole tree.
  if ($Mode -eq 'watch' -and $r -eq $desktop) {
    $files = Get-ChildItem -LiteralPath $r -Filter *.lnk -ErrorAction SilentlyContinue
  } else {
    $files = Get-ChildItem -LiteralPath $r -Recurse -Filter *.lnk -ErrorAction SilentlyContinue
  }
  foreach ($f in $files) {
    try { $l = $sh.CreateShortcut($f.FullName) } catch { continue }
    if ($l.TargetPath -ne $exe) { continue }
    $found++
    $has = $l.Arguments -match '--remote-debugging-port'
    if ($Mode -eq 'remove') {
      if (-not $has) { "ok      $($f.FullName)"; continue }
      $l.Arguments = ($l.Arguments -replace $flagRe, '').Trim()
      $l.Save(); $changed++
      "removed $($f.FullName)"
    } elseif ($has) {
      "ok      $($f.FullName)"
    } elseif ($Mode -eq 'check') {
      "missing $($f.FullName)"
    } else {
      $l.Arguments = ($l.Arguments + ' ' + $flag).Trim()
      $l.Save(); $changed++
      "added   $($f.FullName)"
    }
  }
}
"found=$found changed=$changed"

if ($Mode -eq 'watch') {
  # The main process is the one without --type= (renderers, GPU) and without --import= (sidecars).
  Get-CimInstance Win32_Process -Filter "Name='Antigravity.exe'" | Where-Object {
    $_.ExecutablePath -eq $exe -and $_.CommandLine -notmatch '--type=' -and $_.CommandLine -notmatch '--import='
  } | ForEach-Object {
    if ($_.CommandLine -notmatch '--remote-debugging-port') { "nodebug=$($_.ProcessId)" }
  }
}
