#!/usr/bin/env bash
# Setup script for Claude Code on the web (claude.ai/code).
# Paste into the environment's "Setup script" box:
#   curl -fsSL https://raw.githubusercontent.com/andrermaia/capacious-extremis/main/cloud/setup.sh | bash
#
# Installs the skill under ~/.agents, registers the protocol hooks in the VM's
# user settings and writes the protocol to the VM's user CLAUDE.md. Each session
# then links ~/.agents into the cloned repository (SessionStart), so the hooks
# resolve the skill and detect the project from the repository folder name.
# Requires CONTEXT_API_TOKEN in the environment variables and network access to
# api.takius.com.br (Custom allowlist). SKILL_REPO_TOKEN is optional and only
# needed if this repository is ever made private.
set -euo pipefail

SKILL="$HOME/.agents/skills/managing-system-context"
REPO="github.com/andrermaia/capacious-extremis.git"
if [ -n "${SKILL_REPO_TOKEN:-}" ]; then
  URL="https://x-access-token:${SKILL_REPO_TOKEN}@${REPO}"
else
  URL="https://${REPO}"
fi
if [ -d "$SKILL/.git" ]; then
  git -C "$SKILL" pull --ff-only -q "$URL" main || true
else
  mkdir -p "$(dirname "$SKILL")"
  git clone -q --depth 1 "$URL" "$SKILL"
  git -C "$SKILL" remote set-url origin "https://${REPO}"
fi

mkdir -p "$HOME/.claude"
node "$SKILL/cloud/install.mjs"
echo "managing-system-context: installed in $SKILL"
