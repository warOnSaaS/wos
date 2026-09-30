# Installs the wOS command-line tool (wos) on Windows from a GitHub Release of warOnSaaS/wos. No admin, no npm.
#
#   irm https://waronsaas.com/install.ps1 | iex
#
# What it does: checks Node.js 22.12 or later; finds the newest release tagged cli@<version> (or $env:WOS_VERSION);
# downloads wos-<version>-win32-x64.tar.gz and SHA256SUMS; refuses the file unless its SHA-256 matches; unpacks it
# into %LOCALAPPDATA%\wos\<version> with tar.exe (built into Windows 10 1803 and later); writes
# %LOCALAPPDATA%\wos\bin\wos.cmd. It does not change PATH: it prints the command that does.
#
# Settings (environment variables, all optional): WOS_VERSION, WOS_INSTALL_DIR (default %LOCALAPPDATA%\wos),
# WOS_INSTALL_FROM (a local directory holding the release files instead of GitHub; used by the release CI).
# Uninstall: Remove-Item -Recurse "$env:LOCALAPPDATA\wos"
# Source: https://github.com/warOnSaaS/wos/blob/main/apps/web/install/install.ps1

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Repo = 'warOnSaaS/wos'

function Stop-Install([string]$Message) {
  Write-Host "wOS install: $Message"
  throw "wOS install: $Message"
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Stop-Install 'Node.js 22.12 or later is required and was not found on PATH. Install it from https://nodejs.org and run this again.'
}
$nodeVersion = (& node -p 'process.versions.node').Trim()
$parts = $nodeVersion.Split('.') | ForEach-Object { [int]$_ }
if (-not ($parts[0] -gt 22 -or ($parts[0] -eq 22 -and $parts[1] -ge 12))) {
  Stop-Install "Node.js 22.12 or later is required; this machine has v$nodeVersion. Install it from https://nodejs.org and run this again."
}
if (-not (Get-Command tar.exe -ErrorAction SilentlyContinue)) { Stop-Install 'tar.exe is required (Windows 10 1803 or later).' }

$target = (& node -p 'process.platform + "-" + process.arch').Trim()
if ($target -ne 'win32-x64') { Stop-Install "no build for $target yet (Windows x64 only)." }

$from = $env:WOS_INSTALL_FROM
$version = $env:WOS_VERSION
if ($version) { $version = $version -replace '^cli@', '' -replace '^v', '' }
if (-not $version) {
  if ($from) { Stop-Install 'WOS_INSTALL_FROM needs WOS_VERSION.' }
  $releases = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases?per_page=100" -Headers @{ 'User-Agent' = 'wos-install' }
  $release = $releases | Where-Object { $_.tag_name -like 'cli@*' -and -not $_.draft -and -not $_.prerelease } | Select-Object -First 1
  if (-not $release) {
    Stop-Install "the wOS CLI is not released yet: https://github.com/$Repo has no cli@ release. See https://waronsaas.com/contribute"
  }
  $version = $release.tag_name.Substring(4)
}

$file = "wos-$version-$target.tar.gz"
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("wos-install-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  foreach ($name in @('SHA256SUMS', $file)) {
    if ($from) {
      Copy-Item (Join-Path $from $name) (Join-Path $tmp $name)
    } else {
      $url = "https://github.com/$Repo/releases/download/cli%40$version/$name"
      Invoke-WebRequest -Uri $url -OutFile (Join-Path $tmp $name) -Headers @{ 'User-Agent' = 'wos-install' } -UseBasicParsing
    }
  }
  $line = Get-Content (Join-Path $tmp 'SHA256SUMS') | Where-Object { $_.Trim().EndsWith("  $file") } | Select-Object -First 1
  if (-not $line) { Stop-Install "SHA256SUMS of cli@$version lists no $file." }
  $expected = $line.Trim().Split(' ')[0].ToLowerInvariant()
  $actual = (Get-FileHash -Algorithm SHA256 (Join-Path $tmp $file)).Hash.ToLowerInvariant()
  if ($actual -ne $expected) { Stop-Install "checksum mismatch for ${file}: expected $expected, got $actual; nothing was installed." }

  $root = if ($env:WOS_INSTALL_DIR) { $env:WOS_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'wos' }
  $dest = Join-Path $root $version
  $bin = Join-Path $root 'bin'
  if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
  New-Item -ItemType Directory -Path $dest, $bin -Force | Out-Null
  & tar.exe -xzf (Join-Path $tmp $file) -C $dest --strip-components=1
  if ($LASTEXITCODE -ne 0) { Stop-Install "could not unpack $file." }
  $shim = Join-Path $bin 'wos.cmd'
  Set-Content -Path $shim -Encoding ASCII -Value "@echo off`r`nnode `"$dest\dist\wos.mjs`" %*"
  & $shim --version | Out-Null
  if ($LASTEXITCODE -ne 0) { Stop-Install "installed to $dest, but wos --version failed." }
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}

Write-Host "wOS CLI $version installed: $shim -> $dest"
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if (-not (($userPath -split ';') -contains $bin)) {
  Write-Host "$bin is not on your PATH. To add it for your user, run this, then open a new terminal:"
  Write-Host "  [Environment]::SetEnvironmentVariable('Path', `"$bin;`" + [Environment]::GetEnvironmentVariable('Path', 'User'), 'User')"
}
Write-Host 'Next: wos login'
