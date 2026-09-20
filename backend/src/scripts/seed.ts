import "dotenv/config";
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";

async function main() {
  const force = process.argv.includes("--force");

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: true,
  });

  try {
    const [existing] = await conn.query("SELECT COUNT(*) as cnt FROM users");
    if ((existing as any)[0].cnt > 0 && !force) {
      console.log("Already seeded. Use --force to re-seed.");
      return;
    }

    if (force) {
      console.log("Truncating all tables...");
      await conn.query("SET FOREIGN_KEY_CHECKS=0");
      const tables = [
        "certificates",
        "event_files",
        "outcomes",
        "attendance",
        "registrations",
        "organizers",
        "events",
        "participants",
        "users",
      ];
      for (const t of tables) {
        await conn.query(`TRUNCATE TABLE \`${t}\``);
      }
      await conn.query("SET FOREIGN_KEY_CHECKS=1");
    }

    const hash = (pw: string) => bcrypt.hashSync(pw, 10);

    // ── Users ──
    const users: any[] = [
      ["Admin User", "admin@council.edu", hash("Admin@123"), "admin", "CSE"],
      [
        "Organizer One",
        "organizer1@council.edu",
        hash("Organizer@123"),
        "organizer",
        "CSE",
      ],
      [
        "Organizer Two",
        "organizer2@council.edu",
        hash("Organizer@123"),
        "organizer",
        "IT",
      ],
      [
        "Member User",
        "member@council.edu",
        hash("Member@123"),
        "member",
        "ECE",
      ],
    ];
    for (const u of users) {
      await conn.query(
        "INSERT INTO users (name, email, password_hash, role, department) VALUES (?, ?, ?, ?, ?)",
        u
      );
    }
    console.log("Seeded 4 users.");

    // ── Participants ──
    const departments = ["CSE", "IT", "ECE", "MECH"];
    const participants: any[] = [];
    for (let i = 1; i <= 20; i++) {
      participants.push([
        `Participant ${i}`,
        `participant${i}@student.edu`,
        departments[(i - 1) % 4],
        ((i - 1) % 4) + 1, // year 1-4
        `98765${String(10000 + i).slice(0, 5)}`,
      ]);
    }
    for (const p of participants) {
      await conn.query(
        "INSERT INTO participants (name, email, department, year, phone) VALUES (?, ?, ?, ?, ?)",
        p
      );
    }
    console.log("Seeded 20 participants.");

    // ── Events ──
    // 6 events across 2024-2026, varied categories/statuses, no venue/time overlaps
    const events: any[] = [
      // 1 - completed
      [
        "Web Development Workshop",
        "Hands-on workshop on React and Node.js",
        "Workshop",
        "2024-03-15",
        "09:00:00",
        "12:00:00",
        "Seminar Hall A",
        2, // coordinator: organizer1
        100,
        "2024-03-10",
        "completed",
        1, // created_by: admin
      ],
      // 2 - completed
      [
        "Code Sprint Hackathon",
        "24-hour hackathon for all branches",
        "Hackathon",
        "2024-09-20",
        "08:00:00",
        "08:00:00", // next day 08:00 (24h)
        "Lab Block B",
        3, // coordinator: organizer2
        60,
        "2024-09-15",
        "completed",
        1,
      ],
      // 3 - completed
      [
        "AI & ML Seminar",
        "Introduction to machine learning concepts",
        "Seminar",
        "2025-01-25",
        "10:00:00",
        "13:00:00",
        "Seminar Hall A",
        2,
        150,
        "2025-01-20",
        "completed",
        1,
      ],
      // 4 - registration_open
      [
        "Tech Innovation Competition",
        "Pitch your innovation idea",
        "Competition",
        "2026-04-10",
        "14:00:00",
        "17:00:00",
        "Auditorium",
        3,
        80,
        "2026-04-05",
        "registration_open",
        1,
      ],
      // 5 - planned
      [
        "Cloud Computing Workshop",
        "AWS basics and hands-on labs",
        "Workshop",
        "2026-08-20",
        "09:00:00",
        "12:00:00",
        "Lab Block C",
        2,
        50,
        "2026-08-15",
        "planned",
        1,
      ],
      // 6 - completed
      [
        "Cyber Security Seminar",
        "Ethical hacking and security practices",
        "Seminar",
        "2025-11-05",
        "11:00:00",
        "13:30:00",
        "Auditorium",
        3,
        120,
        "2025-10-30",
        "completed",
        1,
      ],
    ];
    for (const e of events) {
      await conn.query(
        `INSERT INTO events (title, description, category, event_date, start_time, end_time, venue, coordinator_id, capacity, registration_deadline, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        e
      );
    }
    console.log("Seeded 6 events.");

    // ── Organizers ──
    // Each event gets both organizers with different responsibilities
    for (let eid = 1; eid <= 6; eid++) {
      await conn.query(
        "INSERT INTO organizers (event_id, user_id, responsibility) VALUES (?, ?, ?)",
        [eid, 2, "Logistics and venue"]
      );
      await conn.query(
        "INSERT INTO organizers (event_id, user_id, responsibility) VALUES (?, ?, ?)",
        [eid, 3, "Participants and communications"]
      );
    }
    console.log("Seeded organizers for all events.");

    // ── Registrations ──
    // 8-12 per event for completed events (1-3, 6) and event 4 (registration_open)
    // Event 5 is planned — no registrations
    const regData: { eventId: number; count: number }[] = [
      { eventId: 1, count: 10 },
      { eventId: 2, count: 12 },
      { eventId: 3, count: 8 },
      { eventId: 4, count: 10 },
      { eventId: 6, count: 11 },
    ];
    let pOffset = 0;
    for (const rd of regData) {
      for (let i = 0; i < rd.count; i++) {
        const pid = ((pOffset + i) % 20) + 1;
        await conn.query(
          "INSERT INTO registrations (event_id, participant_id, status) VALUES (?, ?, 'registered')",
          [rd.eventId, pid]
        );
      }
      pOffset += rd.count;
    }
    console.log("Seeded registrations.");

    // ── Attendance ──
    // For completed events (1, 2, 3, 6), mark some present
    const attEvents = [
      { eventId: 1, present: 8, absent: 2 },
      { eventId: 2, present: 10, absent: 2 },
      { eventId: 3, present: 7, absent: 1 },
      { eventId: 6, present: 9, absent: 2 },
    ];
    let aOffset = 0;
    for (const ae of attEvents) {
      const [rows] = await conn.query(
        "SELECT participant_id FROM registrations WHERE event_id = ? AND status = 'registered' ORDER BY registration_id",
        [ae.eventId]
      );
      const pids = (rows as any[]).map((r) => r.participant_id);
      for (let i = 0; i < pids.length; i++) {
        const present = i < ae.present ? 1 : 0;
        await conn.query(
          "INSERT INTO attendance (event_id, participant_id, present) VALUES (?, ?, ?)",
          [ae.eventId, pids[i], present]
        );
      }
    }
    console.log("Seeded attendance.");

    // ── Outcomes ──
    const outcomeData = [
      [1, 8, 4.2, "Team Alpha", "Great workshop turnout"],
      [2, 10, 4.5, "Team Beta", "Innovative solutions presented"],
      [3, 7, 4.0, null, "Informative session on AI trends"],
      [6, 9, 4.3, null, "Security awareness improved"],
    ];
    for (const o of outcomeData) {
      await conn.query(
        "INSERT INTO outcomes (event_id, participants_count, feedback_score, winners, description) VALUES (?, ?, ?, ?, ?)",
        o
      );
    }
    console.log("Seeded outcomes.");

    // ── Certificates ──
    // A few pending and issued certificates for completed events
    const certData = [
      ["TC-2024-E001-P0001", 1, 1, null, "pending", null],
      ["TC-2024-E001-P0002", 1, 2, null, "pending", null],
      ["TC-2024-E002-P0003", 2, 3, "certs/event-2/TC-2024-E002-P0003.pdf", "issued", "2024-10-01"],
      ["TC-2025-E003-P0004", 3, 4, "certs/event-3/TC-2025-E003-P0004.pdf", "issued", "2025-02-10"],
      ["TC-2025-E006-P0005", 6, 5, null, "pending", null],
    ];
    for (const c of certData) {
      await conn.query(
        "INSERT INTO certificates (certificate_code, event_id, participant_id, s3_key, status, issued_date) VALUES (?, ?, ?, ?, ?, ?)",
        c
      );
    }
    console.log("Seeded certificates.");

    console.log("\nSeeding complete!");
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
