# UniSlot - Installation Script (PowerShell)
# Run: .\install.ps1

$ErrorActionPreference = "Stop"

Write-Host "=== UniSlot Installation ==="

# Check Python version
$pythonCmd = Get-Command python -ErrorAction SilentlyContinue
if (-not $pythonCmd) {
    $pythonCmd = Get-Command py -ErrorAction SilentlyContinue
}
if (-not $pythonCmd) {
    Write-Host "Error: Python 3.11+ required, but python/py was not found." -ForegroundColor Red
    exit 1
}

$pythonExe = $pythonCmd.Path
$pythonVersion = & $pythonExe --version 2>&1
$versionParts = ($pythonVersion -split " ")[-1].Split(".")
$majorMinor = "{0}.{1}" -f $versionParts[0], $versionParts[1]

if ([version]$majorMinor -lt [version]"3.11") {
    Write-Host "Error: Python 3.11+ required. Found: $majorMinor" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Python $majorMinor detected"

# Check if uv is installed, if not install it
$uvCmd = Get-Command uv -ErrorAction SilentlyContinue
if (-not $uvCmd) {
    Write-Host "Installing uv package manager..."
    irm https://astral.sh/uv/install.ps1 | iex
    $env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
}
Write-Host "✓ uv package manager available"

# Create virtual environment and install dependencies
Write-Host "Creating virtual environment..."
uv venv .venv

Write-Host "Installing dependencies..."
. .\.venv\Scripts\Activate.ps1
uv pip install -e ".[dev]"

Write-Host ""
Write-Host "=== Installation Complete ==="
Write-Host ""
Write-Host "To activate the environment:"
Write-Host "  . .\.venv\Scripts\Activate.ps1"
Write-Host ""
Write-Host "To run the API:"
Write-Host "  uvicorn unislot.api:app --reload"
Write-Host ""
Write-Host "To run the Streamlit UI:"
Write-Host "  streamlit run unislot/ui.py"
