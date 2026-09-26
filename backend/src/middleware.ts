import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { config } from './config';
import { HttpError } from './validate';

/**
 * Routes that make the backend wallet send transactions. They're for operators and bots,
 * not the public: the console signs with the user's own wallet instead.
 * - ADMIN_API_KEY set: require it in the x-api-key header.
 * - Not set in production: disabled.
 * - Not set in development: open, for local testing.
 */
export function adminOnly(req: Request, _res: Response, next: NextFunction) {
  if (!config.adminApiKey) {
    if (config.isProduction) return next(new HttpError(403, 'Backend-signed routes are disabled. Set ADMIN_API_KEY to enable them.'));
    return next();
  }
  const given = Buffer.from(String(req.header('x-api-key') || ''));
  const expected = Buffer.from(config.adminApiKey);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return next(new HttpError(401, 'Missing or invalid x-api-key header'));
  }
  next();
}

/** Fixed-window rate limiter per client IP (in memory; fine for a single instance) */
export function rateLimit(name: string, limit: number, windowMs: number) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  setInterval(() => {
    const now = Date.now();
    for (const [key, v] of hits) if (v.resetAt <= now) hits.delete(key);
  }, windowMs).unref();

  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip || 'unknown';
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count++;
    res.setHeader('RateLimit-Limit', String(limit));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, limit - entry.count)));
    if (entry.count > limit) {
      res.setHeader('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return next(new HttpError(429, `Too many ${name} requests. Try again in a minute.`));
    }
    next();
  };
}

export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  next();
}
