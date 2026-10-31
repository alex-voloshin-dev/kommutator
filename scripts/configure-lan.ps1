#Requires -Version 5.1
<#
.SYNOPSIS
Opt-in Windows IPv4 LAN ingress for a loopback-only Docker hub in WSL.
.DESCRIPTION
Run Plan first. Apply/Remove require elevated Windows PowerShell. No network
profile changes, WSL external bindings, IPv6 proxies, or secret handling.
Re-run Plan after network/WSL/firewall changes; stale configuration must be
removed before applying a new address/subnet. A second LAN host must verify
allowed and denied paths before declaring LAN acceptance complete.
.EXAMPLE
.\scripts\configure-lan.ps1 -Mode Plan -InterfaceAlias 'Ethernet 2' -ExpectedSubnet '192.168.7.0/24'
#>
[CmdletBinding()]
param(
  [ValidateSet('Plan', 'Apply', 'Remove')][string] $Mode = 'Plan',
  [string] $InterfaceAlias,
  [string] $ExpectedSubnet,
  [string] $Address,
  [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_.-]*$')][string] $Distribution = 'Ubuntu-24.04',
  [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_.-]*$')][string] $ContainerName = 'kommutator-hub-1'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'lan-policy.psm1') -Force
$group = 'Kommutator LAN 8787'
$stateDirectory = Join-Path $env:ProgramData 'KommutatorLan'
$statePath = Join-Path $stateDirectory 'state.json'
$state = if (Test-Path -LiteralPath $statePath) { Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json } else { $null }

function Assert-Administrator {
  $principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Apply/Remove require an elevated Windows PowerShell. Plan is read-only and does not require elevation.'
  }
}
function Get-PortProxies {
  foreach ($kind in 'v4tov4', 'v4tov6', 'v6tov4', 'v6tov6') {
    $key = "HKLM:\SYSTEM\CurrentControlSet\Services\PortProxy\$kind\tcp"
    if (Test-Path $key) {
      $item = Get-Item $key
      foreach ($name in $item.GetValueNames()) {
        if ($name -match '/8787$') { [pscustomobject]@{ Kind = $kind; Name = $name; Target = $item.GetValue($name) } }
      }
    }
  }
}
function Test-OwnedProxy($Proxy, $Saved) {
  return ($null -ne $Saved -and $Proxy.Kind -ceq 'v4tov4' -and $Proxy.Name -ceq "$($Saved.Address)/8787" -and $Proxy.Target -ceq '127.0.0.1/8787')
}
function Remove-OwnedProxy($Saved) {
  $proxy = @(Get-PortProxies | Where-Object { $_.Kind -ceq 'v4tov4' -and $_.Name -ceq "$($Saved.Address)/8787" })
  if ($proxy.Count -gt 0) {
    if (-not (Test-OwnedProxy $proxy[0] $Saved)) { throw 'Proxy target changed; refusing to delete unrelated configuration' }
    & netsh.exe interface portproxy delete v4tov4 "listenaddress=$($Saved.Address)" listenport=8787 protocol=tcp | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'netsh proxy removal failed' }
  }
  if (@(Get-PortProxies | Where-Object { $_.Kind -ceq 'v4tov4' -and $_.Name -ceq "$($Saved.Address)/8787" }).Count -gt 0) { throw 'Proxy still exists' }
}
function Add-LanRule($Definition, [string] $Marker, [switch] $ValidateOnly) {
  try {
    New-NetFirewallRule -PolicyStore PersistentStore -Name $Definition.Name -DisplayName $Definition.Name -Group $group -Description $Marker -Enabled True -Direction Inbound -Profile Any -Protocol TCP -LocalPort 8787 -LocalAddress $addressValue -RemoteAddress $Definition.RemoteAddress -InterfaceAlias $Definition.InterfaceAlias -Action $Definition.Action -WhatIf:$ValidateOnly | Out-Null
  } catch {
    throw "Firewall rule $($Definition.Name), interfaces [$($Definition.InterfaceAlias -join ', ')]: $($_.Exception.Message)"
  }
}
function Assert-OwnedRules($Saved) {
  foreach ($name in $Saved.RuleNames) {
    $rule = Get-NetFirewallRule -PolicyStore PersistentStore -Name $name -ErrorAction SilentlyContinue
    if ($null -ne $rule -and ($rule.Group -cne $group -or $rule.Description -cne $Saved.Marker)) {
      throw "Refusing to modify rule with changed ownership: $name"
    }
  }
}
function Assert-EffectiveRules($Definitions, [string] $LocalAddress, [string] $Marker) {
  # Query effective policy, not merely successful writes to PersistentStore.
  foreach ($profile in @(Get-NetFirewallProfile -PolicyStore ActiveStore)) {
    if ($profile.Enabled -ne 'True' -or $profile.AllowLocalFirewallRules -eq 'False') { throw 'Effective firewall profiles do not enforce local rules' }
  }
  foreach ($definition in $Definitions) {
    $rule = Get-NetFirewallRule -PolicyStore ActiveStore -Name $definition.Name -ErrorAction SilentlyContinue
    if ($null -eq $rule -or $rule.Enabled -ne 'True' -or [string]$rule.Action -cne $definition.Action -or $rule.Direction -ne 'Inbound' -or $rule.Profile -ne 'Any' -or $rule.Group -cne $group -or $rule.Description -cne $Marker) { throw 'Owned firewall rule missing or changed; Remove then Apply' }
    $af = $rule | Get-NetFirewallAddressFilter
    $pf = $rule | Get-NetFirewallPortFilter
    $if = $rule | Get-NetFirewallInterfaceFilter
    if (-not (Test-IPv4FilterEqual @($af.LocalAddress) @($LocalAddress)) -or -not (Test-IPv4FilterEqual @($af.RemoteAddress) @($definition.RemoteAddress)) -or
      ($pf.LocalPort -join ',') -cne '8787' -or $pf.Protocol -ne 'TCP' -or (($if.InterfaceAlias | Sort-Object) -join ',') -cne (($definition.InterfaceAlias | Sort-Object) -join ',')) { throw 'Owned firewall filters changed; Remove then Apply' }
  }
}
if ($Mode -eq 'Remove') {
  Assert-Administrator
  if ($null -eq $state) { throw 'No owned LAN state found; no rules or proxies were changed' }
  Assert-OwnedRules $state
  Remove-OwnedProxy $state
  foreach ($name in $state.RuleNames) {
    Get-NetFirewallRule -PolicyStore PersistentStore -Name $name -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  }
  Remove-Item -LiteralPath $statePath
  # Never recursively remove a state directory: preserve any unexpected files.
  if (@(Get-ChildItem -Force -LiteralPath $stateDirectory).Count -eq 0) { Remove-Item -LiteralPath $stateDirectory }
  Write-Output 'Removed owned LAN proxy and rules. Docker/WSL loopback service is unchanged.'
  exit 0
}
if ([string]::IsNullOrWhiteSpace($InterfaceAlias) -or [string]::IsNullOrWhiteSpace($ExpectedSubnet)) { throw 'InterfaceAlias and ExpectedSubnet are required' }
$adapter = @(Get-NetAdapter | Where-Object { $_.Name -ceq $InterfaceAlias })
if ($adapter.Count -ne 1 -or -not $adapter[0].HardwareInterface -or $adapter[0].Status -ne 'Up') { throw 'Select one active physical LAN adapter by exact alias' }
$addresses = @(Get-NetIPAddress -InterfaceIndex $adapter[0].InterfaceIndex -AddressFamily IPv4 | Where-Object {
  $_.AddressState -eq 'Preferred' -and -not $_.SkipAsSource -and ([string]::IsNullOrEmpty($Address) -or $_.IPAddress -ceq $Address)
})
if ($addresses.Count -ne 1) { throw 'Select one preferred IPv4 address with -Address when the physical adapter has multiple addresses' }
$policy = Get-LanPolicy $addresses[0].IPAddress $addresses[0].PrefixLength $ExpectedSubnet
$addressValue = $policy.Address

# Windows localhost forwarding retains Docker's loopback-only trust boundary.
$portsJson = & wsl.exe --distribution $Distribution --exec docker inspect --format '{{json .NetworkSettings.Ports}}' $ContainerName
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect Docker publication inside WSL' }
Assert-LoopbackPublication ($portsJson | ConvertFrom-Json)
$loopbackListeners = @(Get-NetTCPConnection -State Listen -LocalPort 8787 -ErrorAction SilentlyContinue)
if (@($loopbackListeners | Where-Object { $_.LocalAddress -ceq '127.0.0.1' }).Count -lt 1) { throw 'Windows WSL localhost forwarding is not listening at 127.0.0.1:8787' }
foreach ($listener in $loopbackListeners) {
  if ($listener.LocalAddress -ceq '127.0.0.1') { continue }
  if ($null -ne $state -and $listener.LocalAddress -ceq $state.Address) { continue }
  throw "Conflicting listener at $($listener.LocalAddress):8787; IPv6 and alternate exposure are forbidden"
}
$request = [System.Net.HttpWebRequest]::Create('http://127.0.0.1:8787/api/snapshot')
$request.Proxy = $null
$request.AllowAutoRedirect = $false
$request.Timeout = 3000
$response = $null
try { $response = $request.GetResponse() } catch [System.Net.WebException] { $response = $_.Exception.Response }
try {
  if ($null -eq $response -or [int]$response.StatusCode -ne 401) { throw 'Loopback hub must reject unauthenticated requests with HTTP 401' }
} finally { if ($null -ne $response) { $response.Close() } }
foreach ($proxy in @(Get-PortProxies)) {
  if (-not (Test-OwnedProxy $proxy $state)) { throw "Conflicting portproxy at $($proxy.Name); no existing proxies were changed" }
}
# All profiles must enforce local rules, including if Windows changes category.
$profiles = @(Get-NetFirewallProfile -PolicyStore ActiveStore)
foreach ($profile in $profiles) {
  if ($profile.Enabled -ne 'True' -or $profile.AllowLocalFirewallRules -eq 'False') { throw 'All Windows firewall profiles must be enabled and permit local firewall rules' }
}
# Authenticated bypass rules can override block rules; reject rather than weaken policy.
if (@(Get-NetFirewallRule -PolicyStore ActiveStore -Enabled True -Direction Inbound | Get-NetFirewallSecurityFilter | Where-Object { $_.OverrideBlockRules -eq 'True' }).Count -gt 0) {
  throw 'An inbound firewall bypass rule exists; LAN policy requires administrator review before enabling'
}
$rules = @(
  @{ Name = 'Kommutator-LAN-8787-BlockOutside'; Action = 'Block'; RemoteAddress = $policy.Outside; InterfaceAlias = 'Any' },
  @{ Name = 'Kommutator-LAN-8787-AllowSubnet'; Action = 'Allow'; RemoteAddress = @($policy.Subnet); InterfaceAlias = $InterfaceAlias }
)
$loopbackIndexes = @([System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() |
  Where-Object { $_.NetworkInterfaceType -eq 'Loopback' } |
  ForEach-Object { $_.GetIPProperties().GetIPv4Properties().Index })
$otherInterfaces = @(Get-LanOtherInterfaces @(Get-NetIPInterface -AddressFamily IPv4) $loopbackIndexes $InterfaceAlias)
if ($otherInterfaces.Count -gt 0) {
  $rules = @($rules[0], @{ Name = 'Kommutator-LAN-8787-BlockOtherInterfaces'; Action = 'Block'; RemoteAddress = @('Any'); InterfaceAlias = $otherInterfaces }, $rules[1])
}
if ($null -ne $state) {
  Assert-OwnedRules $state
  if ($state.Address -cne $policy.Address -or $state.Subnet -cne $policy.Subnet -or $state.AdapterId -cne [string]$adapter[0].InterfaceGuid -or $state.InterfaceAlias -cne $InterfaceAlias -or
    $state.OtherInterfaces -cne ($otherInterfaces -join '|')) { throw 'Network configuration changed: Remove the owned LAN configuration before applying a new plan' }
  Assert-EffectiveRules $rules $policy.Address $state.Marker
  if (@(Get-PortProxies).Count -ne 1) { throw 'Owned proxy missing; Remove then Apply' }
} else {
  foreach ($rule in $rules) {
    if ($null -ne (Get-NetFirewallRule -PolicyStore PersistentStore -Name $rule.Name -ErrorAction SilentlyContinue)) { throw 'Unowned or interrupted-install rules exist; refusing to overwrite them' }
    # WhatIf resolves aliases through the actual firewall provider without creating a rule.
    # This also rejects an unsupported active VPN/virtual interface instead of omitting it.
    Add-LanRule $rule 'kommutator-lan-preflight' -ValidateOnly
  }
}
$plan = [pscustomobject]@{
  Mode = $Mode; Address = $policy.Address; Port = 8787; AllowedSubnet = $policy.Subnet
  InterfaceAlias = $InterfaceAlias; Target = '127.0.0.1:8787'; DockerPublication = '127.0.0.1:8787'
  Rules = $rules; AlreadyConfigured = ($null -ne $state)
}
$plan | ConvertTo-Json -Depth 6
if ($Mode -eq 'Plan') { exit 0 }
Assert-Administrator
if ($null -ne $state) { Write-Output 'Owned LAN configuration already matches the verified plan.'; exit 0 }
$newState = [pscustomobject]@{
  Version = 1; Address = $policy.Address; Subnet = $policy.Subnet; InterfaceAlias = $InterfaceAlias
  AdapterId = [string]$adapter[0].InterfaceGuid; OtherInterfaces = ($otherInterfaces -join '|')
  Marker = "kommutator-lan-v1:$([guid]::NewGuid())"; RuleNames = @($rules | ForEach-Object { $_.Name })
}
# Do not trust a pre-existing user-writable state directory when running elevated.
if (Test-Path -LiteralPath $stateDirectory) { throw 'State directory already exists without state; inspect and remove it before applying' }
New-Item -ItemType Directory -Path $stateDirectory | Out-Null
$acl = [System.Security.AccessControl.DirectorySecurity]::new()
$acl.SetAccessRuleProtection($true, $false)
foreach ($sidValue in 'S-1-5-18', 'S-1-5-32-544') {
  $sid = [System.Security.Principal.SecurityIdentifier]::new($sidValue)
  $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
}
# Ordinary users can inspect the saved public plan, never modify ownership state.
$acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new([System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-545'), 'ReadAndExecute', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
Set-Acl -LiteralPath $stateDirectory -AclObject $acl
try {
Invoke-LanInstall $rules {
  param($rule)
  Add-LanRule $rule $newState.Marker
} {
  param($name)
  Remove-NetFirewallRule -PolicyStore PersistentStore -Name $name
} {
  & netsh.exe interface portproxy add v4tov4 "listenaddress=$addressValue" listenport=8787 connectaddress=127.0.0.1 connectport=8787 protocol=tcp | Out-Null
  if ($LASTEXITCODE -ne 0 -or @(Get-PortProxies | Where-Object { Test-OwnedProxy $_ $newState }).Count -ne 1) { throw 'Could not create the exact IPv4 LAN proxy' }
} {
  Remove-OwnedProxy $newState
} {
  $newState | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $statePath -Encoding UTF8
} {
  Assert-EffectiveRules $rules $addressValue $newState.Marker
}
} catch {
  # Retain ownership metadata if a proxy/rule remains after failed rollback.
  $remainingRules = @(Get-NetFirewallRule -PolicyStore PersistentStore -Group $group -ErrorAction SilentlyContinue)
  if ($remainingRules.Count -gt 0 -or @(Get-PortProxies | Where-Object { Test-OwnedProxy $_ $newState }).Count -gt 0) {
    $newState | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $statePath -Encoding UTF8
  } else {
    if (Test-Path -LiteralPath $statePath) { Remove-Item -LiteralPath $statePath }
    if (@(Get-ChildItem -Force -LiteralPath $stateDirectory).Count -eq 0) { Remove-Item -LiteralPath $stateDirectory }
  }
  throw
}
Write-Output 'LAN ingress configured. Verify from allowed and denied source hosts before recording acceptance.'
