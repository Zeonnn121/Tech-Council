# s3-upload-handler Lambda

Triggered by S3 `ObjectCreated:*` events on prefixes `events/` and `certificates/`.  
For every record it validates the upload, logs a structured JSON line, and publishes a notification to an SNS topic.

---

## Environment variable

| Variable | Required | Description |
|---|---|---|
| `SNS_TOPIC_ARN` | Yes | ARN of the SNS topic to publish notifications to (e.g. `arn:aws:sns:ap-south-1:123456789012:tc-uploads`) |

---

## Execution role permissions

Attach **`AWSLambdaBasicExecutionRole`** (managed policy) plus the following inline statement:

```json
{
  "Effect": "Allow",
  "Action": "sns:Publish",
  "Resource": "arn:aws:sns:REGION:ACCOUNT_ID:YOUR_TOPIC_NAME"
}
```

Replace `REGION`, `ACCOUNT_ID`, and `YOUR_TOPIC_NAME` with your actual values.

---

## Adding the S3 trigger

1. In the AWS Console → Lambda → your function → **Add trigger** → S3.
2. Select your bucket.
3. Event types: **All object create events** (`s3:ObjectCreated:*`).
4. Add **two prefix filters** (one per rule):
   - Prefix: `events/`
   - Prefix: `certificates/`

> **Note:** Each S3 event notification rule can have only one prefix. Add the two prefixes as two separate trigger configurations on the same Lambda function.

---

## Warnings

**Do not configure overlapping prefix triggers.**  
If two notification rules have prefixes that overlap (e.g. `events/` and `events/event-1/`), S3 will fire both for keys matching the more specific path and your Lambda will process the same record twice.

**Do not make this Lambda write to the same bucket paths it is triggered by.**  
Writing an object under `events/` or `certificates/` from inside the handler would immediately re-trigger the function, causing an infinite recursive-invocation loop and unexpected AWS costs. This function only reads record metadata and publishes to SNS — it never writes to S3.

---

## Runtime

- Node.js 20 (ES modules, `.mjs`)
- Uses `@aws-sdk/client-sns` from the Lambda runtime (no bundling needed — the AWS SDK v3 is included in the Node 20 managed runtime)
- No `package.json` dependencies

---

## Local testing

Run the test harness to validate parsing logic without real AWS credentials:

```powershell
# From this directory
$env:SNS_TOPIC_ARN = "arn:aws:sns:ap-south-1:123456789012:tc-uploads-stub"
node test-harness.mjs
```

The harness exercises all three records in `sample-event.json`:

| Record | Key | Expected result |
|---|---|---|
| 1 | `events/event-1/photos/…jpg` | valid photo, SNS subject `New upload: photo` |
| 2 | `certificates/event-1/TC-2025-E001-P0042.pdf` | valid certificate, SNS subject `New upload: certificate` |
| 3 | `events/event-2/documents/report-final.exe` | **invalid** (disallowed extension), SNS subject `Invalid upload` |

All three SNS calls are stubbed and printed to stdout. The handler re-throws at the end because at least one record is invalid, matching the production behaviour (Lambda retry semantics).
