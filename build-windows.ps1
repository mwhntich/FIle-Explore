param([string]$OutputDirectory = (Join-Path $PSScriptRoot 'dist'))

$ErrorActionPreference = 'Stop'
$project = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$electron = Join-Path $project 'node_modules\electron\dist'
$vendor = Join-Path $project 'node_modules\electron-winstaller\vendor'
$compiler = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (!(Test-Path -LiteralPath (Join-Path $electron 'electron.exe'))) { throw 'Run npm install first.' }
if (!(Test-Path -LiteralPath (Join-Path $vendor 'rcedit.exe'))) { throw 'electron-winstaller is missing; run npm install.' }
if (!(Test-Path -LiteralPath $compiler)) { throw '.NET Framework C# compiler is missing.' }

$stage = Join-Path $env:TEMP ('FilesBuild-' + [Guid]::NewGuid().ToString('N'))
$payload = Join-Path $env:TEMP ('FilesPayload-' + [Guid]::NewGuid().ToString('N') + '.zip')
$output = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $stage,$output -Force | Out-Null
try {
    Copy-Item -Path (Join-Path $electron '*') -Destination $stage -Recurse -Force
    $app = Join-Path $stage 'resources\app'
    New-Item -ItemType Directory -Path (Join-Path $app 'assets') -Force | Out-Null
    $files = @('package.json','main.js','file-ops.js','preload.js','index.html','renderer.js','style.css','overlay.html','overlay.js','overlay-preload.js','README.md','LICENSE')
    foreach ($file in $files) { Copy-Item -LiteralPath (Join-Path $project $file) -Destination $app -Force }
    Copy-Item -LiteralPath (Join-Path $project 'assets\icon.ico') -Destination (Join-Path $app 'assets') -Force
    Rename-Item -LiteralPath (Join-Path $stage 'electron.exe') -NewName 'Files.exe'
    Rename-Item -LiteralPath (Join-Path $stage 'electron_wer.dll') -NewName 'Files_wer.dll'
    & (Join-Path $vendor 'rcedit.exe') (Join-Path $stage 'Files.exe') --set-icon (Join-Path $project 'assets\icon.ico') --set-version-string ProductName 'Files' --set-version-string FileDescription 'Files - independent file manager' --set-file-version '1.0.0' --set-product-version '1.0.0'
    if ($LASTEXITCODE -ne 0) { throw 'Could not apply the app icon.' }
    $uninstaller = Join-Path $stage 'Uninstall Files.exe'
    & $compiler /nologo /target:winexe /optimize+ ('/out:'+$uninstaller) ('/win32icon:'+(Join-Path $project 'assets\icon.ico')) /r:System.Windows.Forms.dll (Join-Path $project 'installer\Uninstall.cs')
    if ($LASTEXITCODE -ne 0) { throw 'Could not compile the uninstaller.' }
    Push-Location $stage
    try { & (Join-Path $vendor '7z.exe') a -tzip -mx=5 $payload '.\*' }
    finally { Pop-Location }
    if ($LASTEXITCODE -ne 0) { throw 'Could not package the app.' }
    $setup = Join-Path $output 'Files-Setup-1.0.0.exe'
    & $compiler /nologo /target:winexe /optimize+ ('/out:'+$setup) ('/win32icon:'+(Join-Path $project 'assets\icon.ico')) /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Core.dll /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll ('/resource:'+$payload+',FilesPayload') (Join-Path $project 'installer\Setup.cs')
    if ($LASTEXITCODE -ne 0) { throw 'Could not compile the installer.' }
    Write-Output "Created $setup"
}
finally {
    $tempRoot = [IO.Path]::GetFullPath($env:TEMP).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    $resolvedStage = [IO.Path]::GetFullPath($stage)
    if ($resolvedStage.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path $resolvedStage -Leaf).StartsWith('FilesBuild-')) {
        if (Test-Path -LiteralPath $resolvedStage) { Remove-Item -LiteralPath $resolvedStage -Recurse -Force }
    }
    if ((Test-Path -LiteralPath $payload) -and ([IO.Path]::GetFullPath($payload)).StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) { Remove-Item -LiteralPath $payload -Force }
}
