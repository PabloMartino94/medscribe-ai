import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createUserClient,
  verifyAccessToken,
  type AuthenticatedUser,
} from "../lib/supabase";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      /** Supabase client acting as `req.user`, so every query is RLS-scoped. */
      supabase?: SupabaseClient;
    }
  }
}

function bearerToken(req: Request): string | null {
  const header = req.get("authorization");
  if (!header) return null;
  const [scheme, ...rest] = header.split(" ");
  if (!scheme || scheme.toLowerCase() !== "bearer") return null;
  const token = rest.join(" ").trim();
  return token || null;
}

/**
 * Rejects any request without a valid Supabase access token, and attaches both
 * the user and a client that acts as them.
 */
export const requireAuth: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const token = bearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Iniciá sesión para continuar" });
    return;
  }

  verifyAccessToken(token)
    .then((user) => {
      if (!user) {
        res.status(401).json({ error: "Tu sesión expiró. Iniciá sesión nuevamente." });
        return;
      }
      req.user = user;
      req.supabase = createUserClient(token);
      next();
    })
    .catch(next);
};

/**
 * Narrows the request for handlers mounted behind `requireAuth`, turning the
 * optional fields into a hard failure rather than a silent unauthenticated read.
 */
export function authed(req: Request): { user: AuthenticatedUser; supabase: SupabaseClient } {
  if (!req.user || !req.supabase) {
    throw new Error("authed() used on a route that is not behind requireAuth");
  }
  return { user: req.user, supabase: req.supabase };
}
