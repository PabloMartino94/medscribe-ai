import { Router, type IRouter } from "express";
import {
  GetCurrentUserResponse,
  GetPreferencesResponse,
  SetPreferencesBody,
  SetPreferencesResponse,
} from "@workspace/api-zod";
import { authed, requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

/** Cap on stored preferences, matching what the prompt builder will send. */
const MAX_PREFERENCES = 30;
const MAX_PREFERENCE_LENGTH = 500;

router.get("/me", requireAuth, (req, res) => {
  const { user } = authed(req);
  res.json(
    GetCurrentUserResponse.parse({
      id: user.id,
      email: user.email,
      fullName: user.fullName,
    }),
  );
});

router.get("/preferences", requireAuth, async (req, res) => {
  const { user, supabase } = authed(req);

  const { data, error } = await supabase
    .from("profiles")
    .select("preferences")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    req.log.error({ err: error }, "Failed to read preferences");
    res.status(502).json({ error: "No se pudieron leer las preferencias" });
    return;
  }

  const preferences = (data as { preferences: string[] | null } | null)?.preferences ?? [];
  res.json(GetPreferencesResponse.parse({ preferences }));
});

router.put("/preferences", requireAuth, async (req, res) => {
  const { user, supabase } = authed(req);

  const parsed = SetPreferencesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Preferencias inválidas" });
    return;
  }

  const preferences = parsed.data.preferences
    .map((p) => p.trim().slice(0, MAX_PREFERENCE_LENGTH))
    .filter(Boolean)
    .slice(0, MAX_PREFERENCES);

  // Upsert rather than update: the profile row is created by a trigger on
  // signup, but a user imported straight into auth.users would not have one.
  const { error } = await supabase
    .from("profiles")
    .upsert({ id: user.id, preferences }, { onConflict: "id" });

  if (error) {
    req.log.error({ err: error }, "Failed to save preferences");
    res.status(502).json({ error: "No se pudieron guardar las preferencias" });
    return;
  }

  res.json(SetPreferencesResponse.parse({ preferences }));
});

export default router;
