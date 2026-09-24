import { Router, Request, Response } from "express";
import { RowDataPacket } from "mysql2/promise";
import { query } from "../db";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireAuth } from "../middleware/auth";

const router = Router();

// ── GET /api/dashboard/stats (any authenticated user) ──
router.get(
  "/stats",
  requireAuth,
  asyncHandler(async (_req: Request, res: Response) => {
    const [
      totalEvents,
      upcomingEvents,
      completedEvents,
      totalParticipants,
      totalRegistrations,
      certificatesIssued,
      eventsByCategory,
      eventsByYear,
      topEvents,
      recentUploads,
    ] = await Promise.all([
      query<RowDataPacket[]>("SELECT COUNT(*) AS count FROM events"),
      query<RowDataPacket[]>(
        "SELECT COUNT(*) AS count FROM events WHERE event_date >= CURDATE() AND status != 'cancelled'"
      ),
      query<RowDataPacket[]>(
        "SELECT COUNT(*) AS count FROM events WHERE status = 'completed'"
      ),
      query<RowDataPacket[]>("SELECT COUNT(*) AS count FROM participants"),
      query<RowDataPacket[]>(
        "SELECT COUNT(*) AS count FROM registrations WHERE status = 'registered'"
      ),
      query<RowDataPacket[]>(
        "SELECT COUNT(*) AS count FROM certificates WHERE status = 'issued'"
      ),
      query<RowDataPacket[]>(
        `SELECT category, COUNT(*) AS count
         FROM events
         GROUP BY category
         ORDER BY count DESC, category ASC`
      ),
      query<RowDataPacket[]>(
        `SELECT YEAR(event_date) AS year, COUNT(*) AS count
         FROM events
         GROUP BY year
         ORDER BY year ASC`
      ),
      // Top 5 by outcome participant count, falling back to registration count
      query<RowDataPacket[]>(
        `SELECT
           e.event_id,
           e.title,
           e.category,
           e.event_date,
           COALESCE(
             o.participants_count,
             (SELECT COUNT(*) FROM registrations r
              WHERE r.event_id = e.event_id AND r.status = 'registered')
           ) AS participants_count
         FROM events e
         LEFT JOIN outcomes o ON o.event_id = e.event_id
         ORDER BY participants_count DESC, e.event_date DESC
         LIMIT 5`
      ),
      query<RowDataPacket[]>(
        `SELECT
           f.file_id, f.event_id, f.original_name, f.file_type,
           f.content_type, f.size_bytes, f.uploaded_at,
           e.title AS event_title
         FROM event_files f
         JOIN events e ON f.event_id = e.event_id
         ORDER BY f.uploaded_at DESC, f.file_id DESC
         LIMIT 5`
      ),
    ]);

    res.json({
      data: {
        total_events: Number(totalEvents[0].count),
        upcoming_events: Number(upcomingEvents[0].count),
        completed_events: Number(completedEvents[0].count),
        total_participants: Number(totalParticipants[0].count),
        total_registrations: Number(totalRegistrations[0].count),
        certificates_issued: Number(certificatesIssued[0].count),
        events_by_category: eventsByCategory,
        events_by_year: eventsByYear,
        top_events: topEvents,
        recent_uploads: recentUploads,
      },
    });
  })
);

export default router;
