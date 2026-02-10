# UniSlot - Run Script (PowerShell)
# Run: .\run.ps1

$ErrorActionPreference = "Stop"

if (-not (Test-Path ".\.venv")) {
    Write-Host "Error: .venv not found. Run .\install.ps1 first." -ForegroundColor Red
    exit 1
}

. .\.venv\Scripts\Activate.ps1

streamlit run unislot/ui.py
