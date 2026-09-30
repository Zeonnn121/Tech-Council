import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';

const snsClient = new SNSClient({});

const ALLOWED_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'pdf', 'docx']);
const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Classify an S3 key into a category based on its path prefix.
 * Key patterns:
 *   events/event-{id}/photos/...       → photo
 *   events/event-{id}/reports/...      → report
 *   events/event-{id}/posters/...      → poster
 *   events/event-{id}/documents/...    → document
 *   certificates/...                   → certificate
 */
function classifyKey(key) {
  if (key.startsWith('certificates/')) return 'certificate';
  const match = key.match(/^events\/event-\d+\/(photos|reports|posters|documents)\//);
  if (!match) return 'unknown';
  const folder = match[1];
  const map = { photos: 'photo', reports: 'report', posters: 'poster', documents: 'document' };
  return map[folder] ?? 'unknown';
}

function getExtension(key) {
  const parts = key.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
}

async function processRecord(record) {
  const bucket = record.s3.bucket.name;
  const rawKey = record.s3.object.key;
  const key = decodeURIComponent(rawKey.replace(/\+/g, ' '));
  const size = record.s3.object.size;
  const time = record.eventTime ?? new Date().toISOString();

  const ext = getExtension(key);
  const category = classifyKey(key);
  const extensionValid = ALLOWED_EXTENSIONS.has(ext);
  const sizeValid = size <= MAX_SIZE_BYTES;
  const valid = extensionValid && sizeValid;

  const logEntry = {
    bucket,
    key,
    size,
    category,
    valid,
    time,
    ...(valid ? {} : {
      reason: !extensionValid
        ? `disallowed extension: .${ext}`
        : `file too large: ${size} bytes (max ${MAX_SIZE_BYTES})`,
    }),
  };
  console.log(JSON.stringify(logEntry));

  const topicArn = process.env.SNS_TOPIC_ARN;
  if (!topicArn) throw new Error('SNS_TOPIC_ARN environment variable is not set');

  const subject = valid ? `New upload: ${category}` : 'Invalid upload';
  const message = JSON.stringify({ key, size, time, category, valid, bucket });

  await snsClient.send(new PublishCommand({
    TopicArn: topicArn,
    Subject: subject,
    Message: message,
  }));
}

export async function handler(event) {
  const records = event.Records ?? [];
  const errors = [];

  for (const record of records) {
    try {
      await processRecord(record);
    } catch (err) {
      console.error(JSON.stringify({ error: String(err), record }));
      errors.push(err);
    }
  }

  if (errors.length > 0) {
    throw new Error(`${errors.length} record(s) failed: ${errors.map(String).join('; ')}`);
  }
}
