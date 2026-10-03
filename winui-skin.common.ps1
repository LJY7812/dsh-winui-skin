# dsh-winui-skin — shared helpers for install.ps1 / uninstall.ps1.
#
# Kept separate so both scripts read and write the profile manifest the same
# way: UTF-8 without BOM, and standard 2-space JSON rather than the aligned
# "key":  value layout Windows PowerShell 5.1's ConvertTo-Json produces.

# UTF-8 without a byte-order mark. A BOM would break JSON.parse in the loader.
function Write-Utf8NoBom([string]$Path, [string]$Text) {
  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Text, $encoding)
}

# Windows PowerShell 5.1 decodes a BOM-less file as ANSI, which would corrupt
# any non-ASCII text (a Chinese description, say). Always read through an
# explicit codec.
function Read-Utf8([string]$Path) {
  return [System.IO.File]::ReadAllText($Path, (New-Object System.Text.UTF8Encoding($false)))
}

# JSON-escape a string; non-ASCII becomes \uXXXX so the output file is pure
# ASCII and can never be mangled by an encoding guess.
function ConvertTo-JsonString([string]$Text) {
  $builder = New-Object System.Text.StringBuilder
  [void]$builder.Append('"')
  foreach ($character in $Text.ToCharArray()) {
    $code = [int]$character
    switch ($character) {
      '"' { [void]$builder.Append('\"') }
      '\' { [void]$builder.Append('\\') }
      "`b" { [void]$builder.Append('\b') }
      "`f" { [void]$builder.Append('\f') }
      "`n" { [void]$builder.Append('\n') }
      "`r" { [void]$builder.Append('\r') }
      "`t" { [void]$builder.Append('\t') }
      default {
        if ($code -lt 0x20 -or $code -gt 0x7E) { [void]$builder.Append('\u' + ('{0:x4}' -f $code)) }
        else { [void]$builder.Append($character) }
      }
    }
  }
  [void]$builder.Append('"')
  return $builder.ToString()
}

# Render one PSCustomObject / array graph as 2-space indented JSON.
function Format-JsonNode($Value, [int]$Depth = 0) {
  $pad = ' ' * $Depth
  $inner = ' ' * ($Depth + 2)

  if ($null -eq $Value) { return 'null' }
  if ($Value -is [bool]) { if ($Value) { return 'true' } else { return 'false' } }
  if ($Value -is [string]) { return (ConvertTo-JsonString $Value) }
  if ($Value -is [int] -or $Value -is [long] -or $Value -is [double] -or $Value -is [decimal]) {
    return [string]::Format([System.Globalization.CultureInfo]::InvariantCulture, '{0}', $Value)
  }

  # Arrays and other enumerables (but not strings).
  if ($Value -is [System.Collections.IEnumerable]) {
    $items = @($Value)
    if ($items.Count -eq 0) { return '[]' }
    $rendered = foreach ($item in $items) { $inner + (Format-JsonNode $item ($Depth + 2)) }
    return "[`n" + ($rendered -join ",`n") + "`n$pad]"
  }

  $properties = @($Value.PSObject.Properties)
  if ($properties.Count -eq 0) { return '{}' }
  $rendered = foreach ($property in $properties) {
    $inner + (ConvertTo-JsonString $property.Name) + ': ' + (Format-JsonNode $property.Value ($Depth + 2))
  }
  return "{`n" + ($rendered -join ",`n") + "`n$pad}"
}

function ConvertTo-JsonPretty($Value) { return (Format-JsonNode $Value 0) + "`n" }
