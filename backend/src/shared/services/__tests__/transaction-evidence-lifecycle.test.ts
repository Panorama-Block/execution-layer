import {
  describe,
  expect,
  it,
} from "vitest";

import {
  deriveEvidenceLifecycleStatus,
} from "../transaction-evidence.service";

describe(
  "transaction evidence submission lifecycle",
  () => {
    const prepared = {
      txHash: null,
      receiptStatus: null,
      receiptRetrievedAt: null,
      verified: null,
    };

    const submitted = {
      ...prepared,
      txHash:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    };

    const confirmed = {
      ...submitted,
      receiptStatus: 1,
      receiptRetrievedAt:
        "2026-08-31T00:00:00.000Z",
    };

    const verified = {
      ...confirmed,
      verified: true,
    };

    it(
      "preserves prepared before any transaction is submitted",
      () => {
        expect(
          deriveEvidenceLifecycleStatus(
            [prepared, prepared],
            "prepared"
          )
        ).toEqual({
          status: "prepared",
          verificationStatus: null,
          verified: false,
        });
      }
    );

    it(
      "becomes partially-submitted after the first durable hash",
      () => {
        expect(
          deriveEvidenceLifecycleStatus(
            [submitted, prepared],
            "prepared"
          ).status
        ).toBe("partially-submitted");
      }
    );

    it(
      "becomes submitted when every prepared step has a hash",
      () => {
        expect(
          deriveEvidenceLifecycleStatus(
            [submitted, submitted],
            "partially-submitted"
          ).status
        ).toBe("submitted");
      }
    );

    it(
      "becomes partially-confirmed when only some receipts are durable",
      () => {
        expect(
          deriveEvidenceLifecycleStatus(
            [confirmed, submitted],
            "submitted"
          ).status
        ).toBe("partially-confirmed");
      }
    );

    it(
      "becomes confirmed when every receipt is durable",
      () => {
        expect(
          deriveEvidenceLifecycleStatus(
            [confirmed, confirmed],
            "partially-confirmed"
          )
        ).toEqual({
          status: "confirmed",
          verificationStatus: "pending",
          verified: false,
        });
      }
    );

    it(
      "becomes verified only when every step independently verifies",
      () => {
        expect(
          deriveEvidenceLifecycleStatus(
            [verified, verified],
            "confirmed",
            "pending"
          )
        ).toEqual({
          status: "verified",
          verificationStatus: "verified",
          verified: true,
        });
      }
    );

    it(
      "does not regress verified state when verified step evidence is rolled up again",
      () => {
        expect(
          deriveEvidenceLifecycleStatus(
            [verified, verified],
            "verified",
            "verified"
          )
        ).toEqual({
          status: "verified",
          verificationStatus: "verified",
          verified: true,
        });
      }
    );

    it(
      "does not regress verification failure while failed step evidence remains",
      () => {
        expect(
          deriveEvidenceLifecycleStatus(
            [
              verified,
              {
                ...confirmed,
                verified: false,
              },
            ],
            "verification-failed",
            "failed"
          )
        ).toEqual({
          status: "verification-failed",
          verificationStatus: "failed",
          verified: false,
        });
      }
    );

    it(
      "retains verification failure after submission and confirmation",
      () => {
        expect(
          deriveEvidenceLifecycleStatus(
            [
              verified,
              {
                ...confirmed,
                verified: false,
              },
            ],
            "confirmed",
            "pending"
          )
        ).toEqual({
          status: "verification-failed",
          verificationStatus: "failed",
          verified: false,
        });
      }
    );


    it(
      "preserves cancelled-before-submission while no transaction hash exists",
      () => {
        expect(
          deriveEvidenceLifecycleStatus(
            [prepared, prepared],
            "cancelled-before-submission"
          )
        ).toEqual({
          status: "cancelled-before-submission",
          verificationStatus: null,
          verified: false,
        });
      }
    );

    it(
      "does not allow cancellation status to hide a later durable submission",
      () => {
        expect(
          deriveEvidenceLifecycleStatus(
            [submitted, prepared],
            "cancelled-before-submission"
          ).status
        ).toBe("partially-submitted");
      }
    );

    it(
      "preserves partially-executed after execution terminates with only some durable hashes",
      () => {
        expect(
          deriveEvidenceLifecycleStatus(
            [submitted, prepared],
            "partially-executed",
            "pending"
          )
        ).toEqual({
          status: "partially-executed",
          verificationStatus: "pending",
          verified: false,
        });
      }
    );

    it(
      "preserves partially-executed when an earlier submitted step later confirms",
      () => {
        expect(
          deriveEvidenceLifecycleStatus(
            [confirmed, prepared],
            "partially-executed",
            "pending"
          ).status
        ).toBe("partially-executed");
      }
    );

    it(
      "advances beyond partially-executed when every prepared step is later submitted",
      () => {
        expect(
          deriveEvidenceLifecycleStatus(
            [submitted, submitted],
            "partially-executed",
            "pending"
          ).status
        ).toBe("submitted");
      }
    );

    it(
      "derives reverted from an independently retrieved reverted receipt",
      () => {
        expect(
          deriveEvidenceLifecycleStatus(
            [
              {
                ...confirmed,
                receiptStatus: 0,
                verified: false,
              },
            ],
            "verification-failed",
            "failed"
          )
        ).toEqual({
          status: "reverted",
          verificationStatus: "failed",
          verified: false,
        });
      }
    );

    it(
      "reverted outranks a generic verification failure",
      () => {
        expect(
          deriveEvidenceLifecycleStatus(
            [
              {
                ...confirmed,
                receiptStatus: 0,
                verified: false,
              },
              {
                ...confirmed,
                verified: false,
              },
            ],
            "verification-failed",
            "failed"
          ).status
        ).toBe("reverted");
      }
    );

  }
);
