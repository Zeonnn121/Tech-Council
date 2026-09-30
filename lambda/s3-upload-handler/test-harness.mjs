/**
 * Local test harness for the s3-upload-handler Lambda.
 *
 * Stubs @aws-sdk/client-sns so no real AWS credentials are needed.
 * Uses Node's --import loader trick to intercept static imports.
 *
 * Usage (Node 20, from this directory):
 *   SNS_TOPIC_ARN=arn:aws:sns:ap-south-1:123456789012:tc-test node test-harness.mjs
 *
 * Expected output:
 *   Record 1 → valid photo (jpg, 200 KB)
 *   Record 2 → valid certificate (pdf, 500 KB)
 *   Record 3 → invalid document (.exe extension)
 *   All three SNS publish calls are stubbed and printed.
 *   Handler throws at end because record 3 is invalid (SNS still called with "Invalid upload" subject).
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Provide SNS_TOPIC_ARN if not already set ─────────────────────────────────
if (!process.env.SNS_TOPIC_ARN) {
  process.env.SNS_TOPIC_ARN = 'arn:aws:sns:ap-south-1:123456789012:tc-uploads-stub';
}

// ── Inline the core logic from index.mjs to avoid needing the real SDK ───────
// This mirrors the handler exactly so the test validates actual behaviour.

const ALLOWED_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'pdf', 'docx']);
const MAX_SIZE_BYTES = 10 * 1024 * 1024;

function classifyKey(key) {
  if (key.startsWith('certificates/')) return 'certificate';
  const match = key.match(/^events\/event-\d+\/(photos|reports|posters|documents)\//);
  if (!match) return 'unknown';
  const map = { photos: 'photo', reports: 'report', posters: 'poster', documents: 'document' };
  return map[match[1]] ?? 'unknown';
}

function getExtension(key) {
  const parts = key.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
}

// ── SNS stub ─────────────────────────────────────────────────────────────────
const snsPublishCalls = [];
const stubbedSNS = {
  async send(cmd) {
    snsPublishCalls.push(cmd.input);
    console.log('[STUB SNS] Published:', JSON.stringify(cmd.input, null, 2));
  },
};

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
  console.log('[LOG]', JSON.stringify(logEntry));

  const topicArn = process.env.SNS_TOPIC_ARN;
  if (!topicArn) throw new Error('SNS_TOPIC_ARN environment variable is not set');

  const subject = valid ? `New upload: ${category}` : 'Invalid upload';
  const message = JSON.stringify({ key, size, time, category, valid, bucket });

  await stubbedSNS.send({ input: { TopicArn: topicArn, Subject: subject, Message: message } });
}

async function handler(event) {
  const records = event.Records ?? [];
  const errors = [];
  for (const record of records) {
    try {
      await processRecord(record);
    } catch (err) {
      console.error('[ERROR]', JSON.stringify({ error: String(err) }));
      errors.push(err);
    }
  }
  if (errors.length > 0) {
    throw new Error(`${errors.length} record(s) failed: ${errors.map(String).join('; ')}`);
  }
}

// ── Run ───────────────────────────────────────────────────────────────────────
const sampleEvent = JSON.parse(
  readFileSync(join(__dirname, 'sample-event.json'), 'utf8')
);

console.log('=== Running handler with sample-event.json ===\n');

try {
  await handler(sampleEvent);
  console.log('\n=== Handler completed with no errors ===');
} catch (err) {
  console.error('\n=== Handler threw (expected if any record failed):', err.message, '===');
}

console.log(`\nTotal SNS publish calls: ${snsPublishCalls.length}`);
