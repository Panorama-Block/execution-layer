import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";

const mocks = vi.hoisted(() => ({
  isPhase2EvidenceAdmin: vi.fn(),
  exportUserIdentityEvidenceAdmin: vi.fn(),
}));

vi.mock("../../../../shared/services/transaction-evidence.service", () => ({
  isPhase2EvidenceAdmin: mocks.isPhase2EvidenceAdmin,
}));

vi.mock("../../../../shared/services/user-identity-evidence.service", () => ({
  exportUserIdentityEvidenceAdmin:
    mocks.exportUserIdentityEvidenceAdmin,
}));

import * as controller from "../avax-swap.controller";

function createResponse() {
  const setHeader = vi.fn();
  const json = vi.fn();

  return {
    response: {
      setHeader,
      json,
    } as unknown as Response,
    setHeader,
    json,
  };
}

async function invokeController(
  handler: unknown,
  req: Request,
  res: Response
): Promise<ReturnType<typeof vi.fn>> {
  const next = vi.fn();

  (
    handler as (
      req: Request,
      res: Response,
      next: NextFunction
    ) => void
  )(req, res, next as unknown as NextFunction);

  await vi.waitFor(() => {
    expect(
      next.mock.calls.length > 0 ||
        (res.json as unknown as ReturnType<typeof vi.fn>).mock.calls.length > 0
    ).toBe(true);
  });

  return next;
}

describe("user estate administrative evidence export controller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exports the complete user estate for an authenticated Phase 2 evidence administrator", async () => {
    const evidence = {
      schemaVersion: "1.0",
      evidenceType: "panoramablock-user-identity-wallet-evidence",
      summary: {
        profileCount: 3,
        walletCount: 4,
        userCount: 4,
      },
    };

    mocks.isPhase2EvidenceAdmin.mockReturnValue(true);
    mocks.exportUserIdentityEvidenceAdmin.mockResolvedValue(evidence);

    const req = {
      verifiedAddress:
        "0x1111111111111111111111111111111111111111",
    } as unknown as Request;

    const { response, setHeader, json } = createResponse();

    const next = await invokeController(
      (controller as Record<string, unknown>)
        .exportUserEstateEvidenceAdmin,
      req,
      response
    );

    expect(next).not.toHaveBeenCalled();

    expect(mocks.isPhase2EvidenceAdmin).toHaveBeenCalledWith(
      "0x1111111111111111111111111111111111111111"
    );

    expect(
      mocks.exportUserIdentityEvidenceAdmin
    ).toHaveBeenCalledTimes(1);

    expect(setHeader).toHaveBeenCalledWith(
      "Content-Type",
      "application/json"
    );

    expect(setHeader).toHaveBeenCalledWith(
      "Content-Disposition",
      'attachment; filename="panoramablock-user-estate-evidence.json"'
    );

    expect(json).toHaveBeenCalledWith(evidence);
  });

  it("refuses the user estate export when the authenticated wallet is not a Phase 2 evidence administrator", async () => {
    mocks.isPhase2EvidenceAdmin.mockReturnValue(false);

    const req = {
      verifiedAddress:
        "0x2222222222222222222222222222222222222222",
    } as unknown as Request;

    const { response } = createResponse();

    const next = await invokeController(
      (controller as Record<string, unknown>)
        .exportUserEstateEvidenceAdmin,
      req,
      response
    );

    expect(mocks.isPhase2EvidenceAdmin).toHaveBeenCalledWith(
      "0x2222222222222222222222222222222222222222"
    );

    expect(
      mocks.exportUserIdentityEvidenceAdmin
    ).not.toHaveBeenCalled();

    expect(next).toHaveBeenCalledTimes(1);

    const error = next.mock.calls[0][0];

    expect(error).toMatchObject({
      code: "PHASE2_ADMIN_FORBIDDEN",
      status: 403,
    });
  });
});
