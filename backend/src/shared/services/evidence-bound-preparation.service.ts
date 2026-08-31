import { TransactionBundle } from "../../types/transaction";
import {
  createEvidenceCorrelation,
  EvidenceIntentInput,
  persistEvidenceIntent,
  persistPreparedEvidence,
  PreparedEvidenceResult,
} from "./transaction-evidence.service";

export type EvidenceIntentDescriptor =
  Omit<EvidenceIntentInput, "correlationId" | "createdAt">;

export interface PreparedOperation<
  TMetadata extends Record<string, unknown>
> {
  bundle: TransactionBundle;
  metadata: TMetadata;
}

export type EvidenceBoundPreparationResult<
  TMetadata extends Record<string, unknown>
> =
  PreparedEvidenceResult &
  PreparedOperation<TMetadata>;

/**
 * Generic evidence-bound preparation boundary.
 *
 * Ordering invariant:
 *
 *   T1 create + persist intent
 *   T2 prepare deterministic transaction bundle
 *   T3 persist prepared transaction commitment
 *   T4 return executable bundle to caller
 *
 * Therefore no caller using this boundary can receive an executable bundle
 * before its evidence preparation lifecycle has completed successfully.
 *
 * This function does not alter transaction semantics. The bundle returned is
 * the exact bundle instance produced by the preparation callback.
 */
export async function prepareEvidenceBoundBundle<
  TMetadata extends Record<string, unknown>
>(
  input: {
    intent: EvidenceIntentDescriptor;
    prepare: () => Promise<PreparedOperation<TMetadata>>;
  }
): Promise<EvidenceBoundPreparationResult<TMetadata>> {
  const evidence = createEvidenceCorrelation();

  const evidenceIntent: EvidenceIntentInput = {
    ...input.intent,
    correlationId: evidence.correlationId,
    createdAt: new Date().toISOString(),
  };

  await persistEvidenceIntent(evidenceIntent);

  const prepared = await input.prepare();

  const preparedEvidence = await persistPreparedEvidence(
    evidenceIntent,
    prepared.bundle,
    prepared.metadata
  );

  return {
    ...preparedEvidence,
    bundle: prepared.bundle,
    metadata: prepared.metadata,
  };
}
