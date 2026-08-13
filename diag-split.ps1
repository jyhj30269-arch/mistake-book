# 诊断：app.js 拆分边界（临时）
$root = "C:\Users\32949\Desktop\assets"
$lines = Get-Content "$root\app.js"
Write-Host "lines.GetType(): $($lines.GetType().Name), Count: $($lines.Count)"
$r = @(1, 112)
Write-Host "r[0]=$($r[0]) r[1]=$($r[1])"
$idx = ($r[0] - 1)..($r[1] - 1)
Write-Host "idx type: $($idx.GetType().Name) first: $($idx[0]) last: $($idx[-1])"
$seg = $lines[$idx]
Write-Host "seg type: $($seg.GetType().Name) Count: $($seg.Count)"
Write-Host "seg[0]: $($seg[0])"
Write-Host "seg[1]: $($seg[1])"
Write-Host "seg[-1]: $($seg[-1])"
