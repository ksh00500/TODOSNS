param([string]$Device = "emulator-5554", [string[]]$Cases = @('360', '390', '430', '360-low', '360-font200', 'google-low', 'google-font200', 'profile-low', 'profile-font200'))
$ErrorActionPreference = "Stop"
if ($Device -notmatch '^emulator-\d+$') { throw 'This script only changes a disposable emulator, never a physical device.' }
$androidSdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
$adb = Join-Path $androidSdk 'platform-tools\adb.exe'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$output = Join-Path $repo 'outputs\android\native-verification'
New-Item -ItemType Directory -Force $output | Out-Null
function Invoke-Adb {
    & $adb -s $Device @args
    if ($LASTEXITCODE -ne 0) { throw "ADB failed: $($args[0])" }
}
$originalSize = (Invoke-Adb shell wm size) -join "`n"
$originalDensity = (Invoke-Adb shell wm density) -join "`n"
$originalScale = (Invoke-Adb shell settings get system font_scale).Trim()
$originalWifi = (Invoke-Adb shell settings get global wifi_on).Trim()
$originalData = (Invoke-Adb shell settings get global mobile_data).Trim()
$originalSdk = $env:ANDROID_HOME
try {
    # Both APKs must come from the same source revision. assembleDebugAndroidTest
    # alone compiles the target but can leave an older app-debug.apk on disk.
    $env:ANDROID_HOME = $androidSdk
    Push-Location $PSScriptRoot
    try {
        & ./gradlew.bat assembleDebug assembleDebugAndroidTest --offline --console=plain *> (Join-Path $output 'matrix-apk-build.log')
        if ($LASTEXITCODE -ne 0) { throw 'Building the matching application and test APKs failed; see matrix-apk-build.log.' }
    } finally { Pop-Location }
    # Loopback MockWebServer works offline. Pause emulator Internet during synthetic
    # tests so Play auto-updates cannot interfere and no test can reach a live API.
    Invoke-Adb shell svc wifi disable
    Invoke-Adb shell svc data disable
    Invoke-Adb install -r (Join-Path $PSScriptRoot 'app\build\outputs\apk\debug\app-debug.apk')
    Invoke-Adb install -r (Join-Path $PSScriptRoot 'app\build\outputs\apk\androidTest\debug\app-debug-androidTest.apk')
    # At density 160, emulator pixels equal dp. All HTTP calls originate from test-local MockWebServer.
    Invoke-Adb shell wm density 160
    $runs = @(
        @{ Name='360'; Width=360; Height=800; Scale='1.0'; Class='kr.kro.mungsil.NativeFlowTest' },
        @{ Name='390'; Width=390; Height=844; Scale='1.0'; Class='kr.kro.mungsil.NativeFlowTest' },
        @{ Name='430'; Width=430; Height=932; Scale='1.0'; Class='kr.kro.mungsil.NativeFlowTest' },
        @{ Name='360-low'; Width=360; Height=400; Scale='1.0'; Class='kr.kro.mungsil.NativeFlowTest#todoFailurePreservesDraftAndRetryIdentityThenCompletesAndPublishes' },
        @{ Name='360-font200'; Width=360; Height=800; Scale='2.0'; Class='kr.kro.mungsil.NativeFlowTest#loginStaysNativeAndAllFiveTabsRenderAtDeviceWidth' },
        @{ Name='google-low'; Width=360; Height=400; Scale='1.0'; Class='kr.kro.mungsil.NativeFlowTest#googleSignupCollectsProfileBeforeCreatingServerSession' },
        @{ Name='google-font200'; Width=360; Height=800; Scale='2.0'; Class='kr.kro.mungsil.NativeFlowTest#googleSignupCollectsProfileBeforeCreatingServerSession' },
        @{ Name='profile-low'; Width=360; Height=400; Scale='1.0'; Class='kr.kro.mungsil.NativeFlowTest#profileLongContentAndEmptyRecordsRemainUsable' },
        @{ Name='profile-font200'; Width=360; Height=800; Scale='2.0'; Class='kr.kro.mungsil.NativeFlowTest#profileLongContentAndEmptyRecordsRemainUsable' },
        @{ Name='chat-photos'; Width=360; Height=800; Scale='1.0'; Class='kr.kro.mungsil.NativeFlowTest#fourChatPhotosSurviveRestoreAndFailedSendWithoutReupload' },
        @{ Name='chat-media'; Width=360; Height=800; Scale='1.0'; Class='kr.kro.mungsil.NativeFlowTest#chatPhotosOpenOriginalAndLinksUseOnlyAllowedSchemes' },
        @{ Name='todo-group'; Width=360; Height=800; Scale='1.0'; Class='kr.kro.mungsil.NativeFlowTest#groupSearchPagingKeepsSelectionAndPublicScopeAfterRestoreAndFailedSave,kr.kro.mungsil.NativeFlowTest#repeatingTodoKeepsExactScheduleAndUnavailableRelationsOnRetryAfterRestore,kr.kro.mungsil.NativeFlowTest#categoryOrderAccessibleMovesAndFailedSaveKeepDraftAndRequestIdentity,kr.kro.mungsil.NativeFlowTest#categoryTodoPagingDedupeStatusAndScheduleUseAccountDate,kr.kro.mungsil.NativeFlowTest#todoDeleteRestoreAndSeriesEndKeepOtherDatesAndExplainRecordLoss' },
        @{ Name='group-low'; Width=360; Height=400; Scale='1.0'; Class='kr.kro.mungsil.NativeFlowTest#groupSearchPagingKeepsSelectionAndPublicScopeAfterRestoreAndFailedSave' },
        @{ Name='group-font200'; Width=360; Height=800; Scale='2.0'; Class='kr.kro.mungsil.NativeFlowTest#groupSearchPagingKeepsSelectionAndPublicScopeAfterRestoreAndFailedSave' },
        @{ Name='todo-repeat-low'; Width=360; Height=400; Scale='1.0'; Class='kr.kro.mungsil.NativeFlowTest#repeatingTodoKeepsExactScheduleAndUnavailableRelationsOnRetryAfterRestore' },
        @{ Name='todo-repeat-font200'; Width=360; Height=800; Scale='2.0'; Class='kr.kro.mungsil.NativeFlowTest#repeatingTodoKeepsExactScheduleAndUnavailableRelationsOnRetryAfterRestore' },
        @{ Name='public-profile'; Width=360; Height=800; Scale='1.0'; Class='kr.kro.mungsil.NativeFlowTest#publicRelationshipFailureRetryAndNewActionUseDistinctKeys,kr.kro.mungsil.NativeFlowTest#publicSelfAndBlockedAccessNeverOfferInvalidRelationshipActions,kr.kro.mungsil.NativeFlowTest#connectionsPagingRetryDedupeAndDirectionKeepUnavailableUsersSafe,kr.kro.mungsil.NativeFlowTest#blockAndUnblockFailuresKeepConfirmationAndDoNotRestoreFollowOrDeleteHistory' },
        @{ Name='public-profile-low'; Width=360; Height=400; Scale='1.0'; Class='kr.kro.mungsil.NativeFlowTest#publicSelfAndBlockedAccessNeverOfferInvalidRelationshipActions' },
        @{ Name='public-profile-font200'; Width=360; Height=800; Scale='2.0'; Class='kr.kro.mungsil.NativeFlowTest#publicSelfAndBlockedAccessNeverOfferInvalidRelationshipActions' },
        @{ Name='publish-search360'; Width=360; Height=800; Scale='1.0'; Class='kr.kro.mungsil.PublishSearchFlowTest' },
        @{ Name='publish-search390'; Width=390; Height=844; Scale='1.0'; Class='kr.kro.mungsil.PublishSearchFlowTest' },
        @{ Name='publish-search430'; Width=430; Height=932; Scale='1.0'; Class='kr.kro.mungsil.PublishSearchFlowTest' },
        @{ Name='publish-low'; Width=360; Height=400; Scale='1.0'; Class='kr.kro.mungsil.PublishSearchFlowTest#publicationKeepsFailedPhotoDraftAndRequestIdentityAcrossRestore' },
        @{ Name='publish-font200'; Width=360; Height=800; Scale='2.0'; Class='kr.kro.mungsil.PublishSearchFlowTest#publicationKeepsFailedPhotoDraftAndRequestIdentityAcrossRestore' },
        @{ Name='search-low'; Width=360; Height=400; Scale='1.0'; Class='kr.kro.mungsil.PublishSearchFlowTest#searchTypesRecentQueriesAndRestoredDraftMatchWebFlows' },
        @{ Name='search-font200'; Width=360; Height=800; Scale='2.0'; Class='kr.kro.mungsil.PublishSearchFlowTest#searchTypesRecentQueriesAndRestoredDraftMatchWebFlows' },
        @{ Name='publish-existing'; Width=360; Height=800; Scale='1.0'; Class='kr.kro.mungsil.NativeFlowTest#todoFailurePreservesDraftAndRetryIdentityThenCompletesAndPublishes,kr.kro.mungsil.NativeFlowTest#groupCreationPublishingAndDeletionUseExistingContractsAndKeepTodos,kr.kro.mungsil.NativeFlowTest#completionRollbackKeepsRetryKeyButNewCompletionUsesNewKey' },
        @{ Name='parity360'; Width=360; Height=800; Scale='1.0'; Class='kr.kro.mungsil.NativeFlowTest#parityScreensUseSharedSyntheticFixture' },
        @{ Name='parity390'; Width=390; Height=844; Scale='1.0'; Class='kr.kro.mungsil.NativeFlowTest#parityScreensUseSharedSyntheticFixture' },
        @{ Name='parity430'; Width=430; Height=932; Scale='1.0'; Class='kr.kro.mungsil.NativeFlowTest#parityScreensUseSharedSyntheticFixture' },
        @{ Name='challenge360'; Width=360; Height=800; Scale='1.0'; Class='kr.kro.mungsil.ChallengeFlowTest' },
        @{ Name='challenge390'; Width=390; Height=844; Scale='1.0'; Class='kr.kro.mungsil.ChallengeFlowTest' },
        @{ Name='challenge430'; Width=430; Height=932; Scale='1.0'; Class='kr.kro.mungsil.ChallengeFlowTest' },
        @{ Name='challenge-checkin-low'; Width=360; Height=400; Scale='1.0'; Class='kr.kro.mungsil.ChallengeFlowTest#resubmissionNeedsPhotoAndRestoresDraftAndFailedRequestKey' },
        @{ Name='challenge-checkin-font200'; Width=360; Height=800; Scale='2.0'; Class='kr.kro.mungsil.ChallengeFlowTest#resubmissionNeedsPhotoAndRestoresDraftAndFailedRequestKey' },
        @{ Name='challenge-review-low'; Width=360; Height=400; Scale='1.0'; Class='kr.kro.mungsil.ChallengeFlowTest#reviewPhotoFailureRetryAndSavedVoteDoNotLeakIntoNewAttempt' },
        @{ Name='challenge-review-font200'; Width=360; Height=800; Scale='2.0'; Class='kr.kro.mungsil.ChallengeFlowTest#reviewPhotoFailureRetryAndSavedVoteDoNotLeakIntoNewAttempt' },
        @{ Name='challenge-composer-low'; Width=360; Height=400; Scale='1.0'; Class='kr.kro.mungsil.ChallengeFlowTest#composerRestoresFailedCreationAndBlocksEditsDuringSave' },
        @{ Name='challenge-composer-font200'; Width=360; Height=800; Scale='2.0'; Class='kr.kro.mungsil.ChallengeFlowTest#composerRestoresFailedCreationAndBlocksEditsDuringSave' },
        @{ Name='challenge-existing'; Width=360; Height=800; Scale='1.0'; Class='kr.kro.mungsil.NativeFlowTest#challengeEditorUsesAccountDateWithoutChangingOriginalInstants,kr.kro.mungsil.NativeFlowTest#challengeTextEditPreservesOriginalScheduleAndRewardFields,kr.kro.mungsil.NativeFlowTest#verificationMovesOneCriterionAtATimeAndPreservesFailedVote' }
    )
    foreach ($run in $runs) {
        if ($run.Name -notin $Cases) { continue }
        Invoke-Adb shell wm size "$($run.Width)x$($run.Height)"
        Invoke-Adb shell settings put system font_scale $run.Scale
        $result = Invoke-Adb shell am instrument -w -r -e screenshotLabel $run.Name -e class $run.Class kr.kro.mungsil.test/androidx.test.runner.AndroidJUnitRunner
        $result | Set-Content (Join-Path $output "$($run.Name)-tests.txt")
        $destination = Join-Path $output $run.Name
        New-Item -ItemType Directory -Force $destination | Out-Null
        try { Invoke-Adb pull "/sdcard/Android/data/kr.kro.mungsil/files/native-verification/$($run.Name)/." $destination }
        catch { Write-Warning "No screenshots were available for $($run.Name). The instrumentation result is saved." }
        if (($result -join "`n") -notmatch 'OK \(\d+ tests?\)') { throw "Native tests failed for $($run.Name); see output log and captured screens." }
        Write-Output "PASS: $($run.Name)"
    }
} finally {
    $env:ANDROID_HOME = $originalSdk
    if ($originalSize -match 'Override size: (\d+x\d+)') { Invoke-Adb shell wm size $Matches[1] } else { Invoke-Adb shell wm size reset }
    if ($originalDensity -match 'Override density: (\d+)') { Invoke-Adb shell wm density $Matches[1] } else { Invoke-Adb shell wm density reset }
    Invoke-Adb shell settings put system font_scale $originalScale
    if ($originalWifi -eq '1') { Invoke-Adb shell svc wifi enable }
    if ($originalData -eq '1') { Invoke-Adb shell svc data enable }
}
