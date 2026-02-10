#!/bin/bash
# UniSlot - Run Script (Bash)
# Run: chmod +x run.sh && ./run.sh

set -e

if [[ ! -d ".venv" ]]; then
    echo "Error: .venv not found. Run ./install.sh first."
    exit 1
fi

source .venv/bin/activate

streamlit run unislot/ui.py
