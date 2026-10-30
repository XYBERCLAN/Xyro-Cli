#!/usr/bin/env bash
# Prepare a throwaway project and an isolated XYRO home for the README demo.
# Nothing touches your real XYRO config, sessions or API keys.
#
#   source docs/demo/setup.sh    # sets DEMO_DIR and the XDG_* variables
set -euo pipefail

DEMO_ROOT="${DEMO_ROOT:-$(mktemp -d -t xyro-demo-XXXXXX)}"
export DEMO_DIR="$DEMO_ROOT/shop-api"
export XDG_CONFIG_HOME="$DEMO_ROOT/config"
export XDG_DATA_HOME="$DEMO_ROOT/data"
export XDG_STATE_HOME="$DEMO_ROOT/state"
export HOME="$DEMO_ROOT/home"   # the theme and undo history live under ~/.xyro
mkdir -p "$HOME"
export XYRO_NO_UPDATE_CHECK=1 XYRO_LINK=off XYRO_LEARN=off XYRO_IMPORT=off XYRO_HEDGE=off

mkdir -p "$DEMO_DIR/src" "$DEMO_DIR/test" "$XDG_CONFIG_HOME/xyro"
# Point XYRO at the scripted model (docs/demo/fake-model.mjs) so the recording shows a plain `xyro`
cat > "$XDG_CONFIG_HOME/xyro/config.json" <<'EOF'
{ "language": "en", "provider": "Demo", "model": "xyro-demo", "baseURL": "http://127.0.0.1:4545/v1", "apiKey": "demo" }
EOF
date -u +%FT%TZ > "$XDG_CONFIG_HOME/xyro/.onboarded"   # skip the first-run welcome

cat > "$DEMO_DIR/package.json" <<'EOF'
{ "name": "shop-api", "version": "1.0.0", "type": "module", "scripts": { "test": "node --test" } }
EOF

cat > "$DEMO_DIR/src/signup.js" <<'EOF'
export function signup({ email, password }) {
  return { ok: true, user: { email } };
}
EOF

cat > "$DEMO_DIR/test/signup.test.js" <<'EOF'
import { test } from "node:test";
import assert from "node:assert/strict";
import { signup } from "../src/signup.js";

test("accepts a valid account", () => assert.equal(signup({ email: "ada@shop.dev", password: "correct-horse" }).ok, true));
test("rejects an empty email", () => assert.equal(signup({ email: "", password: "correct-horse" }).ok, false));
test("rejects a malformed email", () => assert.equal(signup({ email: "ada@", password: "correct-horse" }).ok, false));
test("rejects a short password", () => assert.equal(signup({ email: "ada@shop.dev", password: "123" }).ok, false));
EOF

(cd "$DEMO_DIR" && git init -q && git add -A && git -c user.name=demo -c user.email=demo@example.com -c commit.gpgsign=false commit -qm init)
echo "demo project: $DEMO_DIR"
