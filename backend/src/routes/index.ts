import { Router } from "express";
import authRoutes from "./auth.routes";
import usersRoutes from "./users.routes";
import eventsRoutes from "./events.routes";
import participantsRoutes from "./participants.routes";
import registrationsRoutes from "./registrations.routes";
import filesRoutes from "./files.routes";
import certificatesRoutes from "./certificates.routes";
import dashboardRoutes from "./dashboard.routes";

const router = Router();

router.use("/auth", authRoutes);
router.use("/users", usersRoutes);
router.use("/events", eventsRoutes);
router.use("/participants", participantsRoutes);

// Registrations and attendance are sub-resources of events and registrations
router.use("/", registrationsRoutes);

// Files: /events/:id/files[...] and /files/:fileId[...]
router.use("/", filesRoutes);

// Certificates: /events/:id/certificates, /participants/:id/certificates,
// /certificates/:id/issue and /certificates/:id/download-url
router.use("/", certificatesRoutes);

router.use("/dashboard", dashboardRoutes);

export default router;
