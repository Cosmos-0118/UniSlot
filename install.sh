#!/bin/bash
# UniSlot - Installation Script
# Run: chmod +x install.sh && ./install.sh

set -e

echo "=== UniSlot Installation ==="

# Check Python version
PYTHON_VERSION=$(python3 --version 2>&1 | cut -d' ' -f2 | cut -d'.' -f1,2)
REQUIRED_VERSION="3.11"

if [[ "$(printf '%s\n' "$REQUIRED_VERSION" "$PYTHON_VERSION" | sort -V | head -n1)" != "$REQUIRED_VERSION" ]]; then
    echo "Error: Python 3.11+ required. Found: $PYTHON_VERSION"
    exit 1
fi
echo "✓ Python $PYTHON_VERSION detected"

# Check if uv is installed, if not install it
if ! command -v uv &> /dev/null; then
    echo "Installing uv package manager..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    export PATH="$HOME/.cargo/bin:$PATH"
fi
echo "✓ uv package manager available"

# Create virtual environment and install dependencies
echo "Creating virtual environment..."
uv venv .venv

echo "Installing dependencies..."
source .venv/bin/activate
uv pip install -e ".[dev]"

echo ""
echo "=== Installation Complete ==="
echo ""
echo "To activate the environment:"
echo "  source .venv/bin/activate"
echo ""
echo "To run the API:"
echo "  uvicorn unislot.api:app --reload"
echo ""
echo "To run the Streamlit UI:"
echo "  streamlit run unislot/ui.py"
