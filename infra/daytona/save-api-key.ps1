$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$taskPrivateDirectory = Join-Path $taskRoot '.daytona-private'
$taskKeyPath = Join-Path $taskPrivateDirectory 'daytona-api-key'
New-Item -ItemType Directory -Path $taskPrivateDirectory -Force | Out-Null
if (Test-Path -LiteralPath $taskKeyPath) { throw 'An API key file already exists; refusing to overwrite it.' }
$taskSecureKey = Read-Host 'Paste the Daytona API key (input is hidden)' -AsSecureString
$taskKeyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($taskSecureKey)
try {
    $taskPlainKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($taskKeyPointer).Trim()
    if ([string]::IsNullOrWhiteSpace($taskPlainKey) -or $taskPlainKey.Length -gt 2048 -or $taskPlainKey -match '\s') { throw 'Invalid API key format.' }
    $taskKeyFile = [IO.File]::Open($taskKeyPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try {
        $taskKeyBytes = [Text.UTF8Encoding]::new($false).GetBytes($taskPlainKey)
        $taskKeyFile.Write($taskKeyBytes, 0, $taskKeyBytes.Length)
    } finally {
        $taskKeyFile.Dispose()
        if ($null -ne $taskKeyBytes) { [Array]::Clear($taskKeyBytes, 0, $taskKeyBytes.Length) }
    }
    Write-Host 'Saved the key locally. The key value was not printed.'
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskKeyPointer)
    $taskPlainKey = $null
    $taskSecureKey.Dispose()
}
