#!/usr/bin/env bash
set -euo pipefail

echo "==> Installing Copilot CLI and Claude Code..."
npm install -g @github/copilot @anthropic-ai/claude-code
sudo ln -sf "$(npm prefix -g)/bin/copilot" /usr/local/bin/copilot
sudo ln -sf "$(npm prefix -g)/bin/claude" /usr/local/bin/claude

echo "==> Installing npm dependencies..."
npm install

if ls ~/.copilot/*.json &>/dev/null 2>&1; then
  echo "✔ GitHub Copilot CLI authenticated."
else
  echo "Run 'copilot auth login' to authenticate GitHub Copilot CLI."
fi
