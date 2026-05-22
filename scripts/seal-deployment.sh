#!/usr/bin/env bash
# seal-deployment.sh
#
# Post-broadcast helper. Reads Foundry's broadcast log for a given chain id and patches each
# deployments/<chain-slug>/*.json with the real blockNumber + txHash + deployedAt produced by
# the broadcast. Use after running DeployV2.s.sol --broadcast.
#
# Usage:
#   scripts/seal-deployment.sh <chain-slug> <chain-id> <script-name>
#
# Example:
#   scripts/seal-deployment.sh base 8453 DeployV2.s.sol
#
# Requires: jq, foundry (cast).
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "Usage: $0 <chain-slug> <chain-id> <script-name>"
  echo "  chain-slug:  base | avalanche | ethereum | base-sepolia"
  echo "  chain-id:    8453 | 43114 | 1 | 84532"
  echo "  script-name: DeployV2.s.sol | DeployMoonwell.s.sol | ..."
  exit 1
fi

CHAIN_SLUG="$1"
CHAIN_ID="$2"
SCRIPT_NAME="$3"

BROADCAST_DIR="broadcast/${SCRIPT_NAME}/${CHAIN_ID}"
RUN_LATEST="${BROADCAST_DIR}/run-latest.json"

if [ ! -f "$RUN_LATEST" ]; then
  echo "ERROR: broadcast log not found at $RUN_LATEST"
  echo "Did you run 'forge script ... --broadcast' targeting chain id $CHAIN_ID?"
  exit 1
fi

DEPLOY_DIR="deployments/${CHAIN_SLUG}"
if [ ! -d "$DEPLOY_DIR" ]; then
  echo "ERROR: no deployments dir at $DEPLOY_DIR"
  exit 1
fi

NOW="$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")"

echo "Sealing deployments in ${DEPLOY_DIR} from ${RUN_LATEST}"

# Map contractName → contractAddress from broadcast log
jq -r '.transactions[]
  | select(.transactionType == "CREATE")
  | "\(.contractName) \(.contractAddress) \(.hash)"' "$RUN_LATEST" \
  | while read -r CONTRACT_NAME CONTRACT_ADDR TX_HASH; do
    # Find the matching JSON in deployments/<chain-slug>/
    if [ "$CONTRACT_NAME" = "UpgradeableBeacon" ]; then
      JSON_FILE="${DEPLOY_DIR}/AerodromeBeacon.json"
    else
      JSON_FILE="${DEPLOY_DIR}/${CONTRACT_NAME}.json"
    fi

    if [ ! -f "$JSON_FILE" ]; then
      echo "  SKIP: no artifact file for $CONTRACT_NAME at $JSON_FILE"
      continue
    fi

    # Look up block number from the receipt
    RECEIPT=$(jq -r --arg h "$TX_HASH" \
      '.receipts[] | select(.transactionHash == $h) | .blockNumber // ""' \
      "$RUN_LATEST")
    BLOCK_NUMBER=0
    if [ -n "$RECEIPT" ] && [ "$RECEIPT" != "null" ]; then
      BLOCK_NUMBER=$((RECEIPT))
    fi

    echo "  ${CONTRACT_NAME} → ${CONTRACT_ADDR} (tx ${TX_HASH}, block ${BLOCK_NUMBER})"

    tmp="${JSON_FILE}.tmp"
    jq --arg addr "$CONTRACT_ADDR" \
       --arg tx "$TX_HASH" \
       --arg now "$NOW" \
       --argjson block "$BLOCK_NUMBER" \
       --arg verified_url "https://basescan.org/address/${CONTRACT_ADDR}#code" \
       '.address = $addr
        | .txHash = $tx
        | .deployedAt = $now
        | .blockNumber = $block
        | .verifiedUrl = $verified_url' \
       "$JSON_FILE" > "$tmp"
    mv "$tmp" "$JSON_FILE"
  done

echo ""
echo "Done. Next: run 'forge verify-contract' for any contract whose --verify failed inline,"
echo "then set 'verified: true' in the corresponding JSON manually."
