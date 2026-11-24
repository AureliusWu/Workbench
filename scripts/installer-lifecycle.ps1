param(
  [string] $InstallerPath,
  [string] $BaselineVersion = '1.0.9',
  [string] $BaselineInstallerPath
)
$ErrorActionPreference = 'Stop'
$workspacePath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $workspacePath
$package = Get-Content -LiteralPath (Join-Path $workspacePath 'package.json') -Raw | ConvertFrom-Json
$version = $package.version
$installerGuid = $package.build.nsis.guid
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:RUNNER_OS -ne 'Windows') {
  throw 'Actual installer lifecycle tests run only in an ephemeral GitHub-hosted Windows account. Local registry and installed applications are left untouched.'
}
if ($package.build.appId -ne 'com.aureliuswu.workbench' -or $package.build.productName -ne 'Workbench' -or $installerGuid -ne '01102294-7068-596a-b26b-50193e5b226e') { throw 'Stable installer identity changed unexpectedly.' }
if ($package.build.nsis.oneClick -ne $true -or $package.build.nsis.perMachine -ne $false -or $package.build.nsis.deleteAppDataOnUninstall -ne $false) { throw 'Installer safety settings must be one-click, per-user, and retain app data.' }
if (!$InstallerPath) { $InstallerPath = $env:WORKBENCH_INSTALLER }
if (!$InstallerPath) { $InstallerPath = Join-Path $workspacePath "release\Workbench-Setup-$version-win-x64.exe" }
$InstallerPath = [System.IO.Path]::GetFullPath($InstallerPath)
if (!(Test-Path -LiteralPath $InstallerPath -PathType Leaf)) { throw "Installer not found: $InstallerPath" }
$evidencePath = Join-Path $workspacePath ("artifacts\installer-" + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
$installPath = [System.IO.Path]::GetFullPath((Join-Path $evidencePath 'installed-program'))
$artifactRoot = [System.IO.Path]::GetFullPath((Join-Path $workspacePath 'artifacts')) + [System.IO.Path]::DirectorySeparatorChar
if (!$installPath.StartsWith($artifactRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Installer test target escaped the artifacts directory.' }
New-Item -ItemType Directory -Path $evidencePath -Force | Out-Null
$profilePath = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'Workbench'
$criticalNames = @('workbench.json', 'workbench.json.bak', 'ai-key.bin', 'notification-ledger.json')
$report = [ordered]@{ status = 'FAIL'; version = $version; baselineVersion = $BaselineVersion; installer = $InstallerPath; installPath = $installPath; profilePath = $profilePath; evidence = $evidencePath }
$didInstall = $false
$linkBackups = @()

function Get-InstallRecords {
  $records = @()
  foreach ($hive in @([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryHive]::LocalMachine)) {
    foreach ($view in @([Microsoft.Win32.RegistryView]::Registry64, [Microsoft.Win32.RegistryView]::Registry32)) {
      $rootKey = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive, $view)
      try {
        foreach ($subkeyName in @("Software\$installerGuid", "Software\Microsoft\Windows\CurrentVersion\Uninstall\$installerGuid")) {
          $key = $rootKey.OpenSubKey($subkeyName)
          if ($key) {
            try { $records += [PSCustomObject]@{ Hive = $hive.ToString(); View = $view.ToString(); Key = $subkeyName; InstallLocation = $key.GetValue('InstallLocation'); DisplayVersion = $key.GetValue('DisplayVersion') } }
            finally { $key.Dispose() }
          }
        }
      } finally { $rootKey.Dispose() }
    }
  }
  return $records
}
function Assert-OwnInstallation([string] $ExpectedVersion) {
  $records = @(Get-InstallRecords)
  if (!$records.Count) { throw 'Installer did not create its expected registration.' }
  foreach ($record in $records) {
    if ($record.Hive -ne 'CurrentUser') { throw 'Per-user installer unexpectedly registered a machine-wide installation.' }
    if ($record.InstallLocation -and [System.IO.Path]::GetFullPath($record.InstallLocation).TrimEnd('\') -ne $installPath.TrimEnd('\')) { throw 'Installer registration points outside the dedicated test program directory.' }
  }
  if (!@($records | Where-Object { $_.DisplayVersion -eq $ExpectedVersion }).Count) { throw "Installed registration version is not $ExpectedVersion" }
  return $records
}
function Run-Installer([string] $File, [string] $Arguments) {
  $process = Start-Process -FilePath $File -ArgumentList $Arguments -WindowStyle Hidden -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw "Installer process returned $($process.ExitCode): $File" }
}
function Get-Sha256([string] $Filename) {
  $stream = $null
  $algorithm = $null
  try {
    $stream = [System.IO.File]::OpenRead($Filename)
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    return [System.BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '').ToLowerInvariant()
  } finally {
    if ($algorithm) { $algorithm.Dispose() }
    if ($stream) { $stream.Dispose() }
  }
}
function Get-ProtectedHashes {
  $hashes = [ordered]@{}
  foreach ($name in $criticalNames) {
    $filename = Join-Path $profilePath $name
    if (Test-Path -LiteralPath $filename -PathType Leaf) { $hashes[$name] = Get-Sha256 $filename }
  }
  return $hashes
}
function Assert-SameHashes($Before, $After, [string] $Stage) {
  foreach ($name in $Before.Keys) {
    if (!$After.Contains($name) -or $Before[$name] -ne $After[$name]) { throw "$Stage changed protected data: $name" }
  }
}
function Invoke-InstalledProfile([string] $Mode, [string] $ExpectedVersion) {
  & node (Join-Path $PSScriptRoot 'installed-profile.cjs') (Join-Path $installPath 'Workbench.exe') $profilePath $Mode $ExpectedVersion $evidencePath | Write-Host
  if ($LASTEXITCODE -ne 0) { throw "Installed $Mode profile check failed." }
  return (Get-Content -LiteralPath (Join-Path $evidencePath "installed-$Mode.json") -Raw | ConvertFrom-Json)
}
function Uninstall-OwnTest {
  $records = @(Get-InstallRecords)
  if (!$records.Count) { return }
  foreach ($record in $records) {
    if ($record.InstallLocation -and [System.IO.Path]::GetFullPath($record.InstallLocation).TrimEnd('\') -ne $installPath.TrimEnd('\')) { throw 'Refusing to uninstall an application outside the test directory.' }
  }
  $uninstallerPath = Join-Path $installPath 'Uninstall Workbench.exe'
  if (!(Test-Path -LiteralPath $uninstallerPath -PathType Leaf)) { throw 'Test uninstaller is missing.' }
  Run-Installer $uninstallerPath '/S'
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  while (@(Get-InstallRecords).Count -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 150 }
  if (@(Get-InstallRecords).Count) { throw 'Test uninstall registration was not removed.' }
}

try {
  if (@(Get-InstallRecords).Count) { throw 'An existing Workbench installation is registered. Lifecycle test refuses to modify it.' }
  if (Get-Process -Name Workbench -ErrorAction SilentlyContinue) { throw 'An existing Workbench process is running. Lifecycle test refuses to close it.' }
  foreach ($name in $criticalNames) { if (Test-Path -LiteralPath (Join-Path $profilePath $name)) { throw 'Existing Workbench user records found; lifecycle test will not overwrite them.' } }
  foreach ($shortcutBase in @([Environment]::GetFolderPath('DesktopDirectory'), [Environment]::GetFolderPath('Programs'))) {
    foreach ($shortcutName in @('Workbench.lnk', '花笺 Workbench.lnk')) {
      $shortcut = Join-Path $shortcutBase $shortcutName
      $backup = Join-Path $evidencePath ("shortcut-" + $linkBackups.Count + '.bak')
      $existed = Test-Path -LiteralPath $shortcut -PathType Leaf
      if ($existed) { Copy-Item -LiteralPath $shortcut -Destination $backup }
      $linkBackups += [PSCustomObject]@{ Path = $shortcut; Backup = $backup; Existed = $existed }
    }
  }
  if (!$BaselineInstallerPath) {
    $baselineOutput = Join-Path $evidencePath 'synthetic-baseline'
    & node (Join-Path $workspacePath 'node_modules\electron-builder\cli.js') --win nsis --x64 --publish never "--config.extraMetadata.version=$BaselineVersion" "--config.directories.output=$baselineOutput"
    if ($LASTEXITCODE -ne 0) { throw 'Synthetic baseline installer build failed.' }
    $BaselineInstallerPath = Join-Path $baselineOutput "Workbench-Setup-$BaselineVersion-win-x64.exe"
  }
  $BaselineInstallerPath = [System.IO.Path]::GetFullPath($BaselineInstallerPath)
  if (!(Test-Path -LiteralPath $BaselineInstallerPath -PathType Leaf)) { throw 'Synthetic baseline installer was not found.' }
  Run-Installer $BaselineInstallerPath "/S /D=$installPath"
  $didInstall = $true
  $report.baselineRegistration = @(Assert-OwnInstallation $BaselineVersion)
  $report.seed = Invoke-InstalledProfile 'seed' $BaselineVersion
  $beforeUpgrade = Get-ProtectedHashes
  if (!$beforeUpgrade.Contains('workbench.json') -or !$beforeUpgrade.Contains('ai-key.bin')) { throw 'Seeded records or encrypted key missing.' }
  $oldProgramHash = Get-Sha256 (Join-Path $installPath 'resources\app.asar')
  Set-Content -LiteralPath (Join-Path $installPath 'old-program-sentinel.txt') -Value 'The replacement install must remove this old program file.'
  # No /D here: the real stable identity must discover and replace its registered install path.
  Run-Installer $InstallerPath '/S'
  $report.upgradeRegistration = @(Assert-OwnInstallation $version)
  if (Test-Path -LiteralPath (Join-Path $installPath 'old-program-sentinel.txt')) { throw 'Upgrade left the old program sentinel in place.' }
  if ((Get-Sha256 (Join-Path $installPath 'resources\app.asar')) -eq $oldProgramHash) { throw 'Upgrade did not replace the old application package.' }
  Assert-SameHashes $beforeUpgrade (Get-ProtectedHashes) 'Installer upgrade'
  $report.verify = Invoke-InstalledProfile 'verify' $version
  $beforeUninstall = Get-ProtectedHashes
  Uninstall-OwnTest
  $didInstall = $false
  if (Test-Path -LiteralPath (Join-Path $installPath 'Workbench.exe')) { throw 'Uninstall left the old program executable.' }
  Assert-SameHashes $beforeUninstall (Get-ProtectedHashes) 'Uninstaller'
  $report.status = 'PASS'
  $report.exactFinalInstallerTested = $true
  $report.registeredInstallPathRetained = $true
  $report.programFilesReplaced = $true
  $report.userDataAndEncryptedKeyPreserved = $true
  $report.uninstallRetainedData = $true
} catch {
  $report.failure = $_.Exception.Message
  Write-Error $_ -ErrorAction Continue
} finally {
  if ($didInstall) { try { Uninstall-OwnTest } catch { $report.cleanupFailure = $_.Exception.Message } }
  foreach ($link in $linkBackups) {
    if ($link.Existed) { Copy-Item -LiteralPath $link.Backup -Destination $link.Path -Force }
    elseif (Test-Path -LiteralPath $link.Path -PathType Leaf) { Remove-Item -LiteralPath $link.Path -Force }
  }
  $report | ConvertTo-Json -Depth 15 | Set-Content -LiteralPath (Join-Path $evidencePath 'results.json') -Encoding utf8
  $report | ConvertTo-Json -Depth 15 | Write-Output
}
if ($report.status -ne 'PASS') { exit 1 }
