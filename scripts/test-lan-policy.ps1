#Requires -Version 5.1
# Deterministic tests: no firewall, proxy, Docker, registry, or network mutations.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'lan-policy.psm1') -Force
$script:checks = 0
function Assert-Equal($Actual, $Expected, [string] $Label) {
  if ([string]$Actual -cne [string]$Expected) { throw "$Label expected [$Expected], received [$Actual]" }
  $script:checks++
}
function Assert-Throws([scriptblock] $Operation, [string] $Label) {
  $thrown = $false
  try { & $Operation | Out-Null } catch { $thrown = $true }
  if (-not $thrown) { throw "$Label did not reject input" }
  $script:checks++
}
foreach ($ip in '0.0.0.0', '1.2.3.4', '127.0.0.1', '192.168.7.155', '255.255.255.255') {
  Assert-Equal (ConvertFrom-IPv4Number (ConvertTo-IPv4Number $ip)) $ip 'IPv4 roundtrip'
}
foreach ($invalid in '', 'localhost', '1.2.3', '1.2.3.256', '01.2.3.4', '-1.2.3.4', '1.2.3.4/24', '::1', '1.2.3.4;exit') {
  Assert-Throws { ConvertTo-IPv4Number $invalid } "Invalid IPv4 $invalid"
}
$policy = Get-LanPolicy '192.168.7.155' 24 '192.168.7.0/24'
Assert-Equal $policy.Port 8787 'Fixed port'
Assert-Equal ($policy.Outside -join ',') '0.0.0.0-192.168.6.255,192.168.8.0-255.255.255.255' 'Subnet complement'
# Every address outside each tested subnet is covered once, no inside address is blocked.
foreach ($case in @(@('10.0.0.1', 8, '10.0.0.0/8'), @('192.168.7.155', 24, '192.168.7.0/24'), @('1.0.0.1', 1, '0.0.0.0/1'), @('192.0.0.1', 1, '128.0.0.0/1'), @('172.24.85.83', 20, '172.24.80.0/20'), @('192.168.7.1', 30, '192.168.7.0/30'))) {
  $value = Get-LanPolicy $case[0] $case[1] $case[2]
  [uint64]$start = ConvertTo-IPv4Number ($value.Subnet.Split('/')[0])
  [uint64]$size = [math]::Pow(2, 32 - $value.PrefixLength)
  [uint64]$total = 0
  foreach ($range in $value.Outside) {
    $ends = $range.Split('-')
    $low = ConvertTo-IPv4Number $ends[0]
    $high = ConvertTo-IPv4Number $ends[1]
    if ($low -gt $high -or -not ($high -lt $start -or $low -ge $start + $size)) { throw 'Complement overlaps subnet or is inverted' }
    $total += $high - $low + 1
  }
  Assert-Equal ($total + $size) 4294967296 'Exact complement coverage'
}
foreach ($case in @(@('192.168.7.155', 24, '192.168.0.0/16'), @('192.168.7.155', 24, '192.168.7.155/24'), @('192.168.7.155', 24, 'LocalSubnet'), @('192.168.7.155', 0, '0.0.0.0/0'), @('192.168.7.155', 32, '192.168.7.155/32'), @('192.168.7.0', 24, '192.168.7.0/24'), @('192.168.7.255', 24, '192.168.7.0/24'), @('127.0.0.1', 8, '127.0.0.0/8'))) {
  Assert-Throws { Get-LanPolicy $case[0] $case[1] $case[2] } 'Invalid LAN policy'
}
Assert-LoopbackPublication ('{"8787/tcp":[{"HostIp":"127.0.0.1","HostPort":"8787"}]}' | ConvertFrom-Json)
$script:checks++
foreach ($json in '{"8787/tcp":[{"HostIp":"0.0.0.0","HostPort":"8787"}]}', '{"8787/tcp":[{"HostIp":"::","HostPort":"8787"}]}', '{"8787/tcp":[{"HostIp":"172.24.85.83","HostPort":"8787"}]}', '{"8787/tcp":[{"HostIp":"127.0.0.1","HostPort":"9000"}]}', '{"8787/tcp":[{"HostIp":"127.0.0.1","HostPort":"8787"},{"HostIp":"::1","HostPort":"8787"}]}', '{"8787/tcp":null}', '{}') {
  Assert-Throws { Assert-LoopbackPublication ($json | ConvertFrom-Json) } 'Unsafe publication'
}
Assert-Equal (Test-IPv4FilterEqual @('192.168.7.0/255.255.255.0') @('192.168.7.0/24')) $true 'Equivalent dotted mask'
Assert-Equal (Test-IPv4FilterEqual @('192.168.7.0-192.168.7.255') @('192.168.7.0/24')) $true 'Equivalent range'
Assert-Equal (Test-IPv4FilterEqual @('192.168.7.155/32') @('192.168.7.155')) $true 'Equivalent single address'
Assert-Equal (Test-IPv4FilterEqual @('192.168.0.0/16') @('192.168.7.0/24')) $false 'Broader subnet rejected'
Assert-Equal (Test-IPv4FilterEqual @('192.168.7.0/25') @('192.168.7.0/24')) $false 'Narrower subnet rejected'
Assert-Equal (Test-IPv4FilterEqual @('Any') @('0.0.0.0/0')) $false 'Any is not normalized to IPv4 only'
Assert-Equal (Test-IPv4FilterEqual @('192.168.7.0/24', '10.0.0.0/8') @('192.168.7.0/24')) $false 'Extra subnet rejected'
Assert-Equal (Test-IPv4FilterEqual @() @('192.168.7.0/24')) $false 'Empty filter rejected'
foreach ($bad in '192.168.7.0/255.0.255.0', '192.168.7.0/33', 'LocalSubnet', '::/0', '192.168.7.255-192.168.7.0') {
  Assert-Throws { Test-IPv4FilterEqual @($bad) @('192.168.7.0/24') } 'Unsupported or malformed address filter'
}

# Use the IPv4 ingress inventory, including hidden Wi-Fi Direct and active VPN/WSL.
$inventory = @(
  [pscustomobject]@{ InterfaceIndex = 17; InterfaceAlias = 'Ethernet 2' },
  [pscustomobject]@{ InterfaceIndex = 1; InterfaceAlias = 'Localized loopback name' },
  [pscustomobject]@{ InterfaceIndex = 34; InterfaceAlias = 'vpn25' },
  [pscustomobject]@{ InterfaceIndex = 46; InterfaceAlias = 'vEthernet (WSL)' },
  [pscustomobject]@{ InterfaceIndex = 16; InterfaceAlias = 'Local Area Connection* 10' },
  [pscustomobject]@{ InterfaceIndex = 10; InterfaceAlias = 'Wi-Fi' }
)
$other = @(Get-LanOtherInterfaces $inventory @(1) 'Ethernet 2')
Assert-Equal ($other -join '|') 'Local Area Connection* 10|vEthernet (WSL)|vpn25|Wi-Fi' 'All non-loopback IPv4 ingress is blocked'
Assert-Equal (@(Get-LanOtherInterfaces $inventory[0..1] @(1) 'Ethernet 2').Count) 0 'Single physical LAN plus loopback'
Assert-Throws { Get-LanOtherInterfaces $inventory @(1) 'missing' } 'Missing selected IPv4 interface'
Assert-Throws { Get-LanOtherInterfaces ($inventory + $inventory[0]) @(1) 'Ethernet 2' } 'Ambiguous selected IPv4 interface'
Assert-Throws { Get-LanOtherInterfaces $inventory @(17) 'Ethernet 2' } 'Selected loopback rejected'
Assert-Throws { Get-LanOtherInterfaces ($inventory + [pscustomobject]@{InterfaceIndex=55; InterfaceAlias=''}) @(1) 'Ethernet 2' } 'Malformed IPv4 inventory rejected'

# Preserve every non-loopback IPv4 path even if the provider later refuses its alias.
Assert-Equal (@(Get-LanOtherInterfaces ($inventory + $inventory[2]) @(1) 'Ethernet 2') -join '|') ($other -join '|') 'Duplicate non-selected records do not drop another interface'
Assert-Throws { Get-LanOtherInterfaces ($inventory + [pscustomobject]@{InterfaceIndex=0; InterfaceAlias='bad-index'}) @(1) 'Ethernet 2' } 'Invalid interface index rejected'
$unsupportedInventory = $inventory + [pscustomobject]@{InterfaceIndex=99; InterfaceAlias='unsupported-active-vpn'}
$unsupportedAliases = @(Get-LanOtherInterfaces $unsupportedInventory @(1) 'Ethernet 2')
Assert-Equal ($unsupportedAliases -contains 'unsupported-active-vpn') $true 'Unsupported active interface is retained for preflight rejection'

# Execute only the real rule helper with a fake provider; never execute the setup script.
$helperTokens = $null; $helperErrors = $null
$setupAst = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'configure-lan.ps1'), [ref]$helperTokens, [ref]$helperErrors)
$helperAst = @($setupAst.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Add-LanRule' }, $true))
Assert-Equal $helperAst.Count 1 'Rule helper found for provider boundary test'
Invoke-Expression $helperAst[0].Extent.Text
$script:providerCalls = [System.Collections.Generic.List[object]]::new()
function New-NetFirewallRule {
  param($PolicyStore, $Name, $DisplayName, $Group, $Description, $Enabled, $Direction, $Profile,
    $Protocol, $LocalPort, $LocalAddress, $RemoteAddress, $InterfaceAlias, $Action, [switch] $WhatIf)
  $script:providerCalls.Add([pscustomobject]@{ WhatIf = [bool]$WhatIf; Aliases = @($InterfaceAlias); LocalPort = $LocalPort })
  if ($InterfaceAlias -contains 'unsupported-active-vpn') { throw 'The specified interface was not found on the system.' }
}
$group = 'test-only'
$addressValue = '192.168.7.155'
try {
  $definition = @{ Name = 'preflight-test'; Action = 'Block'; RemoteAddress = @('Any'); InterfaceAlias = $other }
  Add-LanRule $definition 'test-only' -ValidateOnly
  Assert-Equal $script:providerCalls[0].WhatIf $true 'Plan forwards WhatIf to the provider'
  Assert-Equal ($script:providerCalls[0].Aliases -join '|') ($other -join '|') 'Preflight validates every VPN WSL and Wi-Fi alias'
  Assert-Equal $script:providerCalls[0].LocalPort 8787 'Preflight validates the actual fixed port'
  $definition.InterfaceAlias = $unsupportedAliases
  Assert-Throws { Add-LanRule $definition 'test-only' -ValidateOnly } 'Unsupported active interface fails preflight instead of being omitted'
  Assert-Equal $script:providerCalls[1].WhatIf $true 'Failed preflight remains non-mutating'
} finally {
  Remove-Item Function:New-NetFirewallRule
  Remove-Item Function:Add-LanRule
}

$rules = @(@{ Name = 'block' }, @{ Name = 'allow' })
$script:events = [System.Collections.Generic.List[string]]::new()
$add = { param($r) $script:events.Add("add:$($r.Name)") }
$remove = { param($name) $script:events.Add("remove:$name") }
$proxy = { $script:events.Add('proxy') }
$unproxy = { $script:events.Add('unproxy') }
$commit = { $script:events.Add('commit') }
$verify = { $script:events.Add('verify') }
Invoke-LanInstall $rules $add $remove $proxy $unproxy $commit $verify
Assert-Equal ($script:events -join ',') 'add:block,add:allow,verify,proxy,commit' 'Install ordering'
$script:events.Clear()
Assert-Throws { Invoke-LanInstall $rules { param($r) if ($r.Name -eq 'allow') { throw 'rule failure' }; & $add $r } $remove $proxy $unproxy $commit $verify } 'Rule failure'
Assert-Equal ($script:events -join ',') 'add:block,remove:block' 'No proxy before rules installed'
$script:events.Clear()
Assert-Throws { Invoke-LanInstall $rules $add $remove { & $proxy; throw 'proxy failure' } $unproxy $commit $verify } 'Proxy failure'
Assert-Equal ($script:events -join ',') 'add:block,add:allow,verify,proxy,unproxy,remove:block,remove:allow' 'Proxy closed before rollback removes blocks'
$script:events.Clear()
Assert-Throws { Invoke-LanInstall $rules $add $remove $proxy $unproxy { throw 'state write failure' } $verify } 'Commit failure'
Assert-Equal ($script:events -join ',') 'add:block,add:allow,verify,proxy,unproxy,remove:block,remove:allow' 'Commit rollback'
$script:events.Clear()
Assert-Throws { Invoke-LanInstall $rules $add $remove { & $proxy; throw 'proxy failure' } { $script:events.Add('unproxy-failed'); throw 'cleanup failure' } $commit $verify } 'Proxy removal failure'
Assert-Equal ($script:events -join ',') 'add:block,add:allow,verify,proxy,unproxy-failed' 'Keep restrictive rules when proxy cannot close'
$script:events.Clear()
Assert-Throws { Invoke-LanInstall $rules $add $remove $proxy $unproxy $commit { $script:events.Add('verify-failed'); throw 'effective rule mismatch' } } 'Effective rule verification failure'
Assert-Equal ($script:events -join ',') 'add:block,add:allow,verify-failed,remove:block,remove:allow' 'Verification failure never opens proxy and rolls back rules'
foreach ($file in 'configure-lan.ps1', 'lan-policy.psm1', 'test-lan-policy.ps1') {
  $tokens = $null; $errors = $null
  [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot $file), [ref]$tokens, [ref]$errors) | Out-Null
  Assert-Equal $errors.Count 0 "PowerShell parser $file"
}
Write-Output "PASS: $script:checks deterministic LAN policy checks; no host configuration changed."
