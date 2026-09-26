import type { Logger } from "pino";

/**
 * Email notifications for new feedback, through Resend.
 *
 * Supabase only sends authentication mail, so reaching an inbox needs a
 * transactional provider. Everything here is optional: with no key configured
 * the app behaves exactly as before, because a missing notification must never
 * be a reason a physician cannot file a report.
 */

/** Overridable so the send path can be exercised against a local stand-in. */
const API_URL = process.env["RESEND_API_URL"]?.trim() || "https://api.resend.com/emails";

/** Resend is a side errand; the report is already saved by the time we call. */
const TIMEOUT_MS = 10_000;

const RESEND_API_KEY = process.env["RESEND_API_KEY"]?.trim() ?? "";
const NOTIFY_EMAIL = process.env["FEEDBACK_NOTIFY_EMAIL"]?.trim() ?? "";

/**
 * Without a verified domain Resend only accepts its own onboarding sender, and
 * only delivers to the address that owns the account — which is exactly the
 * setup here, since the one recipient is the account owner.
 */
const NOTIFY_FROM = process.env["FEEDBACK_NOTIFY_FROM"]?.trim() || "MedScribe AI <onboarding@resend.dev>";

const APP_URL = process.env["APP_URL"]?.trim() || "https://app-medicos.onrender.com";

export function notificationsConfigured(): boolean {
  return Boolean(RESEND_API_KEY && NOTIFY_EMAIL);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type FeedbackNotice = {
  kind: "bug" | "improvement";
  title: string;
  detail: string | null;
  authorName: string | null;
  client: string | null;
};

/**
 * Tell the owner someone filed something. Never throws and never rejects: the
 * caller has already answered the physician, and a provider outage is not their
 * problem.
 */
export function notifyNewFeedback(item: FeedbackNotice, log: Logger): void {
  if (!notificationsConfigured()) return;

  const label = item.kind === "bug" ? "Error" : "Mejora";
  const author = item.authorName || "Alguien";

  const lines = [
    `${label} reportado por ${author}`,
    "",
    item.title,
    ...(item.detail ? ["", item.detail] : []),
    ...(item.client ? ["", `Desde: ${item.client}`] : []),
    "",
    `Ver el tablero: ${APP_URL}`,
  ];

  const html = [
    `<p style="margin:0 0 4px"><strong>${escapeHtml(label)}</strong> reportado por ${escapeHtml(author)}</p>`,
    `<p style="margin:0 0 12px;font-size:16px"><strong>${escapeHtml(item.title)}</strong></p>`,
    item.detail
      ? `<p style="margin:0 0 12px;white-space:pre-wrap">${escapeHtml(item.detail)}</p>`
      : "",
    item.client
      ? `<p style="margin:0 0 12px;color:#666;font-size:12px">Desde: ${escapeHtml(item.client)}</p>`
      : "",
    `<p style="margin:0"><a href="${escapeHtml(APP_URL)}">Abrir el tablero</a></p>`,
  ].join("");

  // Deliberately not awaited: the physician's request is already answered, and
  // the process is long-lived, so the send finishes on its own.
  void (async () => {
    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${RESEND_API_KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: NOTIFY_FROM,
          to: [NOTIFY_EMAIL],
          subject: `[MedScribe] ${label}: ${item.title}`.slice(0, 180),
          text: lines.join("\n"),
          html,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (!res.ok) {
        // The body carries Resend's reason (unverified domain, bad key). It
        // never contains our key, so it is safe to log.
        const body = await res.text().catch(() => "");
        log.warn({ status: res.status, body: body.slice(0, 300) }, "Feedback notification rejected");
        return;
      }

      log.info("Feedback notification sent");
    } catch (err) {
      log.warn({ err }, "Feedback notification failed");
    }
  })();
}
