# Pull the game's database backups from the own server to this computer (docs/SERVER.md, "Backups").
# The app takes a copy every day itself (BACKUP_AT) and keeps BACKUP_KEEP of them on the server; this script
# keeps a second set off the server. It needs no secrets: only the owner's SSH key (tribe@server).
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File deploy\pull-backups.ps1
#
# Registered as the daily Windows task "TRIBE backups pull" (Task Scheduler; runs on the next logon if missed).
# ASCII only on purpose: Windows PowerShell 5.1 reads a file without BOM in the ANSI code page.
param(
  [string]$Server = 'tribe@169.58.98.192',
  [string]$Dest = (Join-Path $env:USERPROFILE 'Documents\tribe-backups'),
  [int]$KeepDays = 90
)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force $Dest | Out-Null
$log = Join-Path $Dest 'pull.log'
$tmp = Join-Path $Dest 'incoming'
try {
  if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
  New-Item -ItemType Directory -Force $tmp | Out-Null
  # The pipe goes through cmd: Windows PowerShell 5.1 would re-encode a binary stream as text.
  cmd /c "ssh -o BatchMode=yes -o ConnectTimeout=20 $Server docker cp tribe-app-1:/data/backups - | tar -xf - -C `"$tmp`""
  if ($LASTEXITCODE -ne 0) { throw "ssh/tar exit code $LASTEXITCODE" }
  $got = @(Get-ChildItem (Join-Path $tmp 'backups') -Filter *.sqlite)
  if ($got.Count -eq 0) { throw 'no backups on the server' }
  foreach ($f in $got) { Move-Item -Force $f.FullName (Join-Path $Dest $f.Name) }
  Remove-Item -Recurse -Force $tmp
  Get-ChildItem $Dest -Filter *.sqlite | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$KeepDays) } | Remove-Item
  $all = @(Get-ChildItem $Dest -Filter *.sqlite)
  Add-Content $log ("{0} ok: pulled {1}, kept {2}, newest {3}" -f (Get-Date -Format s), $got.Count, $all.Count, ($all | Sort-Object Name | Select-Object -Last 1).Name)
} catch {
  Add-Content $log ("{0} FAILED: {1}" -f (Get-Date -Format s), $_.Exception.Message)
  exit 1
}
