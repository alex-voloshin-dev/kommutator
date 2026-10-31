Set-StrictMode -Version Latest

function ConvertTo-IPv4Number([string] $Address) {
  if ($Address -notmatch '^(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})$') {
    throw "Not a canonical IPv4 address: $Address"
  }
  [uint64] $number = 0
  foreach ($part in $Address.Split('.')) {
    if ([int] $part -gt 255) { throw "Invalid IPv4 octet: $Address" }
    $number = $number * 256 + [uint64] $part
  }
  return $number
}

function ConvertFrom-IPv4Number([uint64] $Number) {
  if ($Number -gt 4294967295) { throw 'IPv4 number out of range' }
  return ((24, 16, 8, 0 | ForEach-Object { [string](($Number -shr $_) -band 255) }) -join '.')
}

function Get-LanPolicy([string] $Address, [int] $PrefixLength, [string] $ExpectedSubnet) {
  if ($PrefixLength -lt 1 -or $PrefixLength -gt 30) { throw 'Physical LAN prefix must be between 1 and 30' }
  [uint64] $ip = ConvertTo-IPv4Number $Address
  [uint64] $size = [math]::Pow(2, 32 - $PrefixLength)
  [uint64] $start = [math]::Floor($ip / $size) * $size
  [uint64] $end = $start + $size - 1
  $subnet = "$(ConvertFrom-IPv4Number $start)/$PrefixLength"
  if ($ExpectedSubnet -cne $subnet) { throw "Expected subnet must exactly match selected interface: $subnet" }
  if ($ip -eq $start -or $ip -eq $end -or $ip -eq 0 -or ($ip -shr 24) -eq 127 -or $ip -ge 3758096384) {
    throw 'Not a usable unicast LAN address'
  }
  $outside = @()
  if ($start -gt 0) { $outside += "0.0.0.0-$(ConvertFrom-IPv4Number ($start - 1))" }
  if ($end -lt 4294967295) { $outside += "$(ConvertFrom-IPv4Number ($end + 1))-255.255.255.255" }
  return [pscustomobject]@{ Address = $Address; Subnet = $subnet; PrefixLength = $PrefixLength; Port = 8787; Outside = $outside }
}

function Assert-LoopbackPublication($Ports) {
  $properties = @($Ports.PSObject.Properties)
  if ($properties.Count -ne 1 -or $properties[0].Name -ne '8787/tcp') { throw 'Container must publish only TCP 8787' }
  $bindings = @($properties[0].Value)
  if ($bindings.Count -ne 1 -or $bindings[0].HostIp -cne '127.0.0.1' -or $bindings[0].HostPort -cne '8787') {
    throw 'Docker must publish exactly 127.0.0.1:8787; external WSL/IPv6 bindings are forbidden'
  }
}

# Windows accepts both prefix lengths and dotted netmasks in firewall address filters.
# Compare exact intervals, never keywords such as LocalSubnet or broader address sets.
function ConvertTo-IPv4Interval([string] $Value) {
  if ($Value -ceq 'Any') { return 'Any' }
  if ($Value.Contains('/')) {
    $parts = $Value.Split('/')
    if ($parts.Count -ne 2) { throw 'Invalid IPv4 subnet filter' }
    [uint64]$ip = ConvertTo-IPv4Number $parts[0]
    if ($parts[1] -match '^(0|[1-9]|[12][0-9]|3[0-2])$') {
      [uint64]$size = [math]::Pow(2, 32 - [int]$parts[1])
    } else {
      [uint64]$mask = ConvertTo-IPv4Number $parts[1]
      [uint64]$hostBits = 4294967295 - $mask
      if (($hostBits -band ($hostBits + 1)) -ne 0) { throw 'Non-contiguous IPv4 subnet mask' }
      [uint64]$size = $hostBits + 1
    }
    [uint64]$low = [math]::Floor($ip / $size) * $size
    [uint64]$high = $low + $size - 1
  } elseif ($Value.Contains('-')) {
    $parts = $Value.Split('-')
    if ($parts.Count -ne 2) { throw 'Invalid IPv4 range filter' }
    [uint64]$low = ConvertTo-IPv4Number $parts[0]
    [uint64]$high = ConvertTo-IPv4Number $parts[1]
    if ($low -gt $high) { throw 'Inverted IPv4 range filter' }
  } else {
    [uint64]$low = ConvertTo-IPv4Number $Value
    [uint64]$high = $low
  }
  return "$low-$high"
}

function Test-IPv4FilterEqual([string[]] $Actual, [string[]] $Expected) {
  if ($Actual.Count -eq 0 -or $Expected.Count -eq 0) { return $false }
  $left = @($Actual | ForEach-Object { ConvertTo-IPv4Interval $_ } | Sort-Object -Unique)
  $right = @($Expected | ForEach-Object { ConvertTo-IPv4Interval $_ } | Sort-Object -Unique)
  return (($left -join ',') -ceq ($right -join ','))
}

# IPv4 ingress inventory excludes only OS-identified loopback interfaces.
# Hidden adapter records without an IPv4 interface are not valid firewall aliases.
function Get-LanOtherInterfaces($IPv4Interfaces, [int[]] $LoopbackIndexes, [string] $SelectedAlias) {
  $interfaces = @($IPv4Interfaces)
  if (@($interfaces | Where-Object { $_.InterfaceAlias -ceq $SelectedAlias }).Count -ne 1) {
    throw 'Selected physical interface must have exactly one IPv4 interface record'
  }
  $aliases = foreach ($interface in $interfaces) {
    if ([string]::IsNullOrWhiteSpace($interface.InterfaceAlias) -or [int]$interface.InterfaceIndex -lt 1) {
      throw 'Invalid IPv4 interface inventory'
    }
    if ($LoopbackIndexes -contains [int]$interface.InterfaceIndex) {
      if ($interface.InterfaceAlias -ceq $SelectedAlias) { throw 'Selected LAN interface cannot be loopback' }
      continue
    }
    if ($interface.InterfaceAlias -cne $SelectedAlias) { [string]$interface.InterfaceAlias }
  }
  return @($aliases | Sort-Object -Unique)
}

# Proxy creation is always last. On failure, keep blocks if closing the proxy fails.
# Callbacks make ordering and rollback testable without touching the host firewall.
function Invoke-LanInstall($Rules, [scriptblock] $AddRule, [scriptblock] $RemoveRule,
  [scriptblock] $AddProxy, [scriptblock] $RemoveProxy, [scriptblock] $Commit, [scriptblock] $VerifyRules) {
  $created = [System.Collections.Generic.List[string]]::new()
  $proxyAttempted = $false
  try {
    foreach ($rule in $Rules) {
      & $AddRule $rule
      $created.Add($rule.Name)
    }
    & $VerifyRules
    $proxyAttempted = $true
    & $AddProxy
    & $Commit
  } catch {
    $originalError = $_
    if ($proxyAttempted) {
      try { & $RemoveProxy } catch {
        throw "LAN setup failed; proxy cleanup also failed. Restrictive firewall rules were retained. Remove the proxy before removing rules. $($_.Exception.Message)"
      }
    }
    foreach ($name in $created) { & $RemoveRule $name }
    throw $originalError
  }
}
Export-ModuleMember -Function ConvertTo-IPv4Number, ConvertFrom-IPv4Number, Get-LanPolicy, Assert-LoopbackPublication, Test-IPv4FilterEqual, Get-LanOtherInterfaces, Invoke-LanInstall
