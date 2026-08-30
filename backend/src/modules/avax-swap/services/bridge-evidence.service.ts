import {
  createEvidenceCorrelation,
  EvidenceIntentInput,
  getTransactionEvidence,
  persistEvidenceIntent,
  persistPreparedEvidence,
  PreparedEvidenceResult,
} from "../../../shared/services/transaction-evidence.service";
import {
  PreparedTransaction,
  TransactionBundle,
} from "../../../types/transaction";

const AVALANCHE_CHAIN_ID = 43114;
const AVALANCHE_NETWORK = "avalanche-c-chain";

export interface BeginAvaxBridgeEvidenceInput {
  userAddress: string;
  destinationChainId: number;
  sourceToken: string;
  destinationToken?: string;
  amountRaw: string;
}

export interface BeginAvaxBridgeEvidenceResult {
  correlationId: string;
  evidenceVersion: string;
  evidenceEnabled: boolean;
}

export interface CommitAvaxBridgeEvidenceInput {
  correlationId: string;
  destinationChainId: number;
  provider: string;
  steps: PreparedTransaction[];
}

function bridgeAction(destinationChainId: number): string {
  return `bridge-source:${destinationChainId}`;
}

function isEvmAddress(value: string | undefined): boolean {
  return (
    typeof value === "string" &&
    /^0x[a-fA-F0-9]{40}$/.test(value)
  );
}

export async function beginAvaxBridgeEvidence(
  input: BeginAvaxBridgeEvidenceInput
): Promise<BeginAvaxBridgeEvidenceResult> {
  if (
    !Number.isInteger(input.destinationChainId) ||
    input.destinationChainId <= 0 ||
    input.destinationChainId === AVALANCHE_CHAIN_ID
  ) {
    throw new Error(
      "Avalanche bridge source evidence requires a different valid destination chain"
    );
  }

  if (
    typeof input.userAddress !== "string" ||
    !isEvmAddress(input.userAddress)
  ) {
    throw new Error("A valid source wallet address is required");
  }

  if (
    typeof input.sourceToken !== "string" ||
    !isEvmAddress(input.sourceToken)
  ) {
    throw new Error("A valid Avalanche source token is required");
  }

  if (
    typeof input.amountRaw !== "string" ||
    !/^[0-9]+$/.test(input.amountRaw) ||
    BigInt(input.amountRaw) <= 0n
  ) {
    throw new Error("A positive raw bridge amount is required");
  }

  const evidence = createEvidenceCorrelation();

  const intent: EvidenceIntentInput = {
    correlationId: evidence.correlationId,
    createdAt: new Date().toISOString(),
    action: bridgeAction(input.destinationChainId),
    chainId: AVALANCHE_CHAIN_ID,
    network: AVALANCHE_NETWORK,
    walletAddress: input.userAddress,
    assetIn: input.sourceToken,
    // Cross-chain destinations are not necessarily EVM-addressed
    // (e.g. TON). Persist assetOut only when it is an EVM address.
    assetOut: isEvmAddress(input.destinationToken)
      ? input.destinationToken
      : undefined,
    amountRaw: input.amountRaw,
  };

  await persistEvidenceIntent(intent);

  return {
    correlationId: evidence.correlationId,
    evidenceVersion: evidence.evidenceVersion,
    evidenceEnabled: evidence.enabled,
  };
}

export async function commitAvaxBridgeEvidence(
  input: CommitAvaxBridgeEvidenceInput
): Promise<PreparedEvidenceResult> {
  if (
    !Number.isInteger(input.destinationChainId) ||
    input.destinationChainId <= 0 ||
    input.destinationChainId === AVALANCHE_CHAIN_ID
  ) {
    throw new Error(
      "Avalanche bridge source evidence requires a different valid destination chain"
    );
  }

  if (
    typeof input.provider !== "string" ||
    !input.provider.trim()
  ) {
    throw new Error("Bridge provider is required");
  }

  if (!Array.isArray(input.steps) || input.steps.length === 0) {
    throw new Error(
      "Avalanche bridge source evidence requires at least one transaction"
    );
  }

  if (
    input.steps.some(
      (step) => Number(step.chainId) !== AVALANCHE_CHAIN_ID
    )
  ) {
    throw new Error(
      "Avalanche bridge source evidence may only commit chain 43114 transactions"
    );
  }

  const stored = await getTransactionEvidence(
    input.correlationId
  );

  const evidence = stored.evidence as any;
  const expectedAction = bridgeAction(
    input.destinationChainId
  );

  if (Number(evidence.chainId) !== AVALANCHE_CHAIN_ID) {
    throw new Error(
      "Persisted evidence intent is not an Avalanche source operation"
    );
  }

  if (evidence.action !== expectedAction) {
    throw new Error(
      "Bridge destination does not match persisted evidence intent"
    );
  }

  if (
    evidence.status &&
    evidence.status !== "intent-recorded"
  ) {
    throw new Error(
      `Bridge evidence cannot be prepared from status ${evidence.status}`
    );
  }

  if (
    Array.isArray(stored.steps) &&
    stored.steps.length > 0
  ) {
    throw new Error(
      "Bridge evidence already contains prepared transaction steps"
    );
  }

  const createdAt =
    typeof evidence.createdAt === "string"
      ? evidence.createdAt
      : typeof evidence.intent?.requestTimestamp === "string"
        ? evidence.intent.requestTimestamp
        : undefined;

  if (!createdAt) {
    throw new Error(
      "Persisted bridge evidence intent is missing its creation timestamp"
    );
  }

  const persistedIntent: EvidenceIntentInput = {
    correlationId: input.correlationId,
    createdAt,
    action: evidence.action,
    chainId: Number(evidence.chainId),
    network: evidence.network,
    walletAddress: evidence.walletAddress,
    assetIn: evidence.assetIn || undefined,
    assetOut: evidence.assetOut || undefined,
    amountRaw: evidence.amountRaw || undefined,
    slippageBps:
      typeof evidence.slippageBps === "number"
        ? evidence.slippageBps
        : undefined,
  };

  const bundle: TransactionBundle = {
    // Preserve caller-supplied order exactly. This order becomes
    // the committed signing order.
    steps: input.steps,
    totalSteps: input.steps.length,
    summary:
      `Avalanche bridge source via ${input.provider} ` +
      `to chain ${input.destinationChainId}`,
  };

  return persistPreparedEvidence(
    persistedIntent,
    bundle,
    {
      action: "bridge-source",
      destinationChainId: input.destinationChainId,
      provider: input.provider,
    }
  );
}
