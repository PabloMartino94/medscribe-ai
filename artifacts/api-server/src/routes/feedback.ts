import { Router, type IRouter } from "express";
import {
  CreateFeedbackBody,
  CreateFeedbackResponse,
  DeleteFeedbackResponse,
  ListFeedbackQueryParams,
  ListFeedbackResponse,
  UpdateFeedbackStatusBody,
  UpdateFeedbackStatusResponse,
} from "@workspace/api-zod";
import { z } from "zod";
import { authed, requireAuth } from "../middlewares/auth";
import { notifyNewFeedback } from "../lib/notify";

const router: IRouter = Router();

const Uuid = z.string().uuid();

const FEEDBACK_COLUMNS =
  "id, user_id, author_name, kind, title, detail, status, client, resolved_at, " +
  "created_at, updated_at";

type FeedbackRow = {
  id: string;
  user_id: string;
  author_name: string | null;
  kind: string;
  title: string;
  detail: string | null;
  status: string;
  client: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * `mine` rather than the raw author id: the board shows everyone's reports, but
 * the only thing the client does with ownership is decide whether to offer the
 * delete button. Sending the id would leak which account filed what.
 */
function rowToItem(row: FeedbackRow, callerId: string) {
  return {
    id: row.id,
    kind: row.kind as "bug" | "improvement",
    title: row.title,
    detail: row.detail,
    status: row.status as "open" | "in_progress" | "done" | "discarded",
    authorName: row.author_name,
    mine: row.user_id === callerId,
    client: row.client,
    resolvedAt: row.resolved_at ? new Date(row.resolved_at) : null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

router.use("/feedback", requireAuth);

router.get("/feedback", async (req, res) => {
  const { user, supabase } = authed(req);

  const params = ListFeedbackQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: "Parámetros de consulta inválidos" });
    return;
  }

  let query = supabase.from("feedback").select(FEEDBACK_COLUMNS);
  if (params.data.status !== "all") query = query.eq("status", params.data.status);

  const { data, error } = await query.order("created_at", { ascending: false });

  if (error) {
    req.log.error({ err: error }, "Failed to list feedback");
    res.status(502).json({ error: "No se pudieron leer los reportes" });
    return;
  }

  res.json(
    ListFeedbackResponse.parse(
      (data as unknown as FeedbackRow[]).map((row) => rowToItem(row, user.id)),
    ),
  );
});

router.post("/feedback", async (req, res) => {
  const { user, supabase } = authed(req);

  const parsed = CreateFeedbackBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Datos inválidos: se requiere un título" });
    return;
  }
  const { kind, title, detail, client } = parsed.data;

  // Snapshot of the author's name, so the board can show who reported an item
  // without physicians being able to read each other's profiles. The email is
  // a fallback only, and only its local part: the board is shared.
  const authorName = user.fullName?.trim() || user.email.split("@")[0] || null;

  const { data, error } = await supabase
    .from("feedback")
    .insert({
      user_id: user.id,
      author_name: authorName,
      kind,
      title: title.trim(),
      detail: detail?.trim() || null,
      client: client?.trim() || null,
    })
    .select(FEEDBACK_COLUMNS)
    .single();

  if (error || !data) {
    req.log.error({ err: error }, "Failed to create feedback");
    res.status(502).json({ error: "No se pudo enviar el reporte" });
    return;
  }

  const item = rowToItem(data as unknown as FeedbackRow, user.id);

  // After the row is safe, and never blocking on it: a mail provider being
  // down is not a reason a physician cannot file a report.
  notifyNewFeedback(
    {
      kind: item.kind,
      title: item.title,
      detail: item.detail,
      authorName: item.authorName,
      client: item.client,
    },
    req.log,
  );

  res.status(201).json(CreateFeedbackResponse.parse(item));
});

router.patch("/feedback/:id", async (req, res) => {
  const { user, supabase } = authed(req);

  const id = Uuid.safeParse(req.params.id);
  if (!id.success) {
    res.status(404).json({ error: "Reporte no encontrado" });
    return;
  }

  const parsed = UpdateFeedbackStatusBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Estado inválido" });
    return;
  }

  // Only the status travels. The database agrees: `authenticated` holds an
  // update grant on that column alone, so a wider patch would be refused there
  // too rather than depending on this route being careful.
  const { data, error } = await supabase
    .from("feedback")
    .update({ status: parsed.data.status })
    .eq("id", id.data)
    .select(FEEDBACK_COLUMNS)
    .maybeSingle();

  if (error) {
    req.log.error({ err: error }, "Failed to update feedback status");
    res.status(502).json({ error: "No se pudo cambiar el estado" });
    return;
  }
  if (!data) {
    res.status(404).json({ error: "Reporte no encontrado" });
    return;
  }

  res.json(
    UpdateFeedbackStatusResponse.parse(rowToItem(data as unknown as FeedbackRow, user.id)),
  );
});

router.delete("/feedback/:id", async (req, res) => {
  const { supabase } = authed(req);

  const id = Uuid.safeParse(req.params.id);
  if (!id.success) {
    res.json(DeleteFeedbackResponse.parse({ deleted: 0 }));
    return;
  }

  // RLS restricts this to the caller's own reports; someone else's comes back
  // as zero rows rather than as an error.
  const { data, error } = await supabase
    .from("feedback")
    .delete()
    .eq("id", id.data)
    .select("id");

  if (error) {
    req.log.error({ err: error }, "Failed to delete feedback");
    res.status(502).json({ error: "No se pudo borrar el reporte" });
    return;
  }

  res.json(DeleteFeedbackResponse.parse({ deleted: (data ?? []).length }));
});

export default router;
