<#
  Renders loader states to PNG with headless Microsoft Edge.

    powershell -File tools/preview/screenshot.ps1 -Html ui/index.html -Out dist/shots

  Every entry in -Shots is "name=querystring". Uses a throwaway Edge profile,
  so a running Edge is never touched.
#>
param(
  [string]$Html = "ui/index.html",
  [string]$Out = "dist/shots",
  [int]$Width = 1040,
  [int]$Height = 680,
  [int]$Budget = 6000,
  [switch]$NoMock,   # screenshot the page as-is (e.g. tools/preview/spotify.html)
  [string[]]$Shots = @(
    "fresh=state=fresh",
    "installed=state=installed",
    "outdated=state=outdated",
    "nospotify=state=nospotify",
    "running=state=fresh&click=install&hold=patch",
    "success=state=fresh&click=install&speed=120",
    "error=state=fresh&click=install&fail=patch&speed=120",
    "uninstall=state=installed&click=uninstall,confirm&hold=engine"
  )
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Push-Location $root
try {
  $edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $edge) { throw "Microsoft Edge not found" }
  $name = [IO.Path]::GetFileNameWithoutExtension($Html)
  if ($NoMock) { $preview = (Resolve-Path $Html).Path }
  else {
    $preview = Join-Path $root "dist/preview/$name.html"
    node tools/preview/build.mjs $Html $preview | Out-Null
  }
  New-Item -ItemType Directory -Force $Out | Out-Null
  $profile = Join-Path $env:TEMP ("mogg-edge-" + [guid]::NewGuid().ToString("N"))
  $url = "file:///" + ($preview -replace "\\", "/")
  foreach ($s in $Shots) {
    $n, $qs = $s -split "=", 2
    $png = Join-Path (Resolve-Path $Out) "$n.png"
    # Edge logs harmless noise to stderr; don't let PowerShell treat it as fatal.
    $ErrorActionPreference = "Continue"
    & $edge --headless=new --disable-gpu --hide-scrollbars --mute-audio --no-first-run --log-level=3 --user-data-dir="$profile" `
      --window-size="$Width,$Height" --virtual-time-budget=$Budget --screenshot="$png" "$url`?$qs" 2>&1 | Out-Null
    $ErrorActionPreference = "Stop"
    if (-not (Test-Path $png)) { Write-Warning "no screenshot for $n" }
    Write-Output $png
  }
  Remove-Item -Recurse -Force $profile -ErrorAction SilentlyContinue
} finally { Pop-Location }
