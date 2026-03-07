import { Request, Response } from "express";
import { executePrepareCreateOrder } from "../usecases/prepare-create-order.usecase";
import { executePrepareCancel } from "../usecases/prepare-cancel-order.usecase";
import { executeGetOrders, executeGetOrder } from "../usecases/get-orders.usecase";
import { executeGetExecutableOrders } from "../usecases/get-executable-orders.usecase";

export async function prepareCreateOrder(req: Request, res: Response) {
  try {
    const {
      userAddress, tokenIn, tokenOut, amountPerSwap,
      intervalSeconds, remainingSwaps, stable, depositAmount,
    } = req.body;
    if (!userAddress || !tokenIn || !tokenOut || !amountPerSwap || !intervalSeconds || !depositAmount) {
      return res.status(400).json({
        error: "Missing required fields: userAddress, tokenIn, tokenOut, amountPerSwap, intervalSeconds, depositAmount",
      });
    }
    const result = await executePrepareCreateOrder({
      userAddress, tokenIn, tokenOut, amountPerSwap,
      intervalSeconds, remainingSwaps: remainingSwaps ?? 0,
      stable: stable ?? false, depositAmount,
    });
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function prepareCancelOrder(req: Request, res: Response) {
  try {
    const { userAddress, orderId, withdrawAfter } = req.body;
    if (!userAddress || orderId === undefined) {
      return res.status(400).json({ error: "Missing required fields: userAddress, orderId" });
    }
    const result = await executePrepareCancel({ userAddress, orderId, withdrawAfter });
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function getOrders(req: Request, res: Response) {
  try {
    const { userAddress } = req.params;
    if (!userAddress) {
      return res.status(400).json({ error: "Missing required parameter: userAddress" });
    }
    const result = await executeGetOrders(userAddress);
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function getOrder(req: Request, res: Response) {
  try {
    const orderId = parseInt(req.params.orderId);
    if (isNaN(orderId)) {
      return res.status(400).json({ error: "Invalid orderId" });
    }
    const result = await executeGetOrder(orderId);
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function getExecutableOrders(req: Request, res: Response) {
  try {
    const upTo = parseInt(req.query.upTo as string) || 100;
    const result = await executeGetExecutableOrders(upTo);
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
