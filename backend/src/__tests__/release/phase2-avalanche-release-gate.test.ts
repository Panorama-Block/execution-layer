import {
  describe,
  expect,
  it,
} from "vitest";

import {
  existsSync,
  readFileSync,
} from "node:fs";

import {
  resolve,
} from "node:path";

const BACKEND_ROOT =
  resolve(process.cwd());

const E9_PARENT =
  "7f5e93d5f5e05d17189fd2a955437fff5fbb0dd3";

const requiredProofs = [
  "src/__tests__/shared/evidence-bound-preparation.compliance.test.ts",

  "src/__tests__/modules/avax-swap/prepare-swap-evidence-bound.test.ts",

  "src/__tests__/modules/avax-lending/prepare-supply-evidence-bound.test.ts",
  "src/__tests__/modules/avax-lending/prepare-redeem-evidence-bound.test.ts",
  "src/__tests__/modules/avax-lending/prepare-borrow-evidence-bound.test.ts",
  "src/__tests__/modules/avax-lending/prepare-repay-evidence-bound.test.ts",
  "src/__tests__/modules/avax-lending/lending-evidence-submission.test.ts",

  "src/__tests__/modules/avax-liquid-staking/prepare-stake-evidence-bound.test.ts",
  "src/__tests__/modules/avax-liquid-staking/prepare-request-unlock-evidence-bound.test.ts",
  "src/__tests__/modules/avax-liquid-staking/prepare-redeem-evidence-bound.test.ts",

  "src/__tests__/modules/avax-swap/bridge-evidence-two-phase.test.ts",
  "src/__tests__/modules/avax-swap/bridge-destination-evidence.test.ts",

  "src/shared/services/__tests__/transaction-evidence-lifecycle.test.ts",
  "src/shared/services/__tests__/transaction-evidence-outcomes.test.ts",
  "src/shared/services/__tests__/transaction-evidence-independent-verification.test.ts",
  "src/__tests__/shared/services/transaction-evidence-chain-participation.test.ts",
];

const preparationUseCases = [
  "src/modules/avax-swap/usecases/prepare-swap.usecase.ts",

  "src/modules/avax-lending/usecases/prepare-supply.usecase.ts",
  "src/modules/avax-lending/usecases/prepare-redeem.usecase.ts",
  "src/modules/avax-lending/usecases/prepare-borrow.usecase.ts",
  "src/modules/avax-lending/usecases/prepare-repay.usecase.ts",

  "src/modules/avax-liquid-staking/usecases/prepare-stake.usecase.ts",
  "src/modules/avax-liquid-staking/usecases/prepare-request-unlock.usecase.ts",
  "src/modules/avax-liquid-staking/usecases/prepare-redeem.usecase.ts",
];

function source(
  relativePath: string
): string {
  return readFileSync(
    resolve(
      BACKEND_ROOT,
      relativePath
    ),
    "utf8"
  );
}

describe(
  "Phase 2 Avalanche release gate",
  () => {
    it(
      "is anchored to the validated EVID-E9 execution-layer baseline",
      () => {
        expect(E9_PARENT).toBe(
          "7f5e93d5f5e05d17189fd2a955437fff5fbb0dd3"
        );
      }
    );

    it(
      "retains every constituent Phase 2 backend proof required for release",
      () => {
        const missing =
          requiredProofs.filter(
            relativePath =>
              !existsSync(
                resolve(
                  BACKEND_ROOT,
                  relativePath
                )
              )
          );

        expect(
          missing,
          `Missing Phase 2 release proofs:\n${missing.join("\n")}`
        ).toEqual([]);
      }
    );

    it(
      "keeps every generic Avalanche prepare use case behind prepareEvidenceBoundBundle",
      () => {
        const violations =
          preparationUseCases.filter(
            relativePath => {
              const text =
                source(relativePath);

              return !(
                text.includes(
                  "prepareEvidenceBoundBundle"
                ) &&
                text.includes(
                  "return prepareEvidenceBoundBundle("
                )
              );
            }
          );

        expect(
          violations,
          [
            "Avalanche preparation bypasses the generic evidence boundary:",
            ...violations,
          ].join("\n")
        ).toEqual([]);
      }
    );

    it(
      "keeps bridge source and destination as explicit Avalanche evidence phases",
      () => {
        const bridge =
          source(
            "src/modules/avax-swap/services/bridge-evidence.service.ts"
          );

        expect(bridge).toContain(
          "beginAvaxBridgeEvidence"
        );

        expect(bridge).toContain(
          "commitAvaxBridgeEvidence"
        );

        expect(bridge).toContain(
          "beginAvaxBridgeDestinationEvidence"
        );

        expect(bridge).toContain(
          "commitAvaxBridgeDestinationEvidence"
        );

        expect(bridge).toContain(
          "Avalanche bridge source evidence may only commit chain 43114 transactions"
        );

        expect(bridge).toContain(
          "Avalanche bridge destination evidence may only commit chain 43114 transactions"
        );
      }
    );

    it(
      "retains durable submission before independent verification",
      () => {
        const evidenceService =
          source(
            "src/shared/services/transaction-evidence.service.ts"
          );

        const submission =
          evidenceService.indexOf(
            "phase2-submission:"
          );

        const receipt =
          evidenceService.indexOf(
            "phase2-receipt:"
          );

        const verification =
          evidenceService.indexOf(
            "phase2-verification:"
          );

        expect(submission)
          .toBeGreaterThanOrEqual(0);

        expect(receipt)
          .toBeGreaterThan(submission);

        expect(verification)
          .toBeGreaterThan(receipt);
      }
    );

    it(
      "retains failure lifecycle outcomes without permitting client-asserted reverted",
      () => {
        const evidenceService =
          source(
            "src/shared/services/transaction-evidence.service.ts"
          );

        expect(evidenceService).toContain(
          '"cancelled-before-submission"'
        );

        expect(evidenceService).toContain(
          '"partially-executed"'
        );

        expect(evidenceService).toContain(
          'status: "reverted"'
        );

        expect(evidenceService).not.toContain(
          'input.outcome === "reverted"'
        );
      }
    );
  }
);
