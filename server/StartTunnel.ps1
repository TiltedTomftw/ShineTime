$ErrorActionPreference = 'Stop'

$logPath = Join-Path $PSScriptRoot 'cloudflared.log'
if (Test-Path $logPath) {
  try {
    Remove-Item $logPath -Force
  } catch {
    try {
      $procs = Get-Process -Name cloudflared -ErrorAction SilentlyContinue
      if ($procs) {
        $procs | Stop-Process -Force
        Start-Sleep -Milliseconds 300
      }
      Remove-Item $logPath -Force
    } catch {
      $stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
      $archived = Join-Path $PSScriptRoot ("cloudflared_$stamp.log")
      Move-Item -Path $logPath -Destination $archived -Force
    }
  }
}

$args = @(
  'tunnel',
  '--url',
  'http://localhost:3000',
  '--logfile',
  $logPath,
  '--loglevel',
  'info'
)

Start-Process -FilePath 'cloudflared' -ArgumentList $args -WindowStyle Hidden

$pattern = 'https://[a-z0-9-]+\.trycloudflare\.com'
$deadline = (Get-Date).AddSeconds(30)
$url = $null

while (-not $url -and (Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 500
  if (Test-Path $logPath) {
    $match = Select-String -Path $logPath -Pattern $pattern | Select-Object -First 1
    if ($match) {
      $url = $match.Matches[0].Value
    }
  }
}

if ($url) {
  $configPath = Join-Path $PSScriptRoot '..\src\config\api.js'
  $content = Get-Content $configPath -Raw
  $content = $content -replace "const SERVER_BASE_URL = '.*?';", "const SERVER_BASE_URL = '$url';"
  Set-Content -Path $configPath -Value $content -NoNewline
  Write-Host "Updated API base to $url"
} else {
  Write-Host 'Cloudflared URL not found; please update api.js manually.'
}
