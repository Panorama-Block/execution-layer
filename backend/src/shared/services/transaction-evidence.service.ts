import { randomUUID } from "crypto";
import { ethers } from "ethers";
import { TransactionBundle } from "../../types/transaction";
import { logger } from "../logger";

const EVIDENCE_VERSION = "1.0";
const DEFAULT_TENANT_ID = "panorama-default";

export interface EvidenceIntentInput {
  correlationId: string;
  createdAt: string;
  action: string;
  chainId: number;
  network: string;
  walletAddress: string;
  assetIn?: string;
  assetOut?: string;
  amountRaw?: string;
  slippageBps?: number;
}

export interface PreparedEvidenceResult {
  correlationId: string;
  evidenceVersion: string;
  evidenceEnabled: boolean;
  preparedPayloadHash: string;
}

interface CanonicalPreparedStep {
  stepIndex: number;
  action: string;
  chainId: number;
  to: string;
  value: string;
  dataHash: string;
}

function evidenceEnabled(): boolean {
  return process.env.PHASE2_EVIDENCE_ENABLED === "true";
}

function gatewayConfig(): {
  url: string;
  token: string;
  tenantId: string;
  timeoutMs: number;
} {
  const url = process.env.DB_GATEWAY_URL?.replace(/\/+$/, "");
  const token = process.env.DB_GATEWAY_SERVICE_TOKEN;
  const tenantId =
    process.env.DB_GATEWAY_TENANT_ID?.trim() || DEFAULT_TENANT_ID;
  const timeoutMs = Number(process.env.DB_GATEWAY_TIMEOUT_MS || "5000");

  if (!url) {
    throw new Error(
      "PHASE2_EVIDENCE_ENABLED=true but DB_GATEWAY_URL is not configured"
    );
  }

  if (!token) {
    throw new Error(
      "PHASE2_EVIDENCE_ENABLED=true but DB_GATEWAY_SERVICE_TOKEN is not configured"
    );
  }

  return {
    url,
    token,
    tenantId,
    timeoutMs:
      Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 5000,
  };
}

async function gatewayRequest(
  path: string,
  init: RequestInit,
  idempotencyKey: string
): Promise<unknown> {
  const config = gatewayConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(`${config.url}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.token}`,
        "X-Tenant-Id": config.tenantId,
        "Idempotency-Key": idempotencyKey,
        ...(init.headers || {}),
      },
    });

    const text = await response.text();

    if (!response.ok) {
      throw new Error(
        `Database Gateway ${response.status}: ${text.slice(0, 500)}`
      );
    }

    return text ? JSON.parse(text) : null;
  } finally {
    clearTimeout(timer);
  }
}

function normaliseAddress(value: string): string {
  return value.toLowerCase();
}

function deriveStepAction(
  data: string,
  description: string | undefined,
  stepIndex: number
): string {
  const selector = (data || "0x").slice(0, 10).toLowerCase();

  if (selector === "0x095ea7b3") {
    return "approval";
  }

  const descriptionLower = (description || "").toLowerCase();

  if (descriptionLower.includes("wrap")) {
    return "wrap";
  }

  if (descriptionLower.includes("unwrap")) {
    return "unwrap";
  }

  if (descriptionLower.includes("swap")) {
    return "swap";
  }

  return `step-${stepIndex}`;
}

function hashJson(value: unknown): string {
  return ethers.keccak256(
    ethers.toUtf8Bytes(JSON.stringify(value))
  );
}

export function createEvidenceCorrelation(): {
  correlationId: string;
  evidenceVersion: string;
  enabled: boolean;
} {
  return {
    correlationId: randomUUID(),
    evidenceVersion: EVIDENCE_VERSION,
    enabled: evidenceEnabled(),
  };
}

export async function persistEvidenceIntent(
  input: EvidenceIntentInput
): Promise<void> {
  if (!evidenceEnabled()) {
    return;
  }

  const config = gatewayConfig();

  const intent = {
    action: input.action,
    chainId: input.chainId,
    network: input.network,
    walletAddress: normaliseAddress(input.walletAddress),
    assetIn: input.assetIn
      ? normaliseAddress(input.assetIn)
      : undefined,
    assetOut: input.assetOut
      ? normaliseAddress(input.assetOut)
      : undefined,
    amountRaw: input.amountRaw,
    slippageBps: input.slippageBps,
    requestTimestamp: input.createdAt,
  };

  await gatewayRequest(
    "/v1/transaction-evidence",
    {
      method: "POST",
      body: JSON.stringify({
        correlationId: input.correlationId,
        evidenceVersion: EVIDENCE_VERSION,
        action: input.action,
        chainId: input.chainId,
        network: input.network,
        walletAddress: normaliseAddress(input.walletAddress),
        assetIn: input.assetIn
          ? normaliseAddress(input.assetIn)
          : undefined,
        assetOut: input.assetOut
          ? normaliseAddress(input.assetOut)
          : undefined,
        amountRaw: input.amountRaw,
        slippageBps: input.slippageBps,
        intent,
        status: "intent-recorded",
        sourceService: "execution-layer",
        tenantId: config.tenantId,
        createdAt: input.createdAt,
      }),
    },
    `phase2-intent:${input.correlationId}`
  );

  logger.info(
    {
      correlationId: input.correlationId,
      chainId: input.chainId,
      evidenceVersion: EVIDENCE_VERSION,
    },
    "Phase 2 transaction intent persisted"
  );
}

export async function persistPreparedEvidence(
  input: EvidenceIntentInput,
  bundle: TransactionBundle,
  metadata: Record<string, unknown>
): Promise<PreparedEvidenceResult> {
  const preparedAt = new Date().toISOString();

  const canonicalSteps: CanonicalPreparedStep[] =
    bundle.steps.map((step, stepIndex) => {
      const data = step.data || "0x";

      return {
        stepIndex,
        action: deriveStepAction(
          data,
          step.description,
          stepIndex
        ),
        chainId: Number(step.chainId),
        to: normaliseAddress(step.to),
        value: String(step.value || "0"),
        dataHash: ethers.keccak256(data),
      };
    });

  const canonicalPreparedPayload = {
    evidenceVersion: EVIDENCE_VERSION,
    chainId: input.chainId,
    network: input.network,
    walletAddress: normaliseAddress(input.walletAddress),
    action: input.action,
    assetIn: input.assetIn
      ? normaliseAddress(input.assetIn)
      : null,
    assetOut: input.assetOut
      ? normaliseAddress(input.assetOut)
      : null,
    amountRaw: input.amountRaw || null,
    steps: canonicalSteps,
  };

  const preparedPayloadHash =
    hashJson(canonicalPreparedPayload);

  if (!evidenceEnabled()) {
    return {
      correlationId: input.correlationId,
      evidenceVersion: EVIDENCE_VERSION,
      evidenceEnabled: false,
      preparedPayloadHash,
    };
  }

  const config = gatewayConfig();

  const ops = [
    {
      op: "update",
      entity: "transaction-evidence",
      args: {
        id: input.correlationId,
        data: {
          preparedPayloadHash,
          preparedAt,
          preparedMetadata: {
            bundleSummary: bundle.summary,
            totalSteps: bundle.totalSteps,
            metadata,
          },
          status: "prepared",
        },
      },
    },
    ...canonicalSteps.map((step) => ({
      op: "create",
      entity: "transaction-evidence-steps",
      args: {
        data: {
          id: `${input.correlationId}:${step.stepIndex}`,
          correlationId: input.correlationId,
          stepIndex: step.stepIndex,
          action: step.action,
          chainId: step.chainId,
          toAddress: step.to,
          value: step.value,
          dataHash: step.dataHash,
          preparedStepHash: hashJson(step),
          preparedAt,
          tenantId: config.tenantId,
        },
      },
    })),
  ];

  await gatewayRequest(
    "/v1/_transact",
    {
      method: "POST",
      body: JSON.stringify({ ops }),
    },
    `phase2-prepared:${input.correlationId}:${preparedPayloadHash}`
  );

  logger.info(
    {
      correlationId: input.correlationId,
      chainId: input.chainId,
      preparedPayloadHash,
      totalSteps: canonicalSteps.length,
    },
    "Phase 2 prepared transaction evidence persisted"
  );

  return {
    correlationId: input.correlationId,
    evidenceVersion: EVIDENCE_VERSION,
    evidenceEnabled: true,
    preparedPayloadHash,
  };
}

interface GatewayEnvelope<T> {
  data: T;
}

interface GatewayListEnvelope<T> {
  data: T[];
  page?: {
    take?: number;
    skip?: number;
    nextCursor?: Record<string, unknown> | null;
  };
}

interface StoredEvidence {
  correlationId: string;
  evidenceVersion: string;
  action: string;
  chainId: number;
  network: string;
  walletAddress: string;
  assetIn?: string | null;
  assetOut?: string | null;
  amountRaw?: string | null;
  slippageBps?: number | null;
  intent: Record<string, unknown>;
  preparedPayloadHash?: string | null;
  preparedAt?: string | null;
  preparedMetadata?: Record<string, unknown> | null;
  status: string;
  verificationStatus?: string | null;
  errorReason?: string | null;
  sourceService?: string | null;
  createdAt?: string;
  updatedAt?: string;
  verifiedAt?: string | null;
}

interface StoredEvidenceStep {
  id: string;
  correlationId: string;
  stepIndex: number;
  action: string;
  chainId: number;
  toAddress: string;
  value: string;
  dataHash: string;
  preparedStepHash: string;
  preparedAt?: string;
  txHash?: string | null;
  submittedAt?: string | null;
  executionMechanism?: string | null;
  providerMetadata?: Record<string, unknown> | null;
  blockNumber?: string | null;
  blockHash?: string | null;
  receiptStatus?: number | null;
  fromAddress?: string | null;
  receiptToAddress?: string | null;
  contractAddress?: string | null;
  gasUsed?: string | null;
  effectiveGasPrice?: string | null;
  logsHash?: string | null;
  receipt?: Record<string, unknown> | null;
  receiptRetrievedAt?: string | null;
  verified?: boolean | null;
  receiptMatchesSubmission?: boolean | null;
  senderMatchesExpected?: boolean | null;
  destinationMatchesExpected?: boolean | null;
  chainMatchesExpected?: boolean | null;
  verificationSource?: string | null;
  verification?: Record<string, unknown> | null;
  verificationError?: string | null;
  verifiedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface SubmitEvidenceInput {
  correlationId: string;
  stepIndex: number;
  txHash: string;
  executionMechanism?: string;
  providerMetadata?: Record<string, unknown>;
  chain: "avalanche" | "base";
}

export interface VerificationResult {
  correlationId: string;
  stepIndex: number;
  txHash: string;
  verified: boolean;
  receiptStatus: number | null;
  blockNumber: string;
  blockHash: string;
  senderMatchesExpected: boolean;
  destinationMatchesExpected: boolean;
  chainMatchesExpected: boolean;
  dataMatchesExpected: boolean;
  valueMatchesExpected: boolean;
}

async function gatewayGet<T>(path: string): Promise<T> {
  const config = gatewayConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(`${config.url}${path}`, {
      method: "GET",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.token}`,
        "X-Tenant-Id": config.tenantId,
      },
    });

    const text = await response.text();

    if (!response.ok) {
      throw new Error(
        `Database Gateway ${response.status}: ${text.slice(0, 500)}`
      );
    }

    const parsed = text ? JSON.parse(text) : null;

    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      "data" in parsed
    ) {
      return (parsed as GatewayEnvelope<T>).data;
    }

    return parsed as T;
  } finally {
    clearTimeout(timer);
  }
}

async function gatewayList<T>(
  path: string
): Promise<GatewayListEnvelope<T>> {
  const config = gatewayConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(`${config.url}${path}`, {
      method: "GET",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.token}`,
        "X-Tenant-Id": config.tenantId,
      },
    });

    const text = await response.text();

    if (!response.ok) {
      throw new Error(
        `Database Gateway ${response.status}: ${text.slice(0, 500)}`
      );
    }

    const parsed = text ? JSON.parse(text) : null;

    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      !Array.isArray((parsed as GatewayListEnvelope<T>).data)
    ) {
      throw new Error("Database Gateway returned an invalid list response");
    }

    return parsed as GatewayListEnvelope<T>;
  } finally {
    clearTimeout(timer);
  }
}

async function listStoredEvidenceByWallet(
  walletAddress: string,
  chainId = 43114
): Promise<StoredEvidence[]> {
  const records: StoredEvidence[] = [];
  const take = 1000;
  let skip = 0;

  while (true) {
    const where = encodeURIComponent(
      JSON.stringify({
        walletAddress: walletAddress.toLowerCase(),
        chainId,
      })
    );
    const orderBy = encodeURIComponent(
      JSON.stringify({ createdAt: "asc" })
    );

    const result = await gatewayList<StoredEvidence>(
      `/v1/transaction-evidence?where=${where}&orderBy=${orderBy}&take=${take}&skip=${skip}`
    );

    records.push(...result.data);

    if (result.data.length < take) {
      break;
    }

    skip += take;
  }

  return records;
}

async function gatewayPatch(
  entity: string,
  id: string,
  data: Record<string, unknown>,
  idempotencyKey: string
): Promise<void> {
  await gatewayRequest(
    `/v1/${entity}/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: JSON.stringify(data),
    },
    idempotencyKey
  );
}

function canonicalLogsHash(
  logs: readonly ethers.Log[]
): string {
  const canonical = logs.map((log) => ({
    address: log.address.toLowerCase(),
    topics: [...log.topics].map((topic) => topic.toLowerCase()),
    data: log.data.toLowerCase(),
    blockNumber: String(log.blockNumber),
    transactionHash: log.transactionHash.toLowerCase(),
    transactionIndex: log.transactionIndex,
    index: log.index,
  }));

  return hashJson(canonical);
}

export async function submitAndVerifyEvidence(
  input: SubmitEvidenceInput
): Promise<VerificationResult> {
  if (!evidenceEnabled()) {
    throw new Error(
      "Transaction evidence submission requires PHASE2_EVIDENCE_ENABLED=true"
    );
  }

  if (!/^0x[a-fA-F0-9]{64}$/.test(input.txHash)) {
    throw new Error("Invalid transaction hash");
  }

  if (!Number.isInteger(input.stepIndex) || input.stepIndex < 0) {
    throw new Error("Invalid step index");
  }

  const parent = await gatewayGet<StoredEvidence>(
    `/v1/transaction-evidence/${encodeURIComponent(input.correlationId)}`
  );

  const stepId = `${input.correlationId}:${input.stepIndex}`;

  const step = await gatewayGet<StoredEvidenceStep>(
    `/v1/transaction-evidence-steps/${encodeURIComponent(stepId)}`
  );

  if (!parent || !step) {
    throw new Error("Evidence record or prepared step not found");
  }

  if (step.correlationId !== input.correlationId) {
    throw new Error("Evidence correlation mismatch");
  }

  if (step.stepIndex !== input.stepIndex) {
    throw new Error("Evidence step mismatch");
  }

  const submittedAt = new Date().toISOString();

  await gatewayPatch(
    "transaction-evidence-steps",
    step.id,
    {
      txHash: input.txHash.toLowerCase(),
      submittedAt,
      executionMechanism:
        input.executionMechanism || "thirdweb-client",
      providerMetadata: input.providerMetadata || {},
    },
    `phase2-submission:${input.correlationId}:${input.stepIndex}:${input.txHash.toLowerCase()}`
  );

  const { getProvider } = await import("../../providers/chain.provider");

  const provider = getProvider(input.chain);

  const [network, tx, receipt] = await Promise.all([
    provider.getNetwork(),
    provider.getTransaction(input.txHash),
    provider.getTransactionReceipt(input.txHash),
  ]);

  if (!tx) {
    throw new Error(`Transaction ${input.txHash} not found via independent RPC`);
  }

  if (!receipt) {
    throw new Error(`Receipt ${input.txHash} not found via independent RPC`);
  }

  const actualChainId = Number(network.chainId);
  const expectedChainId = step.chainId;

  const senderMatchesExpected =
    tx.from.toLowerCase() === parent.walletAddress.toLowerCase();

  const destinationMatchesExpected =
    (tx.to || "").toLowerCase() === step.toAddress.toLowerCase();

  const chainMatchesExpected =
    actualChainId === expectedChainId &&
    parent.chainId === expectedChainId;

  const actualDataHash = ethers.keccak256(tx.data || "0x");
  const dataMatchesExpected =
    actualDataHash.toLowerCase() === step.dataHash.toLowerCase();

  const valueMatchesExpected =
    tx.value.toString() === step.value;

  const receiptMatchesSubmission =
    receipt.hash.toLowerCase() === input.txHash.toLowerCase();

  const verified =
    receiptMatchesSubmission &&
    receipt.status === 1 &&
    senderMatchesExpected &&
    destinationMatchesExpected &&
    chainMatchesExpected &&
    dataMatchesExpected &&
    valueMatchesExpected;

  const retrievedAt = new Date().toISOString();

  const receiptEvidence = {
    hash: receipt.hash.toLowerCase(),
    blockNumber: String(receipt.blockNumber),
    blockHash: receipt.blockHash.toLowerCase(),
    status: receipt.status,
    from: receipt.from.toLowerCase(),
    to: receipt.to ? receipt.to.toLowerCase() : null,
    contractAddress: receipt.contractAddress
      ? receipt.contractAddress.toLowerCase()
      : null,
    gasUsed: receipt.gasUsed.toString(),
    gasPrice: receipt.gasPrice
      ? receipt.gasPrice.toString()
      : null,
    logsHash: canonicalLogsHash(receipt.logs),
  };

  const verification = {
    expected: {
      chainId: expectedChainId,
      sender: parent.walletAddress.toLowerCase(),
      destination: step.toAddress.toLowerCase(),
      dataHash: step.dataHash.toLowerCase(),
      value: step.value,
    },
    actual: {
      chainId: actualChainId,
      sender: tx.from.toLowerCase(),
      destination: tx.to ? tx.to.toLowerCase() : null,
      dataHash: actualDataHash.toLowerCase(),
      value: tx.value.toString(),
    },
    matches: {
      receiptMatchesSubmission,
      senderMatchesExpected,
      destinationMatchesExpected,
      chainMatchesExpected,
      dataMatchesExpected,
      valueMatchesExpected,
    },
  };

  await gatewayPatch(
    "transaction-evidence-steps",
    step.id,
    {
      blockNumber: String(receipt.blockNumber),
      blockHash: receipt.blockHash.toLowerCase(),
      receiptStatus: receipt.status,
      fromAddress: receipt.from.toLowerCase(),
      receiptToAddress: receipt.to
        ? receipt.to.toLowerCase()
        : undefined,
      contractAddress: receipt.contractAddress
        ? receipt.contractAddress.toLowerCase()
        : undefined,
      gasUsed: receipt.gasUsed.toString(),
      effectiveGasPrice: receipt.gasPrice
        ? receipt.gasPrice.toString()
        : undefined,
      logsHash: receiptEvidence.logsHash,
      receipt: receiptEvidence,
      receiptRetrievedAt: retrievedAt,
      verified,
      receiptMatchesSubmission,
      senderMatchesExpected,
      destinationMatchesExpected,
      chainMatchesExpected,
      verificationSource: `execution-layer-rpc:${input.chain}`,
      verification,
      verificationError: verified
        ? undefined
        : "Independent receipt verification mismatch",
      verifiedAt: retrievedAt,
    },
    `phase2-verification:${input.correlationId}:${input.stepIndex}:${input.txHash.toLowerCase()}`
  );

  await rollUpEvidenceStatus(input.correlationId);

  logger.info(
    {
      correlationId: input.correlationId,
      stepIndex: input.stepIndex,
      txHash: input.txHash,
      chainId: actualChainId,
      verified,
    },
    "Phase 2 submitted transaction independently verified"
  );

  return {
    correlationId: input.correlationId,
    stepIndex: input.stepIndex,
    txHash: input.txHash.toLowerCase(),
    verified,
    receiptStatus: receipt.status,
    blockNumber: String(receipt.blockNumber),
    blockHash: receipt.blockHash.toLowerCase(),
    senderMatchesExpected,
    destinationMatchesExpected,
    chainMatchesExpected,
    dataMatchesExpected,
    valueMatchesExpected,
  };
}

function getPreparedStepCount(parent: StoredEvidence): number {
  const raw = parent.preparedMetadata?.totalSteps;

  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0) {
    return raw;
  }

  throw new Error(
    `Prepared evidence ${parent.correlationId} does not contain a valid totalSteps`
  );
}

async function loadEvidenceSteps(
  correlationId: string,
  totalSteps: number
): Promise<StoredEvidenceStep[]> {
  const steps: StoredEvidenceStep[] = [];

  for (let stepIndex = 0; stepIndex < totalSteps; stepIndex += 1) {
    const stepId = `${correlationId}:${stepIndex}`;

    const step = await gatewayGet<StoredEvidenceStep>(
      `/v1/transaction-evidence-steps/${encodeURIComponent(stepId)}`
    );

    if (!step) {
      throw new Error(
        `Evidence step ${stepIndex} not found for ${correlationId}`
      );
    }

    steps.push(step);
  }

  return steps.sort((a, b) => a.stepIndex - b.stepIndex);
}

export interface TransactionEvidenceView {
  evidence: StoredEvidence;
  steps: StoredEvidenceStep[];
}

export async function getTransactionEvidence(
  correlationId: string
): Promise<TransactionEvidenceView> {
  if (!evidenceEnabled()) {
    throw new Error(
      "Transaction evidence retrieval requires PHASE2_EVIDENCE_ENABLED=true"
    );
  }

  const parent = await gatewayGet<StoredEvidence>(
    `/v1/transaction-evidence/${encodeURIComponent(correlationId)}`
  );

  if (!parent) {
    throw new Error(`Evidence ${correlationId} not found`);
  }

  const totalSteps = getPreparedStepCount(parent);
  const steps = await loadEvidenceSteps(correlationId, totalSteps);

  return {
    evidence: parent,
    steps,
  };
}

async function rollUpEvidenceStatus(
  correlationId: string
): Promise<void> {
  const { evidence, steps } =
    await getTransactionEvidence(correlationId);

  const allVerified =
    steps.length > 0 &&
    steps.every((step) => step.verified === true);

  const anyFailed =
    steps.some(
      (step) =>
        step.txHash &&
        step.verified === false
    );

  const anySubmitted =
    steps.some((step) => Boolean(step.txHash));

  const now = new Date().toISOString();

  let status = evidence.status;
  let verificationStatus =
    evidence.verificationStatus || null;
  let verifiedAt: string | undefined;

  if (allVerified) {
    status = "verified";
    verificationStatus = "verified";
    verifiedAt = now;
  } else if (anyFailed) {
    status = "verification-failed";
    verificationStatus = "failed";
  } else if (anySubmitted) {
    status = "partially-verified";
    verificationStatus = "pending";
  }

  await gatewayPatch(
    "transaction-evidence",
    correlationId,
    {
      status,
      verificationStatus,
      ...(verifiedAt ? { verifiedAt } : {}),
    },
    `phase2-rollup:${correlationId}:${status}`
  );
}

function sanitiseEvidenceStep(step: StoredEvidenceStep) {
  return {
    stepIndex: step.stepIndex,
    action: step.action,
    chainId: step.chainId,

    prepared: {
      to: step.toAddress.toLowerCase(),
      value: step.value,
      dataHash: step.dataHash.toLowerCase(),
      preparedStepHash: step.preparedStepHash.toLowerCase(),
      preparedAt: step.preparedAt || null,
    },

    submission: step.txHash
      ? {
          txHash: step.txHash.toLowerCase(),
          submittedAt: step.submittedAt || null,
          executionMechanism:
            step.executionMechanism || null,
          providerMetadata:
            step.providerMetadata || {},
        }
      : null,

    receipt: step.txHash
      ? {
          blockNumber: step.blockNumber || null,
          blockHash:
            step.blockHash?.toLowerCase() || null,
          status: step.receiptStatus ?? null,
          from:
            step.fromAddress?.toLowerCase() || null,
          to:
            step.receiptToAddress?.toLowerCase() || null,
          contractAddress:
            step.contractAddress?.toLowerCase() || null,
          gasUsed: step.gasUsed || null,
          effectiveGasPrice:
            step.effectiveGasPrice || null,
          logsHash:
            step.logsHash?.toLowerCase() || null,
          retrievedAt:
            step.receiptRetrievedAt || null,
        }
      : null,

    verification: {
      verified: step.verified ?? null,
      receiptMatchesSubmission:
        step.receiptMatchesSubmission ?? null,
      senderMatchesExpected:
        step.senderMatchesExpected ?? null,
      destinationMatchesExpected:
        step.destinationMatchesExpected ?? null,
      chainMatchesExpected:
        step.chainMatchesExpected ?? null,
      source:
        step.verificationSource || null,
      verifiedAt:
        step.verifiedAt || null,
      error:
        step.verificationError || null,
      details:
        step.verification || null,
    },
  };
}

export async function exportTransactionEvidence(
  correlationId: string
) {
  const { evidence, steps } =
    await getTransactionEvidence(correlationId);

  /*
   * exportedAt deliberately comes from persisted state rather than
   * Date.now(), so repeated exports of unchanged DB evidence are stable.
   */
  const exportedAt =
    evidence.verifiedAt ||
    evidence.updatedAt ||
    evidence.preparedAt ||
    evidence.createdAt ||
    null;

  const payload = {
    schemaVersion: evidence.evidenceVersion,
    correlationId: evidence.correlationId,

    export: {
      exportedAt,
      source: "panoramablock-database-gateway",
    },

    intent: {
      action: evidence.action,
      chainId: evidence.chainId,
      network: evidence.network,
      walletAddress:
        evidence.walletAddress.toLowerCase(),
      assetIn:
        evidence.assetIn?.toLowerCase() || null,
      assetOut:
        evidence.assetOut?.toLowerCase() || null,
      amountRaw:
        evidence.amountRaw || null,
      slippageBps:
        evidence.slippageBps ?? null,
      recorded:
        evidence.intent,
    },

    preparation: {
      preparedPayloadHash:
        evidence.preparedPayloadHash?.toLowerCase() ||
        null,
      preparedAt:
        evidence.preparedAt || null,
      metadata:
        evidence.preparedMetadata || null,
    },

    lifecycle: {
      status: evidence.status,
      verificationStatus:
        evidence.verificationStatus || null,
      createdAt:
        evidence.createdAt || null,
      updatedAt:
        evidence.updatedAt || null,
      verifiedAt:
        evidence.verifiedAt || null,
      errorReason:
        evidence.errorReason || null,
    },

    steps: steps.map(sanitiseEvidenceStep),
  };

  const integrityHash = hashJson(payload);

  return {
    ...payload,
    integrity: {
      algorithm: "keccak256",
      canonicalisation: "fixed-field-order-json-v1",
      hash: integrityHash,
    },
  };
}

export async function exportTransactionEvidenceByWallet(
  walletAddress: string,
  chainId = 43114
) {
  const evidenceRecords =
    await listStoredEvidenceByWallet(walletAddress, chainId);

  const records = await Promise.all(
    evidenceRecords.map((record) =>
      exportTransactionEvidence(record.correlationId)
    )
  );

  records.sort((a, b) =>
    a.correlationId.localeCompare(b.correlationId)
  );

  const snapshotAt =
    records
      .map((record) => record.export.exportedAt)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) || null;

  const stepCount = records.reduce(
    (total, record) => total + record.steps.length,
    0
  );

  const verifiedCount = records.filter(
    (record) =>
      record.lifecycle.verificationStatus === "verified"
  ).length;

  const payload = {
    schemaVersion: EVIDENCE_VERSION,

    export: {
      type: "bulk-transaction-evidence",
      snapshotAt,
      source: "panoramablock-database-gateway",
      filters: {
        walletAddress: walletAddress.toLowerCase(),
        chainId,
      },
    },

    records,

    summary: {
      correlationCount: records.length,
      stepCount,
      verifiedCount,
    },
  };

  return {
    ...payload,
    integrity: {
      algorithm: "keccak256",
      canonicalisation: "fixed-field-order-json-v1",
      hash: hashJson(payload),
    },
  };
}
