import { Router, type IRouter } from "express";
import { GetRuntimeConfigResponse } from "@workspace/api-zod";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "../lib/supabase";

const router: IRouter = Router();

/**
 * Public, unauthenticated. Only carries values that belong in a browser: the
 * project URL and the publishable key, which grants nothing on its own because
 * every table is behind RLS.
 */
router.get("/config", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(
    GetRuntimeConfigResponse.parse({
      supabaseUrl: SUPABASE_URL,
      supabasePublishableKey: SUPABASE_PUBLISHABLE_KEY,
    }),
  );
});

export default router;
