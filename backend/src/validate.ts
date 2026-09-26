import { ethers } from 'ethers';
import { NextFunction, Request, Response, RequestHandler } from 'express';

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Forward async errors to the Express error handler */
export const route =
  (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };

export function requireAddress(value: unknown, field: string): string {
  if (typeof value !== 'string' || !ethers.isAddress(value)) {
    throw new HttpError(400, `${field} must be a valid 0x address`);
  }
  return ethers.getAddress(value);
}

export function requireBytes32(value: unknown, field: string): string {
  if (typeof value !== 'string' || !ethers.isHexString(value, 32)) {
    throw new HttpError(400, `${field} must be a 32-byte hex string`);
  }
  return value;
}

/** USD amount: finite, >= min, at most 1e12, accepts numbers or numeric strings */
export function requireUsd(value: unknown, field: string, { min = 0, optional = false } = {}): number | undefined {
  if (value === undefined || value === null || value === '') {
    if (optional) return undefined;
    throw new HttpError(400, `${field} is required`);
  }
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < min || n > 1e12) {
    throw new HttpError(400, `${field} must be a number between ${min} and 1,000,000,000,000`);
  }
  return n;
}

/** Convert a USD float into 18-decimal fixed point without float/exponent formatting issues */
export function usdToWei(amountUSD: number): bigint {
  return ethers.parseEther(amountUSD.toFixed(6));
}

export function requireString(value: unknown, field: string, { max = 256, pattern }: { max?: number; pattern?: RegExp } = {}): string {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, `${field} is required`);
  const v = value.trim();
  if (v.length > max) throw new HttpError(400, `${field} must be at most ${max} characters`);
  if (pattern && !pattern.test(v)) throw new HttpError(400, `${field} has an invalid format`);
  return v;
}

export function requireUint256(value: unknown, field: string): bigint {
  try {
    const n = BigInt(value as string);
    if (n < 0n || n >= 2n ** 256n) throw new Error();
    return n;
  } catch {
    throw new HttpError(400, `${field} must be a uint256 (decimal or 0x hex)`);
  }
}
