import PDFDocument from "pdfkit";

export interface CertificateData {
  participantName: string;
  eventTitle: string;
  eventDate: string; // YYYY-MM-DD
  certificateCode: string;
}

function pad(value: number, length: number): string {
  return String(value).padStart(length, "0");
}

/**
 * Certificate code format: TC-{year}-E{eventId padded to 3}-P{participantId padded to 4}
 * e.g. event 7, participant 42, year 2025 -> TC-2025-E007-P0042
 */
export function buildCertificateCode(
  year: number,
  eventId: number,
  participantId: number
): string {
  return `TC-${year}-E${pad(eventId, 3)}-P${pad(participantId, 4)}`;
}

/** S3 object key for a generated certificate PDF. */
export function buildCertificateKey(
  eventId: number,
  certificateCode: string
): string {
  return `certificates/event-${eventId}/${certificateCode}.pdf`;
}

/**
 * Renders a certificate as an in-memory PDF buffer.
 * Nothing is written to disk; the buffer is handed straight to S3.
 */
export function generateCertificatePdf(data: CertificateData): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        layout: "landscape",
        margin: 0,
        info: {
          Title: `Certificate ${data.certificateCode}`,
          Author: "Technical Council",
        },
      });

      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const pageWidth = doc.page.width;
      const pageHeight = doc.page.height;

      // Decorative double border
      doc
        .rect(28, 28, pageWidth - 56, pageHeight - 56)
        .lineWidth(3)
        .strokeColor("#1f4e79")
        .stroke();
      doc
        .rect(42, 42, pageWidth - 84, pageHeight - 84)
        .lineWidth(1)
        .strokeColor("#1f4e79")
        .stroke();

      doc
        .fillColor("#1f4e79")
        .font("Helvetica-Bold")
        .fontSize(30)
        .text("Certificate of Participation", 0, 95, {
          align: "center",
          width: pageWidth,
        });

      doc
        .fillColor("#333333")
        .font("Helvetica")
        .fontSize(14)
        .text("This is to certify that", 0, 165, {
          align: "center",
          width: pageWidth,
        });

      doc
        .fillColor("#000000")
        .font("Helvetica-Bold")
        .fontSize(28)
        .text(data.participantName, 0, 195, {
          align: "center",
          width: pageWidth,
        });

      doc
        .fillColor("#333333")
        .font("Helvetica")
        .fontSize(14)
        .text("has successfully participated in", 0, 248, {
          align: "center",
          width: pageWidth,
        });

      doc
        .fillColor("#1f4e79")
        .font("Helvetica-Bold")
        .fontSize(22)
        .text(data.eventTitle, 0, 276, {
          align: "center",
          width: pageWidth,
        });

      doc
        .fillColor("#333333")
        .font("Helvetica")
        .fontSize(14)
        .text(`held on ${data.eventDate}`, 0, 318, {
          align: "center",
          width: pageWidth,
        });

      doc
        .fillColor("#555555")
        .font("Helvetica")
        .fontSize(11)
        .text(`Certificate Code: ${data.certificateCode}`, 0, 385, {
          align: "center",
          width: pageWidth,
        });

      doc
        .fillColor("#1f4e79")
        .font("Helvetica-Bold")
        .fontSize(13)
        .text("Technical Council", 0, 430, {
          align: "center",
          width: pageWidth,
        });

      doc
        .fillColor("#888888")
        .font("Helvetica")
        .fontSize(9)
        .text("Issued by the Cloud-Based Event Management System", 0, 452, {
          align: "center",
          width: pageWidth,
        });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
