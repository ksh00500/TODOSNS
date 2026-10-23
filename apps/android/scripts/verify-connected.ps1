param([string]$Device = 'emulator-5554')
$ErrorActionPreference = 'Stop'
if ($Device -notmatch '^emulator-\d+$') { throw 'Only a disposable emulator is supported.' }
$taskSdk = Join-Path $env:LOCALAPPDATA 'Android/Sdk'
$taskAdb = Join-Path $taskSdk 'platform-tools/adb.exe'
$taskAndroid = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskOutput = [IO.Path]::GetFullPath((Join-Path $taskAndroid '../../outputs/android/native-verification'))
New-Item -ItemType Directory -Force $taskOutput | Out-Null
function Invoke-TaskAdb {
    & $taskAdb -s $Device @args
    if ($LASTEXITCODE -ne 0) { throw "ADB failed: $($args[0])" }
}
$taskSize = (Invoke-TaskAdb shell wm size) -join "`n"
$taskDensity = (Invoke-TaskAdb shell wm density) -join "`n"
$taskScale = (Invoke-TaskAdb shell settings get system font_scale).Trim()
$taskWifi = (Invoke-TaskAdb shell settings get global wifi_on).Trim()
$taskData = (Invoke-TaskAdb shell settings get global mobile_data).Trim()
$taskPreviousSdk = $env:ANDROID_HOME
$taskExit = 0
Push-Location $taskAndroid
try {
    $env:ANDROID_HOME = $taskSdk
    Invoke-TaskAdb shell svc wifi disable
    Invoke-TaskAdb shell svc data disable
    Invoke-TaskAdb shell wm density 160
    Invoke-TaskAdb shell wm size 360x800
    Invoke-TaskAdb shell settings put system font_scale 1.0
    & ./gradlew.bat testDebugUnitTest lintDebug connectedDebugAndroidTest --offline --console=plain '-Pandroid.testInstrumentationRunnerArguments.screenshotLabel=360' *> (Join-Path $taskOutput 'connected-profile-chat.log')
    $taskExit = $LASTEXITCODE
    Get-Content -LiteralPath (Join-Path $taskOutput 'connected-profile-chat.log') | Select-Object -Last 35
    New-Item -ItemType Directory -Force (Join-Path $taskOutput '360') | Out-Null
    # Gradle may uninstall the test target after execution. The direct matrix
    # runner preserves installed APKs and pulls its screenshots separately.
} finally {
    if ($taskSize -match 'Override size: (\d+x\d+)') { Invoke-TaskAdb shell wm size $Matches[1] } else { Invoke-TaskAdb shell wm size reset }
    if ($taskDensity -match 'Override density: (\d+)') { Invoke-TaskAdb shell wm density $Matches[1] } else { Invoke-TaskAdb shell wm density reset }
    Invoke-TaskAdb shell settings put system font_scale $taskScale
    if ($taskWifi -eq '1') { Invoke-TaskAdb shell svc wifi enable }
    if ($taskData -eq '1') { Invoke-TaskAdb shell svc data enable }
    $env:ANDROID_HOME = $taskPreviousSdk
    Pop-Location
}
exit $taskExit
