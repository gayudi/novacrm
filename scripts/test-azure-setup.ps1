$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'setup-azure-openai.ps1')

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (!$Condition) { throw "Assertion failed: $Message" }
}

$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) ("nova-azure-test-" + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $temporaryRoot
$environmentPath = Join-Path $temporaryRoot '.env'
try {
    $original = "# keep this comment`r`nDATABASE_URL=synthetic-db`r`nJWT_SECRET=keep-jwt`r`nAZURE_OPENAI_ENDPOINT=`r`nAZURE_OPENAI_KEY=`r`nAZURE_OPENAI_DEPLOYMENT=`r`n"
    [IO.File]::WriteAllText($environmentPath, $original)
    Save-AzureEnvironment $environmentPath 'https://example.openai.azure.com/' 'synthetic-key' 'crm-copilot'
    $saved = [IO.File]::ReadAllText($environmentPath)
    Assert-True ($saved.Contains('DATABASE_URL=synthetic-db') -and $saved.Contains('JWT_SECRET=keep-jwt') -and $saved.Contains('# keep this comment')) 'Unrelated configuration preserved'
    Assert-True ($saved.Contains('AZURE_OPENAI_DEPLOYMENT=crm-copilot')) 'Azure deployment persisted'
    Save-AzureEnvironment $environmentPath 'https://example.openai.azure.com/' 'rotated-synthetic-key' 'crm-copilot'
    Assert-True (([regex]::Matches([IO.File]::ReadAllText($environmentPath), '(?m)^AZURE_OPENAI_KEY=')).Count -eq 1) 'No duplicate setting after reconnect'
    $rejected = $false
    try { Save-AzureEnvironment $environmentPath 'http://example.com' 'key' 'model' } catch { $rejected = $true }
    Assert-True $rejected 'Non-HTTPS endpoint rejected before file changes'
    Assert-True ([IO.File]::ReadAllText($environmentPath).Contains('rotated-synthetic-key')) 'Rejected configuration preserves prior key'
    Assert-True (@(Get-ChildItem -LiteralPath $temporaryRoot -Force).Count -eq 1) 'No temporary secret files remain'

    function Invoke-ConnectionTests {
        $fail = $false
        function Invoke-RestMethod {
            param($Uri, $Method, $ContentType, $Headers, $Body, $TimeoutSec, $MaximumRedirection)
            Assert-True ($Uri -eq 'https://example.openai.azure.com/openai/v1/chat/completions') 'Azure v1 URL'
            Assert-True ($Method -eq 'Post' -and $MaximumRedirection -eq 0 -and $TimeoutSec -eq 20) 'Bounded request without redirects'
            $payload = $Body | ConvertFrom-Json
            Assert-True ($payload.max_completion_tokens -eq 32 -and $payload.messages.Count -eq 1) 'Small synthetic test only'
            Assert-True ($payload.messages[0].content -eq 'Connection test only. Reply with OK.') 'No CRM data in test'
            if ($fail) { throw 'Provider error with synthetic-secret-must-not-leak' }
            return @{ choices = @(@{ message = @{ content = 'OK' }; finish_reason = 'stop' }) }
        }
        $null = Test-AzureConnection 'https://example.openai.azure.com/' 'synthetic-key' 'test-model' 6>&1
        $fail = $true
        $caught = $false
        try { Test-AzureConnection 'https://example.openai.azure.com/' 'synthetic-key' 'test-model' }
        catch {
            $caught = $true
            Assert-True (!$_.Exception.Message.Contains('synthetic-secret-must-not-leak')) 'Provider error details suppressed'
        }
        Assert-True $caught 'Failed connection is reported'
    }
    Invoke-ConnectionTests

    function Invoke-MockedScenario {
        param([string]$Mode, [string]$Consent, [switch]$DeploymentFails, [switch]$ConnectionFails)
        $script:ProjectRoot = $temporaryRoot
        [IO.File]::WriteAllText($environmentPath, $original)
        $commands = New-Object 'System.Collections.Generic.List[string]'
        $answers = New-Object 'System.Collections.Generic.Queue[string]'
        if ($Mode -eq 'new') {
            foreach ($answer in @('1', '2', '1', '1', '1', '', '', '', $Consent)) { $answers.Enqueue($answer) }
        } else {
            foreach ($answer in @('1', '1', '1', '1', $Consent)) { $answers.Enqueue($answer) }
        }
        function Read-Host { param($Prompt); if (!$answers.Count) { throw "Unexpected prompt: $Prompt" }; return $answers.Dequeue() }
        function Get-AzureCli { return 'Invoke-FakeAzureCli' }
        function Invoke-FakeAzureCli { $global:LASTEXITCODE = 0 }
        function Invoke-AzJson {
            param([string[]]$Arguments)
            $command = $Arguments -join ' '
            $commands.Add($command)
            if ($command -eq 'account list') { return @([pscustomobject]@{ id = 'synthetic-sub'; name = 'Test subscription'; state = 'Enabled' }) }
            Assert-True ($command.Contains('--subscription synthetic-sub')) 'Explicit subscription on Azure commands'
            if ($command.StartsWith('account list-locations ')) { return @([pscustomobject]@{ name = 'eastus'; displayName = 'East US' }) }
            if ($command.StartsWith('cognitiveservices account list ')) {
                if ($Mode -eq 'new') { return @() }
                return @([pscustomobject]@{ name = 'existing'; kind = 'OpenAI'; resourceGroup = 'existing-group'; location = 'eastus'; properties = @{ endpoint = 'https://example.openai.azure.com/' } })
            }
            if ($command.StartsWith('cognitiveservices model list ')) {
                return @([pscustomobject]@{ kind = 'OpenAI'; model = @{
                    name = 'gpt-4.1-mini'; format = 'OpenAI'; version = '2025-04-14'; lifecycleStatus = 'GenerallyAvailable'
                    skus = @(@{ name = 'Standard'; capacity = @{ minimum = 1 } }, @{ name = 'ProvisionedManaged'; capacity = @{ minimum = 50 } })
                } })
            }
            if ($command.StartsWith('group exists ')) { return $false }
            if ($command.StartsWith('provider register ') -or $command.StartsWith('group create ')) { return $null }
            if ($command.StartsWith('cognitiveservices account create ')) { return [pscustomobject]@{ properties = @{ endpoint = 'https://example.openai.azure.com/' } } }
            if ($command.StartsWith('cognitiveservices account deployment create ')) {
                if ($DeploymentFails) { throw 'Synthetic quota failure' }
                Assert-True ($command.Contains('--sku-name Standard --sku-capacity 1')) 'Minimum non-provisioned capacity'
                return [pscustomobject]@{ properties = @{ provisioningState = 'Succeeded' } }
            }
            if ($command.StartsWith('cognitiveservices account deployment list ')) {
                return @([pscustomobject]@{ name = 'existing-chat'; sku = @{ name = 'Standard' }; properties = @{ provisioningState = 'Succeeded'; model = @{ name = 'gpt-4o-mini' } } })
            }
            if ($command.StartsWith('cognitiveservices account keys list ')) { return 'synthetic-key' }
            throw "Unexpected Azure command: $command"
        }
        function Test-AzureConnection {
            param($Endpoint, $Key, $Deployment)
            Assert-True ($Key -eq 'synthetic-key') 'Key passed directly in memory'
            if ($ConnectionFails) { throw 'Synthetic connection failure' }
        }
        $failure = $null
        try { $output = Invoke-AzureSetup 6>&1 3>&1 | Out-String }
        catch { $failure = $_.Exception.Message }
        Assert-True (!$output -or !$output.Contains('synthetic-key')) 'No API key in wizard output'
        if ($Consent -notin @('DEPLOY', 'CONNECT')) {
            Assert-True ($failure -like '*Persetujuan*') 'Explicit consent required'
            Assert-True (@($commands | Where-Object { $_ -match ' (create|register|keys) ' }).Count -eq 0) 'No mutations/key retrieval before consent'
        } elseif ($DeploymentFails -or $ConnectionFails) {
            Assert-True ($failure -like 'Synthetic*failure') 'Provisioning/connectivity failure is not hidden'
        } else {
            Assert-True (!$failure) "Wizard completed: $failure"
            Assert-True ([IO.File]::ReadAllText($environmentPath).Contains('AZURE_OPENAI_KEY=synthetic-key')) 'Successful setup saves key'
            if ($Mode -eq 'existing') { Assert-True (@($commands | Where-Object { $_ -match ' (create|register) ' }).Count -eq 0) 'Existing resource is never modified' }
        }
        if ($failure) { Assert-True ([IO.File]::ReadAllText($environmentPath) -eq $original) 'Failed/cancelled setup leaves .env unchanged' }
        Assert-True (@($commands | Where-Object { $_ -match ' delete ' }).Count -eq 0) 'No automatic resource deletion'
    }

    Invoke-MockedScenario 'new' 'NO'
    Invoke-MockedScenario 'existing' 'NO'
    Invoke-MockedScenario 'new' 'DEPLOY'
    Invoke-MockedScenario 'existing' 'CONNECT'
    Invoke-MockedScenario 'new' 'DEPLOY' -DeploymentFails
    Invoke-MockedScenario 'existing' 'CONNECT' -ConnectionFails
    Write-Host 'PASS: atomic environment updates and six mocked wizard scenarios; no Azure connection or resource creation.'
} finally {
    if (Test-Path -LiteralPath $environmentPath) { Remove-Item -LiteralPath $environmentPath -Force }
    [IO.Directory]::Delete($temporaryRoot)
}
