# ARISE ICT HUB — database backup
# Dumps the linked Supabase project's schema + data into backups/ with a
# timestamp, gzipped. Safe to run any time (read-only).
#
# Usage:
#   npm run backup
#
# Scheduling (Windows Task Scheduler):
#   1. Open Task Scheduler → Create Basic Task
#   2. Trigger: Daily at 03:00
#   3. Action: Start a program
#      Program: powershell.exe
#      Arguments: -ExecutionPolicy Bypass -File "C:\Users\Whales\Desktop\Arise\scripts\backup.ps1"
#   4. Finish. Backups land in Arise\backups\YYYYMMDD-HHMMSS\
#
# Restore (SQL editor / psql):
#   schema + roles restore first, then data. See supabase/docs for exact steps;
#   simplest manual restore is re-running schema.sql then the data dump.
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root 'backups'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$dest = Join-Path $outDir $stamp
New-Item -ItemType Directory -Force -Path $dest | Out-Null

Write-Host "Backing up linked Supabase project -> $dest"

# Full schema (functions, tables, RLS, grants).
& npx supabase db dump --linked -f (Join-Path $dest 'schema.sql') --schema public,auth,storage
if ($LASTEXITCODE -ne 0) { throw 'Schema dump failed' }

# Data only (no DDL).
& npx supabase db dump --linked --data-only -f (Join-Path $dest 'data.sql')
if ($LASTEXITCODE -ne 0) { throw 'Data dump failed' }

# Edge function source (deployable bundle).
$fnSrc = Join-Path $root 'supabase\functions'
if (Test-Path $fnSrc) {
  Copy-Item -Recurse -Force $fnSrc (Join-Path $dest 'functions')
}

Compress-Archive -Path (Join-Path $dest '*') -DestinationPath (Join-Path $dest 'backup.zip') -Force
Get-ChildItem (Join-Path $dest 'backup.zip') | Select-Object Name, @{n='SizeKB';e={[math]::Round($_.Length/1KB,1)}}

Write-Host 'Backup complete.'
Write-Host ''
Write-Host "IMPORTANT: Supabase also keeps its own daily backups. Copy this folder to"
Write-Host 'an off-machine location (external drive / cloud) — a local copy on the same'
Write-Host 'disk is NOT a backup.'