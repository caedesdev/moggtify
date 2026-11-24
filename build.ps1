# Builds dist\Moggtify.exe – a single, self-installing executable.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Test-Path "winres\icon-256.png")) { & "$PSScriptRoot\tools\make-icon.ps1" }

$winres = Join-Path (go env GOPATH) "bin\go-winres.exe"
if (-not (Test-Path $winres)) { go install github.com/tc-hib/go-winres@latest }
& $winres make --arch amd64
if ($LASTEXITCODE -ne 0) { throw "go-winres failed" }

New-Item -ItemType Directory -Force dist | Out-Null
$env:CGO_ENABLED = "0"
go build -trimpath -ldflags "-s -w -H windowsgui" -o dist\Moggtify.exe .
if ($LASTEXITCODE -ne 0) { throw "go build failed" }

$size = [Math]::Round((Get-Item dist\Moggtify.exe).Length / 1MB, 1)
Write-Output "dist\Moggtify.exe ($size MB)"
