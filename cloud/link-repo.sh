#!/usr/bin/env sh
# SessionStart hook (cloud only): expose ~/.agents inside the cloned repository so
# the protocol hooks and the relative CLI path `.agents/skills/...` work there.
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0
dir="${CLAUDE_PROJECT_DIR:-$PWD}"
[ -e "$dir/.agents" ] || ln -s "$HOME/.agents" "$dir/.agents"
exclude="$dir/.git/info/exclude"
if [ -d "$dir/.git" ] && ! grep -qx '.agents' "$exclude" 2>/dev/null; then
  mkdir -p "$dir/.git/info"
  echo '.agents' >> "$exclude"
fi
exit 0
