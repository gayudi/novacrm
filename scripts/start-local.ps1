param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("backend", "frontend")]
  [string]$Service,
  [ValidateRange(1, 65535)]
  [int]$DatabasePort = 5432
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$nodeDirectory = Join-Path $env:ProgramFiles "nodejs"
$node = Join-Path $nodeDirectory "node.exe"
if (!(Test-Path -LiteralPath $node)) {
  throw "Install Node.js for Windows in Program Files before starting the local application."
}
$env:Path = "$nodeDirectory;$env:Path"
$major = [int]((& $node -p "process.versions.node.split('.')[0]") | Select-Object -First 1)
if ($major -lt 22) { throw "Nova CRM requires Node.js 22 or newer." }
$port = if ($Service -eq "backend") { 3000 } else { 4173 }
if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
  throw "Port $port is already in use. Stop only the existing Nova $Service process before restarting."
}

Push-Location $root
try {
  Write-Output "Starting Nova $Service using $node"
  if ($Service -eq "backend") {
    $passwordFile = Join-Path $root ".runtime\postgres-password"
    $server = Join-Path $root "backend\dist\src\server.js"
    $secretFile = Join-Path $root ".runtime\jwt-secret"
    foreach ($file in @($passwordFile, $server, $secretFile)) {
      if (!(Test-Path -LiteralPath $file)) { throw "Required local runtime file is missing: $file" }
    }
    $password = [IO.File]::ReadAllText($passwordFile).Trim()
    if (!$password) { throw "The local PostgreSQL password file is empty." }
    $env:DATABASE_URL = "postgresql://nova:$([Uri]::EscapeDataString($password))@127.0.0.1:$DatabasePort/nova_crm_local"
    $env:JWT_SECRET_FILE = $secretFile
    $env:AZURE_OPENAI_ENV_FILE = Join-Path $root ".env"
    $env:ENABLE_DEMO_DATA = "true"
    $env:NODE_ENV = "production"
    $env:PORT = "3000"
    $ErrorActionPreference = "Continue"
    & $node $server
    $ErrorActionPreference = "Stop"
  } else {
    $vite = Join-Path $root "node_modules\vite\bin\vite.js"
    if (!(Test-Path -LiteralPath (Join-Path $root "frontend\dist\index.html"))) {
      throw "Build the frontend first with npm.cmd run build --workspace frontend."
    }
    if (!(Test-Path -LiteralPath $vite)) { throw "Vite is missing. Restore project dependencies first." }
    $ErrorActionPreference = "Continue"
    & $node $vite preview (Join-Path $root "frontend") --config (Join-Path $root "frontend\vite.config.ts") --host 127.0.0.1 --port 4173 --strictPort
  }
  if ($LASTEXITCODE -ne 0) { throw "Nova $Service exited with code $LASTEXITCODE." }
} finally {
  Pop-Location
}
