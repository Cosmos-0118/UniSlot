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

# Get Python version string robustly
$pythonVersion = & $pythonExe --version 2>&1
# Extract version number using regex (matches first X.Y or X.Y.Z)
$versionMatch = [regex]::Match($pythonVersion, '(\d+)\.(\d+)(?:\.(\d+))?')
if (-not $versionMatch.Success) {
    Write-Host "Error: Could not parse Python version from: $pythonVersion" -ForegroundColor Red
    exit 1
}
$majorMinor = "$($versionMatch.Groups[1].Value).$($versionMatch.Groups[2].Value)"

if ([version]$majorMinor -lt [version]"3.11") {
    Write-Host "Error: Python 3.11+ required. Found: $majorMinor" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Python $majorMinor detected"

# Check if uv is installed, if not install it

# Check if uv is installed, if not install it and update PATH
$uvCmd = Get-Command uv -ErrorAction SilentlyContinue
if (-not $uvCmd) {
    Write-Host "Installing uv package manager..."
    irm https://astral.sh/uv/install.ps1 | iex
    # Add both .local/bin and .cargo/bin to PATH for compatibility
    $env:PATH = "$env:USERPROFILE\.local\bin;$env:USERPROFILE\.cargo\bin;$env:PATH"
    # Try to get uv again after install
    $uvCmd = Get-Command uv -ErrorAction SilentlyContinue
    if (-not $uvCmd) {
        Write-Host "Error: uv installation failed or not found in PATH." -ForegroundColor Red
        exit 1
    }
}
else {
    # Ensure PATH includes .local/bin and .cargo/bin for future shells
    $env:PATH = "$env:USERPROFILE\.local\bin;$env:USERPROFILE\.cargo\bin;$env:PATH"
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
