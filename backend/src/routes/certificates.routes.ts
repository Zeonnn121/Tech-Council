import { Router, Request, Response } from "express";
import { z } from "zod";
import { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { getPool, query } from "../db";
import { badRequest, conflict, notFound } from "../utils/HttpError";
import { asyncHandler } from "../middleware/asyncHandler";
import { validate } from "../middleware/validate";
import { requireAuth, requireRole } from "../middleware/auth";
import { getDownloadUrl, putObject } from "../services/s3.service";
import {
  buildCertificateCode,
  buildCertificateKey,
  generateCertificatePdf,
} from "../services/certificate.service";

const router = Router();

// ── Zod schemas ──

const createCertificatesSchema = z.object({
  participant_ids: z.array(z.number().int().positive()).min(1),
});

// ── POST /api/events/:id/certificates (admin/organizer) ──
// Only participants marked present for the event receive one; everyone else is
// reported back in `skipped` with a reason. Duplicates are skipped, not errors.
router.post(
  "/events/:id/certificates",
  requireAuth,
  requireRole("admin", "organizer"),
  validate(createCertificatesSchema, "body"),
  asyncHandler(async (req: Request, res: Response) => {
    const eventId = Number(req.params.id);
    if (!eventId) throw badRequest("Invalid event ID");

    const eventRows = await query<RowDataPacket[]>(
      "SELECT event_id, event_date FROM events WHERE event_id = ?",
      [eventId]
    );
    if (eventRows.length === 0) throw notFound("Event not found");

    // event_date comes back as "YYYY-MM-DD" because the pool uses dateStrings
    const eventYear = Number(String(eventRows[0].event_date).slice(0, 4));

    const { participant_ids } = req.body as z.infer<
      typeof createCertificatesSchema
    >;

    const created: Record<string, unknown>[] = [];
    const skipped: { participant_id: number; reason: string }[] = [];

    const conn = await getPool().getConnection();
    try {
      await conn.beginTransaction();

      for (const participantId of participant_ids) {
        // Participant must exist
        const [participantRows] = await conn.query<RowDataPacket[]>(
          "SELECT participant_id FROM participants WHERE participant_id = ?",
          [participantId]
        );
        if (participantRows.length === 0) {
          skipped.push({
            participant_id: participantId,
            reason: "participant_not_found",
          });
          continue;
        }

        // Participant must be marked present for this event
        const [attendanceRows] = await conn.query<RowDataPacket[]>(
          "SELECT present FROM attendance WHERE event_id = ? AND participant_id = ?",
          [eventId, participantId]
        );
        if (
          attendanceRows.length === 0 ||
          Number(attendanceRows[0].present) !== 1
        ) {
          skipped.push({ participant_id: participantId, reason: "not_present" });
          continue;
        }

        // Already has a certificate for this event
        const [existingRows] = await conn.query<RowDataPacket[]>(
          "SELECT certificate_id FROM certificates WHERE event_id = ? AND participant_id = ?",
          [eventId, participantId]
        );
        if (existingRows.length > 0) {
          skipped.push({ participant_id: participantId, reason: "duplicate" });
          continue;
        }

        const code = buildCertificateCode(eventYear, eventId, participantId);
        const [result] = await conn.query<ResultSetHeader>(
          `INSERT INTO certificates (certificate_code, event_id, participant_id, status)
           VALUES (?, ?, ?, 'pending')`,
          [code, eventId, participantId]
        );

        created.push({
          certificate_id: result.insertId,
          certificate_code: code,
          event_id: eventId,
          participant_id: participantId,
          s3_key: null,
          status: "pending",
          issued_date: null,
        });
      }

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    res.status(201).json({ data: { created, skipped } });
  })
);

// ── GET /api/events/:id/certificates ──
router.get(
  "/events/:id/certificates",
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const eventId = Number(req.params.id);
    if (!eventId) throw badRequest("Invalid event ID");

    const eventRows = await query<RowDataPacket[]>(
      "SELECT event_id FROM events WHERE event_id = ?",
      [eventId]
    );
    if (eventRows.length === 0) throw notFound("Event not found");

    const rows = await query<RowDataPacket[]>(
      `SELECT
         c.certificate_id, c.certificate_code, c.event_id, c.participant_id,
         c.s3_key, c.status, c.issued_date,
         p.name, p.email, p.department, p.year
       FROM certificates c
       JOIN participants p ON c.participant_id = p.participant_id
       WHERE c.event_id = ?
       ORDER BY c.certificate_id ASC`,
      [eventId]
    );

    res.json({ data: rows });
  })
);

// ── GET /api/participants/:id/certificates ──
router.get(
  "/participants/:id/certificates",
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const participantId = Number(req.params.id);
    if (!participantId) throw badRequest("Invalid participant ID");

    const participantRows = await query<RowDataPacket[]>(
      "SELECT participant_id FROM participants WHERE participant_id = ?",
      [participantId]
    );
    if (participantRows.length === 0) throw notFound("Participant not found");

    const rows = await query<RowDataPacket[]>(
      `SELECT
         c.certificate_id, c.certificate_code, c.event_id, c.participant_id,
         c.s3_key, c.status, c.issued_date,
         e.title AS event_title, e.event_date, e.category
       FROM certificates c
       JOIN events e ON c.event_id = e.event_id
       WHERE c.participant_id = ?
       ORDER BY e.event_date DESC`,
      [participantId]
    );

    res.json({ data: rows });
  })
);

// ── POST /api/certificates/:id/issue (admin/organizer) ──
// Renders the PDF in memory, uploads it to S3, then flips the row to `issued`.
router.post(
  "/certificates/:id/issue",
  requireAuth,
  requireRole("admin", "organizer"),
  asyncHandler(async (req: Request, res: Response) => {
    const certificateId = Number(req.params.id);
    if (!certificateId) throw badRequest("Invalid certificate ID");

    const rows = await query<RowDataPacket[]>(
      `SELECT
         c.certificate_id, c.certificate_code, c.event_id, c.status,
         p.name AS participant_name,
         e.title AS event_title, e.event_date
       FROM certificates c
       JOIN participants p ON c.participant_id = p.participant_id
       JOIN events e ON c.event_id = e.event_id
       WHERE c.certificate_id = ?`,
      [certificateId]
    );
    if (rows.length === 0) throw notFound("Certificate not found");

    const cert = rows[0];
    if (cert.status === "issued") {
      throw conflict("Certificate has already been issued");
    }

    const pdf = await generateCertificatePdf({
      participantName: cert.participant_name as string,
      eventTitle: cert.event_title as string,
      eventDate: String(cert.event_date),
      certificateCode: cert.certificate_code as string,
    });

    const s3Key = buildCertificateKey(
      cert.event_id as number,
      cert.certificate_code as string
    );

    await putObject(s3Key, pdf, "application/pdf");

    await query(
      `UPDATE certificates
       SET s3_key = ?, status = 'issued', issued_date = CURDATE()
       WHERE certificate_id = ?`,
      [s3Key, certificateId]
    );

    const updated = await query<RowDataPacket[]>(
      "SELECT * FROM certificates WHERE certificate_id = ?",
      [certificateId]
    );

    res.json({ data: updated[0] });
  })
);

// ── GET /api/certificates/:id/download-url ──
router.get(
  "/certificates/:id/download-url",
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const certificateId = Number(req.params.id);
    if (!certificateId) throw badRequest("Invalid certificate ID");

    const rows = await query<RowDataPacket[]>(
      "SELECT certificate_id, s3_key, status FROM certificates WHERE certificate_id = ?",
      [certificateId]
    );
    if (rows.length === 0) throw notFound("Certificate not found");

    const cert = rows[0];
    if (cert.status !== "issued" || !cert.s3_key) {
      throw conflict("Certificate has not been issued yet");
    }

    const url = await getDownloadUrl(cert.s3_key as string);

    res.json({ data: { url } });
  })
);

export default router;
