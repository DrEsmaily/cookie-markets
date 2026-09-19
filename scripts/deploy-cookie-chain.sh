#!/usr/bin/env bash
set -euo pipefail

RPC_URL="https://rpc.cookiescan.io"
EXPECTED_GENESIS="9wDaBRDgArEUpvhHxGguNkwozsZh4UpGZB9o2EoEcBB2"
PROGRAM_ADDRESS="BNqof3tMVwNd7rthycJTtXkvbGtopihvL9gpeoSk8WaR"
UPGRADE_AUTHORITY="DQUuBvSGVAnqcXAJs2ZEcXtkXqMcMEX7JxqcZ2Yki86a"
PROGRAM_KEYPAIR="${PROGRAM_KEYPAIR:-.local-secrets/cookie-markets-program-keypair.json}"
DEPLOYER_KEYPAIR="${DEPLOYER_KEYPAIR:-.local-secrets/cookie-markets-deployer-keypair.json}"
PROGRAM_BINARY="${1:-target/deploy/cookie_markets.so}"

if [[ "${COOKIE_MARKETS_DEPLOY_APPROVED:-}" != "yes" ]]; then
  echo "Refusing deployment. Set COOKIE_MARKETS_DEPLOY_APPROVED=yes only after reviewing the final binary and cost."
  exit 1
fi

for path in "$PROGRAM_KEYPAIR" "$DEPLOYER_KEYPAIR" "$PROGRAM_BINARY"; do
  if [[ ! -f "$path" ]]; then
    echo "Missing required file: $path"
    exit 1
  fi
done

actual_genesis="$(solana genesis-hash --url "$RPC_URL")"
if [[ "$actual_genesis" != "$EXPECTED_GENESIS" ]]; then
  echo "Wrong network genesis: $actual_genesis"
  exit 1
fi

actual_program="$(solana-keygen pubkey "$PROGRAM_KEYPAIR")"
if [[ "$actual_program" != "$PROGRAM_ADDRESS" ]]; then
  echo "Program key mismatch: $actual_program"
  exit 1
fi

if [[ -z "${EXPECTED_SHA256:-}" ]]; then
  echo "EXPECTED_SHA256 is required."
  exit 1
fi

actual_sha256="$(shasum -a 256 "$PROGRAM_BINARY" | awk '{print $1}')"
if [[ "$actual_sha256" != "$EXPECTED_SHA256" ]]; then
  echo "Binary digest mismatch: $actual_sha256"
  exit 1
fi

deployer="$(solana-keygen pubkey "$DEPLOYER_KEYPAIR")"
echo "Network genesis: $actual_genesis"
echo "Program: $PROGRAM_ADDRESS"
echo "Binary SHA-256: $actual_sha256"
echo "Deployer: $deployer"
echo "Deployer balance: $(solana balance "$deployer" --url "$RPC_URL")"

solana program deploy \
  --url "$RPC_URL" \
  --use-rpc \
  --commitment confirmed \
  --max-sign-attempts 10 \
  --keypair "$DEPLOYER_KEYPAIR" \
  --fee-payer "$DEPLOYER_KEYPAIR" \
  --upgrade-authority "$DEPLOYER_KEYPAIR" \
  --program-id "$PROGRAM_KEYPAIR" \
  "$PROGRAM_BINARY"

solana program set-upgrade-authority \
  --url "$RPC_URL" \
  --commitment confirmed \
  --keypair "$DEPLOYER_KEYPAIR" \
  --upgrade-authority "$DEPLOYER_KEYPAIR" \
  --new-upgrade-authority "$UPGRADE_AUTHORITY" \
  --skip-new-upgrade-authority-signer-check \
  "$PROGRAM_ADDRESS"

solana program show --url "$RPC_URL" "$PROGRAM_ADDRESS"
