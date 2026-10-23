param(
    [Parameter(Mandatory=$true)][string]$Jdk,
    [int]$VersionCode = 5,
    [string]$VersionName = '1.2.0',
    [string]$UploadSha1 = 'B7:FB:58:CC:71:05:5C:0A:14:A5:C5:2E:64:DE:9E:A9:74:B4:B5:4D'
)
$ErrorActionPreference = 'Stop'
$repoTask = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
$outputTask = Join-Path $repoTask 'outputs\android'
$sourceTask = Join-Path $PSScriptRoot '..\app\build\outputs\bundle\release\app-release.aab'
$bundleTask = Join-Path $outputTask "mungsil-native-$VersionName-$VersionCode.aab"
New-Item -ItemType Directory -Force $outputTask | Out-Null
Copy-Item -LiteralPath $sourceTask -Destination $bundleTask
$signatureTask = & (Join-Path $Jdk 'bin\jarsigner.exe') '-J-Duser.language=en' -verify $bundleTask 2>&1
$signatureResultTask = $LASTEXITCODE
$signatureTask | Set-Content (Join-Path $outputTask "signature-$VersionName-$VersionCode.txt")
if ($signatureResultTask -ne 0 -or ($signatureTask -join "`n") -notmatch 'jar verified') { throw 'Bundle signature verification failed.' }
$certificateTask = & (Join-Path $Jdk 'bin\keytool.exe') '-J-Duser.language=en' -printcert -jarfile $bundleTask 2>&1
if ($LASTEXITCODE -ne 0 -or ($certificateTask -join "`n") -notmatch [regex]::Escape($UploadSha1)) { throw 'The existing upload certificate does not match.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archiveTask = [IO.Compression.ZipFile]::OpenRead($bundleTask)
$manifestTask = Join-Path $outputTask "manifest-$VersionName-$VersionCode.pb"
try {
    $assetsTask = @($archiveTask.Entries | Where-Object FullName -Like 'base/assets/*' | ForEach-Object FullName)
    $forbiddenTask = @($archiveTask.Entries | Where-Object { $_.FullName -match '(?i)adminsdk|\.jks$|\.keystore$|android-parity\.json|keystore\.properties|private_key' })
    if ($forbiddenTask.Count -gt 0) { throw 'Test fixtures or private signing/admin files are present in the bundle.' }
    $entryTask = $archiveTask.GetEntry('base/manifest/AndroidManifest.xml')
    if ($null -eq $entryTask) { throw 'Bundle manifest is missing.' }
    $inputTask = $entryTask.Open()
    $fileTask = [IO.File]::Create($manifestTask)
    try { $inputTask.CopyTo($fileTask) } finally { $fileTask.Dispose(); $inputTask.Dispose() }
} finally { $archiveTask.Dispose() }
& node (Join-Path $PSScriptRoot 'check-bundle-manifest.cjs') $manifestTask $VersionCode $VersionName
if ($LASTEXITCODE -ne 0) { throw 'Bundle package, version or SDK values are incorrect.' }
$metadataTask = [ordered]@{
    verifiedAt = (Get-Date).ToString('o')
    path = $bundleTask
    versionCode = $VersionCode
    versionName = $VersionName
    package = 'kr.kro.mungsil'
    minSdk = 24
    targetSdk = 36
    sha256 = (Get-FileHash -LiteralPath $bundleTask -Algorithm SHA256).Hash
    bytes = (Get-Item -LiteralPath $bundleTask).Length
    signature = 'jar verified'
    uploadKeySha1 = $UploadSha1
    assets = $assetsTask
    excludedTestFixturesAndPrivateKeys = $true
}
$metadataTask | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $outputTask "release-$VersionName-$VersionCode-verification.json")
$metadataTask | ConvertTo-Json -Depth 4
