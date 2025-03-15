# ------------------------------
# Neovim
# ------------------------------

# Remove old neovim files
if (Test-Path $env:LOCALAPPDATA\nvim) {
    Write-Host "Remove $env:LOCALAPPDATA\nvim"
    Remove-Item -Path $env:LOCALAPPDATA\nvim -Recurse -Force
}

# Copy new neovim files
Write-Host "Copy .\nvim\.config\nvim to $env:LOCALAPPDATA\nvim"
Copy-Item -Path .\nvim\.config\nvim -Destination $env:LOCALAPPDATA\nvim -Recurse
