# ------------------------------
# editorconfig
# ------------------------------

# Remove old editorconfig file
if (Test-Path $env:USERPROFILE\.editorconfig) {
  Write-Host "Remove $env:USERPROFILE\.editorconfig"
  Remove-Item -Path $env:USERPROFILE\.editorconfig -Force
}

# Copy new editorconfig file
Write-Host "Copy .editorconfig to $env:USERPROFILE"
Copy-Item -Path .\editorconfig\.editorconfig -Destination $env:USERPROFILE

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
