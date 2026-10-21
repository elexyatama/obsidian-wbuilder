# npm replaces a junctioned node_modules with a real folder on every `npm install`,
# which would put thousands of files into OneDrive. This runs npm in an off-OneDrive
# folder instead and keeps ./node_modules as a junction pointing there.
#
#   npm run deps -- install <pkg>    any npm command, run off-OneDrive
#   npm run deps                     only repair the node_modules junction
#
# Never run a bare `npm install` in this folder.
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$NpmArgs)

$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
$store = Join-Path $env:USERPROFILE 'dev\wbuilder'
$modules = Join-Path $project 'node_modules'
$storeModules = Join-Path $store 'node_modules'

New-Item -ItemType Directory -Force $storeModules | Out-Null

if ($NpmArgs.Count -gt 0) {
	Copy-Item (Join-Path $project 'package.json') $store -Force
	$lock = Join-Path $project 'package-lock.json'
	if (Test-Path $lock) { Copy-Item $lock $store -Force }

	Push-Location $store
	try {
		& npm @NpmArgs
		if ($LASTEXITCODE -ne 0) { throw "npm exited with code $LASTEXITCODE" }
	} finally {
		Pop-Location
	}

	Copy-Item (Join-Path $store 'package.json') $project -Force
	$storeLock = Join-Path $store 'package-lock.json'
	if (Test-Path $storeLock) { Copy-Item $storeLock $project -Force }
}

$item = Get-Item $modules -Force -ErrorAction SilentlyContinue
if ($item -and -not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
	# a real folder slipped in (e.g. a bare `npm install`): move it out of OneDrive
	robocopy $modules $storeModules /MOVE /E /NFL /NDL /NJH /NJS /NP | Out-Null
	if ($LASTEXITCODE -ge 8) { throw "robocopy failed with code $LASTEXITCODE" }
	if (Test-Path $modules) { Remove-Item $modules -Recurse -Force }
	$item = $null
}
if (-not $item) {
	New-Item -ItemType Junction -Path $modules -Target $storeModules | Out-Null
}
exit 0
