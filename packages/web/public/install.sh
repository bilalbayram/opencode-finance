#!/usr/bin/env bash
# Installs the opencode-finance skill for every coding agent found on this machine.
#
#   curl -fsSL https://opencode.finance/install.sh | bash
#   curl -fsSL https://opencode.finance/install.sh | bash -s -- --agents claude
#
# Arguments after `--` are passed to `fin install` (see `fin install` in the README).
# OPENCODE_FINANCE_VERSION pins a version; OPENCODE_FINANCE_TARBALL installs from a local .tgz.
set -euo pipefail

readonly PACKAGE="opencode-finance-skill"
readonly REGISTRY="${NPM_CONFIG_REGISTRY:-https://registry.npmjs.org}"

fail() {
  echo "opencode-finance: $*" >&2
  exit 1
}

command -v node >/dev/null 2>&1 || fail "Node.js 20 or newer is required: https://nodejs.org"
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' ||
  fail "Node.js 20 or newer is required (found $(node --version))"
command -v tar >/dev/null 2>&1 || fail "tar is required"

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

if [[ -n "${OPENCODE_FINANCE_TARBALL:-}" ]]; then
  cp "$OPENCODE_FINANCE_TARBALL" "$workdir/package.tgz"
else
  command -v curl >/dev/null 2>&1 || fail "curl is required"
  version="${OPENCODE_FINANCE_VERSION:-latest}"
  metadata="$(curl -fsSL "$REGISTRY/$PACKAGE/$version")" || fail "could not find $PACKAGE@$version on $REGISTRY"
  tarball="$(printf '%s' "$metadata" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).dist.tarball))')"
  curl -fsSL "$tarball" -o "$workdir/package.tgz" || fail "download failed: $tarball"
fi

tar -xzf "$workdir/package.tgz" -C "$workdir"
fin="$workdir/package/skill/scripts/fin.mjs"
[[ -f "$fin" ]] || fail "the downloaded package has no skill/scripts/fin.mjs"

# Piped through bash, stdin is this script; read answers from the terminal when there is one.
if { true </dev/tty; } 2>/dev/null; then
  node "$fin" install "$@" </dev/tty
else
  node "$fin" install --no-prompt "$@"
fi
