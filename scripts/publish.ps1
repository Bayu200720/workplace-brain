<#
.SYNOPSIS
  Membantu push repo Nalar ke GitHub publik.

.DESCRIPTION
  Dua jalur didukung:
   1. GitHub CLI (gh) sudah login  -> buat repo publik & push otomatis.
   2. gh belum ada / belum login   -> cetak langkah manual (create repo + PAT).

  Token tidak pernah disimpan di repo dan tidak ditulis ke file mana pun;
  kredensial disimpan oleh Windows Credential Manager (git credential.helper).
#>
param(
  [string]$Repo = "nalar-workplace-brain",
  [string]$Description = "Access-controlled workplace brain for WorkBuddy: permission-aware retrieval, field-level redaction, mandatory citations."
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Test-Gh {
  $gh = Get-Command gh -ErrorAction SilentlyContinue
  if (-not $gh) { return $null }
  $status = & gh auth status 2>&1
  if ($LASTEXITCODE -eq 0) { return $gh } else { return $null }
}

$branch = (& git rev-parse --abbrev-ref HEAD).Trim()
Write-Host "Repo lokal : $root"
Write-Host "Branch    : $branch"
Write-Host ""

$gh = Test-Gh
if ($gh) {
  Write-Host "GitHub CLI terdeteksi dan sudah login."
  & gh repo create $Repo --public --description $Description --source=. --remote=origin
  if ($LASTEXITCODE -ne 0) { throw "gagal membuat repo" }
  & gh repo edit $Repo --add-topic workbuddy --add-topic tencent-cloud --add-topic ai-agents --add-topic rag --add-topic access-control --add-topic mcp --add-topic hackathon
  & git push -u origin $branch
  Write-Host ""
  Write-Host "Selesai: https://github.com/$Repo"
  exit 0
}

Write-Host "GitHub CLI belum tersedia / belum login. Pilih salah satu:"
Write-Host ""
Write-Host "A) Pasang GitHub CLI lalu login (disarankan):"
Write-Host "   winget install --id GitHub.cli -e"
Write-Host "   gh auth login --web --git-protocol https"
Write-Host "   powershell -ExecutionPolicy Bypass -File scripts/publish.ps1"
Write-Host ""
Write-Host "B) Manual lewat browser:"
Write-Host "   1. Buka https://github.com/new  -> repo publik bernama '$Repo' (jangan centang README/.gitignore/license)"
Write-Host "   2. GitHub > Settings > Developer settings > Personal access tokens > Fine-grained tokens"
Write-Host "      (scope: repository contents read+write, limited ke repo '$Repo')"
Write-Host "   3. Simpan token di Windows Credential Manager, lalu jalankan:"
Write-Host "      git remote add origin https://github.com/<user-anda>/$Repo.git"
Write-Host "      git push -u origin $branch"
Write-Host ""
Write-Host "Jangan pernah menempel token di chat atau commit ke repo."
