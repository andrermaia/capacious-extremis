#!/usr/bin/env sh
# SessionStart hook (cloud only), called by link-repo.sh: lets the session clone
# and push to the self-hosted Gitea (git.takius.com.br), where CI/CD runs on
# Gitea Actions. GitHub is only a mirror.
#
#   1. Git authenticates on https://git.takius.com.br with TAKIUS_GIT_TOKEN. The
#      helper reads the variable when git asks, so the token never hits disk.
#   2. Every repository cloned next to the project from GitHub (owner
#      TAKIUS_GITHUB_OWNER) gets a `takius` remote pointing at the same name on
#      the Gitea (owner TAKIUS_GIT_OWNER).
#
# Needs, in the environment: TAKIUS_GIT_TOKEN (Gitea token, repository read and
# write) and git.takius.com.br in the network allowlist. Without the token it
# does nothing. No network here: the hook has a 10 s timeout.
#
# Repositories attached mid-session are not seen by the hook; run this script
# again by hand after cloning them:
#   sh ~/.agents/skills/managing-system-context/cloud/takius-git.sh
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0
[ -n "${TAKIUS_GIT_TOKEN:-}" ] || exit 0

host="${TAKIUS_GIT_HOST:-git.takius.com.br}"
gitea_owner="${TAKIUS_GIT_OWNER:-andre}"
github_owner="${TAKIUS_GITHUB_OWNER:-andrermaia}"
key="credential.https://$host.helper"

# The empty entry drops any helper configured before this one, so git does not
# ask another helper (or prompt) for this host.
git config --global --unset-all "$key" 2>/dev/null
git config --global --add "$key" ''
git config --global --add "$key" \
  '!f() { [ "$1" = get ] || exit 0; echo "username=${TAKIUS_GIT_USER:-'"$gitea_owner"'}"; echo "password=${TAKIUS_GIT_TOKEN}"; }; f'

dir="${CLAUDE_PROJECT_DIR:-$PWD}"
# One-repository session: the project is the clone, its siblings sit beside it.
# Multi-repository session: the project dir is the folder holding the clones.
if [ -d "$dir/.git" ]; then parent=$(dirname "$dir"); else parent="$dir"; fi
root="${TAKIUS_SCAN_DIR:-$parent}"
for repo in "$root"/*/; do
  repo="${repo%/}"
  [ -d "$repo/.git" ] || continue
  origin=$(git -C "$repo" remote get-url origin 2>/dev/null) || continue
  # https://github.com/<owner>/<name>(.git) or a proxy URL ending in <owner>/<name>.
  name=$(printf '%s\n' "$origin" | sed -n "s#.*[/:]$github_owner/\([^/]*\)\$#\1#p")
  name="${name%.git}"
  [ -n "$name" ] || continue
  url="https://$host/$gitea_owner/$name.git"
  if git -C "$repo" remote get-url takius >/dev/null 2>&1; then
    git -C "$repo" remote set-url takius "$url"
  else
    git -C "$repo" remote add takius "$url"
  fi
done
exit 0
