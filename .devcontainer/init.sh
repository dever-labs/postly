#!/usr/bin/env bash
set -euo pipefail

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${CYAN}==> Installing Copilot CLI and Claude Code...${NC}"
npm install -g @github/copilot @anthropic-ai/claude-code
sudo ln -sf "$(npm prefix -g)/bin/copilot" /usr/local/bin/copilot
sudo ln -sf "$(npm prefix -g)/bin/claude" /usr/local/bin/claude

echo -e "${CYAN}==> Installing npm dependencies...${NC}"
npm install

echo -e ""
echo -e "${GREEN}✔ Devcontainer ready!${NC}"
echo -e ""
echo -e "Quick-start commands:"
echo -e "  ${YELLOW}npm run dev${NC}    — start the app in development mode"
echo -e "  ${YELLOW}npm test${NC}       — run tests"
echo -e ""

if ls ~/.copilot/*.json &>/dev/null 2>&1; then
  echo -e "${GREEN}✔ GitHub Copilot CLI authenticated.${NC}"
else
  echo -e "Run ${YELLOW}copilot auth login${NC} to authenticate GitHub Copilot CLI."
  echo -e "Credentials persist in a Docker volume — no re-login needed after rebuild."
fi
