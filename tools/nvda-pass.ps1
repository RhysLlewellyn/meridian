<#
.SYNOPSIS
  Captures what NVDA actually says while tabbing through the booking flow.

.DESCRIPTION
  The other half of tools/a11y-sweep.mjs. That one reads Chrome's accessibility
  tree, which is what a screen reader consumes; this one reads what NVDA
  produces from it, which is not the same thing and is where the last of the
  bugs live. NVDA applies its own browse mode, its own punctuation handling and
  its own rules about when a group is announced, and none of that is visible in
  the tree.

  NVDA is started against a scratch configuration with the `silence` synth, so
  it logs every utterance at DEBUG level without saying any of it out loud, and
  never touches the real NVDA profile. Keystrokes go through SendKeys so that
  NVDA's keyboard hook sees them -- CDP-synthesised keys bypass the OS hook
  entirely and browse mode never engages, which makes a CDP-driven "NVDA test"
  a test of something else.

  REQUIRES THE FOREGROUND. NVDA reads whatever window is focused, so Chrome has
  to be able to come to the front. A fullscreen game or anything else holding
  the foreground will silently produce an empty transcript -- the script checks
  for this and stops rather than reporting a pass it did not perform.

.PARAMETER BaseUrl
  Where the site is running. Defaults to the local production server.

.EXAMPLE
  npm run build; npm start
  pwsh tools/nvda-pass.ps1
#>
param(
  [string]$BaseUrl = "http://localhost:3002",
  [string]$Date = "2026-08-25",
  [string]$OutDir = "$env:TEMP\meridian-nvda",
  [int]$Tabs = 16
)

$ErrorActionPreference = "Stop"

$nvda = "C:\Program Files\NVDA\nvda.exe"
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
foreach ($exe in @($nvda, $chrome)) {
  if (-not (Test-Path $exe)) { throw "Not found: $exe" }
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$cfg = Join-Path $OutDir "nvda-config"
$log = Join-Path $OutDir "nvda.log"
$prof = Join-Path $OutDir "chrome-profile"
New-Item -ItemType Directory -Force -Path $cfg | Out-Null
if (Test-Path $log) { Remove-Item $log -Force }

# The silence synth logs speech without producing any. symbolLevel 100 (all)
# so punctuation in the announcements is visible in the transcript.
@'
schemaVersion = 13
[speech]
	synth = silence
	symbolLevel = 100
[braille]
	display = noBraille
[general]
	showWelcomeDialogAtStartup = False
	playStartAndExitSounds = False
	askToExit = False
	saveConfigurationOnExit = False
[update]
	autoCheck = False
'@ | Out-File -FilePath (Join-Path $cfg "nvda.ini") -Encoding utf8

Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class Win {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  public static string ForegroundTitle() {
    var sb = new StringBuilder(300);
    GetWindowText(GetForegroundWindow(), sb, 300);
    return sb.ToString();
  }
}
'@
Add-Type -AssemblyName System.Windows.Forms

<#
  Chrome windows belonging to this run's scratch profile.

  Matched on the profile directory in the command line rather than on the
  window title, because the title is not ours to rely on: any tab whose title
  contains "Meridian" -- a Vercel dashboard, a GitHub page, this repository in
  an editor -- would otherwise be driven instead, and NVDA would faithfully
  transcribe it.
#>
function ProfileWindows([string]$ProfilePath) {
  $ids = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine -like ("*" + $ProfilePath + "*") } |
    Select-Object -ExpandProperty ProcessId
  if (-not $ids) { return @() }
  Get-Process -Id $ids -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowTitle }
}

function Speech([int]$From) {
  Get-Content $log |
    Select-Object -Skip $From |
    Where-Object { $_ -like "Speaking*" } |
    ForEach-Object {
      $_ -replace "^Speaking \[", "" `
         -replace ", CancellableSpeech.*$", "" `
         -replace "LangChangeCommand \('[a-z_]+'\), ", "" `
         -replace "^'|'\]$", ""
    }
}

$url = "$BaseUrl/book/initial-assessment/nadia-okafor?date=$Date"
Write-Host "Starting NVDA (silent) ..."
Start-Process $nvda -ArgumentList @("-c", "`"$cfg`"", "-f", "`"$log`"", "-l", "10", "-m", "--no-sr-flag")
Start-Sleep -Seconds 12
if (-not (Get-Process nvda -ErrorAction SilentlyContinue)) { throw "NVDA did not start" }

Write-Host "Opening $url ..."
Start-Process $chrome -ArgumentList @(
  "--user-data-dir=`"$prof`"", "--no-first-run", "--no-default-browser-check",
  "--new-window", "--window-size=1400,1000", $url
) | Out-Null
Start-Sleep -Seconds 10

# Scoped to the scratch profile's own processes, not to the window title.
# "Meridian" in a title also matches the Vercel dashboard's deployment page,
# and a run that tabs through somebody else's website produces a transcript
# that looks like a result and is not one. The cleanup at the bottom had the
# same bug and would close that window too.
$win = $null
for ($try = 0; $try -lt 20; $try++) {
  $win = ProfileWindows $prof | Select-Object -First 1
  if ($win) { break }
  Start-Sleep -Seconds 1
}
if (-not $win) { throw "Chrome never opened a window under $prof" }
if ($win.MainWindowTitle -notlike "*Meridian*") {
  throw ("The scratch-profile window is '" + $win.MainWindowTitle + "', not Meridian. " +
         "The site did not load; a run from here would transcribe the wrong page.")
}
# Retried rather than attempted once. Another window taking the foreground for
# a moment as Chrome opens is common and transient; a single attempt turns that
# into a failed run, and the check below is what actually matters.
$front = ""
for ($grab = 0; $grab -lt 6; $grab++) {
  [Win]::ShowWindow($win.MainWindowHandle, 9) | Out-Null
  [Win]::SetForegroundWindow($win.MainWindowHandle) | Out-Null
  Start-Sleep -Seconds 2
  $front = [Win]::ForegroundTitle()
  if ($front -eq $win.MainWindowTitle) { break }
}

if ($front -ne $win.MainWindowTitle) {
  Start-Process $nvda -ArgumentList "-q" | Out-Null
  throw ("Chrome could not take the foreground -- '" + $front + "' is holding it. " +
         "NVDA reads the focused window, so this run would produce an empty transcript " +
         "and a false pass. Close or minimise that window and run again.")
}

$mark = (Get-Content $log | Measure-Object -Line).Lines
Write-Host "Tabbing $Tabs times ..."
for ($i = 0; $i -lt $Tabs; $i++) {
  [System.Windows.Forms.SendKeys]::SendWait("{TAB}")
  Start-Sleep -Milliseconds 700
}

Write-Host "Arrowing through the slot grid ..."
foreach ($key in @("{RIGHT}", "{RIGHT}", "{DOWN}", "{LEFT}", "{UP}")) {
  [System.Windows.Forms.SendKeys]::SendWait($key)
  Start-Sleep -Milliseconds 700
}
Start-Sleep -Seconds 2

$transcript = Speech $mark
Write-Host ""
Write-Host "--- what NVDA said ---"
if ($transcript.Count -eq 0) {
  Write-Host "(nothing -- NVDA saw no focus changes, which is a failure, not a pass)"
} else {
  $transcript | ForEach-Object { Write-Host "  $_" }
}
$transcript | Out-File -FilePath (Join-Path $OutDir "transcript.txt") -Encoding utf8
Write-Host ""
Write-Host ("Transcript: " + (Join-Path $OutDir "transcript.txt"))

Start-Process $nvda -ArgumentList "-q" | Out-Null
ProfileWindows $prof | Stop-Process -Force -ErrorAction SilentlyContinue
