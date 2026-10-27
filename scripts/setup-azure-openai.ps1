[CmdletBinding()]
param([switch]$CheckPrerequisites)

$ErrorActionPreference = 'Stop'
$script:ProjectRoot = Split-Path -Parent $PSScriptRoot

function Get-AzureCli {
    $command = Get-Command az -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    foreach ($base in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
        if ($base) {
            $candidate = Join-Path $base 'Microsoft SDKs\Azure\CLI2\wbin\az.cmd'
            if (Test-Path -LiteralPath $candidate) { return $candidate }
        }
    }
    return $null
}

function Invoke-AzJson {
    param([string[]]$Arguments)
    $output = & $script:AzureCli @Arguments --only-show-errors --output json
    if ($LASTEXITCODE -ne 0) { throw 'Perintah Azure gagal. Periksa pesan Azure di atas; konfigurasi tidak dianggap berhasil.' }
    if (!$output) { return $null }
    try { return ($output -join "`n" | ConvertFrom-Json) }
    catch { throw 'Azure CLI mengembalikan JSON tidak valid; output tidak ditampilkan untuk melindungi key.' }
}

function Select-Item {
    param([string]$Title, [object[]]$Items, [scriptblock]$Label)
    if (!$Items.Count) { throw "Tidak ada pilihan tersedia: $Title. Periksa region, izin dan kuota di Azure." }
    Write-Host "`n$Title" -ForegroundColor Cyan
    for ($i = 0; $i -lt $Items.Count; $i++) {
        Write-Host ("  {0}. {1}" -f ($i + 1), (& $Label $Items[$i]))
    }
    while ($true) {
        $answer = Read-Host 'Pilih nomor (Q untuk batal)'
        if ($answer -eq 'Q') { throw 'Dibatalkan pengguna; tidak melanjutkan operasi.' }
        $number = 0
        if ([int]::TryParse($answer, [ref]$number) -and $number -ge 1 -and $number -le $Items.Count) {
            return $Items[$number - 1]
        }
        Write-Warning 'Nomor pilihan tidak valid.'
    }
}

function Read-Name {
    param([string]$Label, [string]$Default, [string]$Pattern)
    $value = Read-Host "$Label [$Default]"
    if (!$value) { $value = $Default }
    if ($value -notmatch $Pattern) { throw "Format $Label tidak valid. Jalankan ulang dengan nama alfanumerik dan tanda hubung." }
    return $value
}

function Confirm-Plan {
    param([string]$Phrase)
    Write-Host "`nBelum ada resource dibuat atau konfigurasi lokal diubah."
    Write-Warning 'Inference Azure berbayar, termasuk tes singkat sesudah koneksi. Langganan Copilot tidak menanggung biaya ini.'
    Write-Host 'Periksa harga: https://azure.microsoft.com/pricing/details/cognitive-services/openai-service/'
    Write-Warning 'Capacity adalah batas throughput/kuota, BUKAN batas pengeluaran. Atur budget/alert di Azure Cost Management.'
    Write-Host 'Sesudah persetujuan, key akan disimpan lokal di .env tanpa ditampilkan. Tes hanya mengirim pesan sintetis, bukan data CRM.'
    if ((Read-Host "Ketik $Phrase untuk menyetujui rencana dan biaya; selain itu batal") -cne $Phrase) {
        throw 'Persetujuan tidak diberikan. Tidak ada perubahan Azure atau .env.'
    }
}

function Save-AzureEnvironment {
    param([string]$Path, [string]$Endpoint, [string]$Key, [string]$Deployment)
    $uri = $null
    if (![Uri]::TryCreate($Endpoint, [UriKind]::Absolute, [ref]$uri) -or $uri.Scheme -ne 'https' -or
        $uri.UserInfo -or $uri.Query -or $uri.Fragment -or $uri.AbsolutePath -notin @('/', '/openai/v1', '/openai/v1/') -or
        $Key -notmatch '^[A-Za-z0-9+/_=-]+$' -or $Deployment -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$') {
        throw 'Konfigurasi Azure tidak valid; .env tidak diubah.'
    }
    $text = ''
    if (Test-Path -LiteralPath $Path) { $text = [IO.File]::ReadAllText($Path) }
    $values = [ordered]@{
        AZURE_OPENAI_ENDPOINT = $uri.GetLeftPart([UriPartial]::Authority)
        AZURE_OPENAI_KEY = $Key
        AZURE_OPENAI_DEPLOYMENT = $Deployment
    }
    foreach ($name in $values.Keys) {
        $pattern = "(?m)^[ `t]*(?:export[ `t]+)?$name[ `t]*=[^\r\n]*"
        $line = "$name=$($values[$name])"
        if ([regex]::IsMatch($text, $pattern)) {
            $text = [regex]::Replace($text, $pattern, $line)
        } else {
            $text = $text.TrimEnd([char[]]"`r`n") + "`r`n" + $line + "`r`n"
        }
    }
    $temporary = "$Path.$([Guid]::NewGuid().ToString('N')).tmp"
    try {
        [IO.File]::WriteAllText($temporary, $text, (New-Object Text.UTF8Encoding($false)))
        if (Test-Path -LiteralPath $Path) { [IO.File]::Replace($temporary, $Path, [NullString]::Value) }
        else { [IO.File]::Move($temporary, $Path) }
    } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
    }
}

function Test-AzureConnection {
    param([string]$Endpoint, [string]$Key, [string]$Deployment)
    $body = @{
        model = $Deployment
        max_completion_tokens = 32
        messages = @(@{ role = 'user'; content = 'Connection test only. Reply with OK.' })
    } | ConvertTo-Json -Depth 5 -Compress
    try {
        $response = Invoke-RestMethod -Uri ($Endpoint.TrimEnd('/') + '/openai/v1/chat/completions') `
            -Method Post -ContentType 'application/json' -Headers @{ 'api-key' = $Key } `
            -Body $body -TimeoutSec 20 -MaximumRedirection 0
    } catch {
        $status = 'network/timeout'
        if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
        throw "Tes Azure gagal ($status). Periksa deployment, key, firewall dan kuota. Tidak ada respons provider/key ditampilkan. .env tidak diganti; resource yang sudah dibuat tetap ada."
    }
    if (!$response.choices -or !$response.choices[0].message.content -or $response.choices[0].finish_reason -ne 'stop') {
        throw 'Azure tidak mengembalikan jawaban chat yang lengkap. .env tidak diganti; periksa model di Foundry.'
    }
    Write-Host 'Tes inference sintetis berhasil. Tidak ada data CRM yang dikirim.' -ForegroundColor Green
}

function Invoke-AzureSetup {
    $script:AzureCli = Get-AzureCli
    if (!$script:AzureCli) {
        Write-Host 'Azure CLI belum terpasang. Wizard memerlukan Microsoft Azure CLI.'
        if (!(Get-Command winget -ErrorAction SilentlyContinue)) {
            throw 'Instal Azure CLI dari https://learn.microsoft.com/cli/azure/install-azure-cli-windows lalu jalankan wizard lagi.'
        }
        if ((Read-Host 'Ketik INSTALL untuk menjalankan winget Microsoft.AzureCLI (mungkin meminta izin Windows); selain itu batal') -cne 'INSTALL') {
            throw 'Instalasi dibatalkan. Tidak ada resource Azure dibuat.'
        }
        & winget install --exact --id Microsoft.AzureCLI --source winget
        if ($LASTEXITCODE -ne 0) { throw 'Instalasi Azure CLI gagal. Buka terminal baru sesudah instalasi dan jalankan ulang wizard.' }
        $script:AzureCli = Get-AzureCli
        if (!$script:AzureCli) { throw 'Azure CLI belum ditemukan. Buka terminal baru lalu jalankan ulang wizard.' }
    }

    Write-Host 'Login Azure melalui device code. Selesaikan login di browser; jangan kirim kode/key ke chat.' -ForegroundColor Cyan
    & $script:AzureCli login --use-device-code --output none
    if ($LASTEXITCODE -ne 0) { throw 'Login Azure gagal atau dibatalkan.' }
    $subscriptions = @(Invoke-AzJson @('account', 'list') | Where-Object { $_.state -eq 'Enabled' })
    $subscription = Select-Item 'Subscription yang akan digunakan' $subscriptions { param($item) "$($item.name) [$($item.id)]" }
    $sub = @('--subscription', $subscription.id)
    $mode = Select-Item 'Cara konfigurasi' @('Gunakan deployment yang sudah ada', 'Buat resource dan deployment baru') { param($item) $item }
    $accounts = @(Invoke-AzJson (@('cognitiveservices', 'account', 'list') + $sub) | Where-Object { $_.kind -eq 'OpenAI' })

    if ($mode -eq 'Gunakan deployment yang sudah ada') {
        $account = Select-Item 'Resource Azure OpenAI' $accounts { param($item) "$($item.name) / $($item.resourceGroup) / $($item.location)" }
        $group = $account.resourceGroup
        $name = $account.name
        $deployments = @(Invoke-AzJson (@('cognitiveservices', 'account', 'deployment', 'list', '--resource-group', $group, '--name', $name) + $sub) |
            Where-Object { $_.properties.provisioningState -eq 'Succeeded' -and $_.properties.model.name -in @('gpt-4.1-mini', 'gpt-4o-mini') })
        $existing = Select-Item 'Deployment chat mini yang kompatibel' $deployments { param($item) "$($item.name) / $($item.properties.model.name) / $($item.sku.name)" }
        $deployment = $existing.name
        Write-Host "`nRencana: subscription $($subscription.name), resource $name, deployment $deployment."
        Write-Host 'Resource/deployment yang sudah ada tidak akan dimodifikasi. Hanya tes inference dan penggantian tiga konfigurasi Azure lokal.'
        Confirm-Plan 'CONNECT'
    } else {
        $regions = @(Invoke-AzJson (@('account', 'list-locations') + $sub) | Sort-Object displayName)
        $region = Select-Item 'Region (ketersediaan model dan kuota berbeda tiap region)' $regions { param($item) "$($item.displayName) [$($item.name)]" }
        $models = @(Invoke-AzJson (@('cognitiveservices', 'model', 'list', '--location', $region.name) + $sub) |
            Where-Object { $_.kind -eq 'OpenAI' -and $_.model.format -eq 'OpenAI' -and
                $_.model.name -in @('gpt-4.1-mini', 'gpt-4o-mini') -and $_.model.lifecycleStatus -notin @('Deprecated', 'Deprecating', 'Legacy') -and
                @($_.model.skus | Where-Object { $_.name -in @('Standard', 'GlobalStandard') }).Count -gt 0 } |
            Sort-Object { $_.model.name }, { $_.model.version })
        $model = (Select-Item 'Model siap pakai (tidak ada training)' $models { param($item) "$($item.model.name) / $($item.model.version) / $($item.model.lifecycleStatus)" }).model
        if (!$model.version) { throw 'Azure tidak memberikan versi model. Tidak dapat membuat rencana deployment yang pasti.' }
        $skus = @($model.skus | Where-Object { $_.name -in @('Standard', 'GlobalStandard') } | Sort-Object name)
        Write-Warning 'GlobalStandard dapat memproses inference lintas region. Pilih sesuai kebijakan lokasi data perusahaan.'
        $sku = Select-Item 'Jenis deployment pay-as-you-go (bukan PTU)' $skus { param($item) $item.name }
        if (!$sku.capacity -or $null -eq $sku.capacity.minimum) { throw 'Azure tidak memberikan batas minimum capacity untuk SKU ini.' }
        $capacity = [Math]::Max(1, [int]$sku.capacity.minimum)
        $group = Read-Name 'Resource group' 'rg-nova-copilot' '^[A-Za-z0-9_-]{1,80}$'
        $name = Read-Name 'Nama resource unik' ("nova-copilot-" + [Guid]::NewGuid().ToString('N').Substring(0, 12)) '^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$'
        $deployment = Read-Name 'Nama deployment' 'crm-copilot' '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
        if (@($accounts | Where-Object { $_.name -eq $name }).Count) { throw 'Nama resource sudah ada. Gunakan mode deployment yang sudah ada; wizard tidak menimpanya.' }
        $groupExists = Invoke-AzJson (@('group', 'exists', '--name', $group) + $sub)
        Write-Host "`nRENCANA DEPLOYMENT" -ForegroundColor Cyan
        Write-Host "Subscription : $($subscription.name) [$($subscription.id)]"
        Write-Host "Region       : $($region.name)"
        Write-Host "Group        : $group (sudah ada: $groupExists)"
        Write-Host "Resource     : $name (OpenAI S0)"
        Write-Host "Deployment   : $deployment"
        Write-Host "Model        : $($model.name) / $($model.version)"
        Write-Host "SKU/capacity : $($sku.name) / $capacity (minimum)"
        Write-Warning 'Endpoint publik dengan autentikasi API key digunakan untuk preview lokal. Kebijakan Azure dapat menolaknya; gunakan jaringan privat untuk kebutuhan produksi.'
        Write-Warning 'Katalog model tidak menjamin kuota/capacity subscription. Jika provisioning gagal, wizard berhenti dan resource parsial TIDAK otomatis dihapus.'
        Confirm-Plan 'DEPLOY'

        $null = Invoke-AzJson (@('provider', 'register', '--namespace', 'Microsoft.CognitiveServices', '--wait') + $sub)
        if (!$groupExists) { $null = Invoke-AzJson (@('group', 'create', '--name', $group, '--location', $region.name) + $sub) }
        $account = Invoke-AzJson (@('cognitiveservices', 'account', 'create', '--name', $name, '--resource-group', $group,
            '--location', $region.name, '--kind', 'OpenAI', '--sku', 'S0', '--custom-domain', $name, '--yes') + $sub)
        $created = Invoke-AzJson (@('cognitiveservices', 'account', 'deployment', 'create', '--name', $name,
            '--resource-group', $group, '--deployment-name', $deployment, '--model-format', 'OpenAI',
            '--model-name', $model.name, '--model-version', $model.version, '--sku-name', $sku.name, '--sku-capacity', "$capacity") + $sub)
        if ($created.properties.provisioningState -ne 'Succeeded') {
            throw "Deployment belum siap ($($created.properties.provisioningState)). Periksa Foundry, lalu jalankan mode deployment yang sudah ada; .env belum diganti."
        }
    }
    $endpoint = $account.properties.endpoint
    $uri = $null
    if (![Uri]::TryCreate($endpoint, [UriKind]::Absolute, [ref]$uri) -or $uri.Scheme -ne 'https' -or
        $uri.UserInfo -or $uri.Query -or $uri.Fragment -or $uri.AbsolutePath -ne '/') {
        throw 'Azure tidak memberikan endpoint HTTPS root yang didukung. Key belum diambil.'
    }
    $key = Invoke-AzJson (@('cognitiveservices', 'account', 'keys', 'list', '--resource-group', $group, '--name', $name, '--query', 'key1') + $sub)
    try {
        Test-AzureConnection $endpoint $key $deployment
        Save-AzureEnvironment (Join-Path $script:ProjectRoot '.env') $endpoint $key $deployment
    } finally { $key = $null }
    Write-Host "`nSelesai: tiga variabel Azure tersimpan di .env; konfigurasi database/JWT tidak diubah." -ForegroundColor Green
    Write-Host 'Preview lokal yang dijalankan melalui backend\start.mjs: buka Copilot > Check again (tidak perlu restart).'
    Write-Host 'Docker: jalankan docker compose up -d --build backend, lalu docker compose restart frontend.'
    Write-Host 'Standalone npm dev/start: restart backend dengan AZURE_OPENAI_ENV_FILE menunjuk ke .env ini, atau isi tiga variabel pada environment proses.'
    Write-Host 'Atur budget/alert Azure. Jika tidak dipakai, hapus deployment/resource yang dibuat melalui Azure Portal setelah memastikan tidak dipakai aplikasi lain.'
}

if ($MyInvocation.InvocationName -ne '.') {
    if ($CheckPrerequisites) {
        [pscustomobject]@{
            AzureCliReady = [bool](Get-AzureCli)
            WingetReady = [bool](Get-Command winget -ErrorAction SilentlyContinue)
            EnvironmentFileExists = Test-Path -LiteralPath (Join-Path $script:ProjectRoot '.env')
            CloudChangesMade = $false
        }
    } else {
        try { Invoke-AzureSetup }
        catch { Write-Error -Message $_.Exception.Message -ErrorAction Continue; exit 1 }
    }
}
