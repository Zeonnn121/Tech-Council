# `deploy/` — EC2 and Auto Scaling artifacts

Everything here targets **Amazon Linux 2023** in **`ap-south-1`**. The Windows
development machine only runs `build-and-upload.ps1`; everything else runs on the
instance.

## Files

| File | Runs on | Purpose |
| --- | --- | --- |
| `build-and-upload.ps1` | Windows | Builds frontend + backend, creates `app.tar.gz`, uploads it and the CloudWatch config to S3 |
| `user-data.sh` | EC2 (root, first boot) | Installs Node 20 / pm2 / CloudWatch agent, pulls the bundle, installs deps, starts the app, redirects :80 → :3000 |
| `ecosystem.config.js` | EC2 (pm2) | pm2 app definition: `tc-backend`, port 3000, production env, logs to `/var/log/tc-app/` |
| `cloudwatch-agent-config.json` | EC2 (CloudWatch agent) | Ships both log files to `/tc-events/app` and collects memory/disk metrics |
| `iam-ec2-policy.json` | AWS console | Least-privilege inline policy for the EC2 instance role |
| `ssm-parameters.md` | Windows / console | The seven `/tc-events/prod/` parameters the app reads at boot |
| `schema-import.md` | EC2 (Session Manager) | Import `database/schema.sql` into private RDS, plus loading demo data |

## Required IAM permissions for the EC2 role

Attach **all three** of the following to the instance role:

1. **`iam-ec2-policy.json`** (this folder) — inline policy. Replace the
   `BUCKET_NAME`, `REGION` and `ACCOUNT_ID` placeholders before attaching. This
   covers reading the deploy bundle, reading/writing the private S3 bucket, and
   reading the app's SSM parameters.
2. **`CloudWatchAgentServerPolicy`** — AWS managed. Lets the CloudWatch agent
   create the `/tc-events/app` log group and publish metrics.
3. **`AmazonSSMManagedInstanceCore`** — AWS managed. Lets you open a Session
   Manager shell **without opening port 22 or using a key pair**. The schema
   import and any instance debugging depend on this.

## End-to-end workflow

1. **Create the bucket folders** `events/`, `certificates/`, `backups/`,
   `deploy/`, and add the S3 CORS config documented at the top of
   `backend/src/services/s3.service.ts`.
2. **Create the SSM parameters** — see `ssm-parameters.md`.
3. **Create the IAM role** with the three policies above.
4. **Build and upload:**
   ```powershell
   cd deploy
   .\build-and-upload.ps1 -BucketName <BUCKET_NAME>
   ```
5. **Launch the instance** (Amazon Linux 2023, `t3.micro`, public subnet,
   `app-sg`, the IAM role) with the contents of `user-data.sh` as user data.
   Edit `BUCKET_NAME` at the top of that script first.
6. **Import the schema** into RDS — see `schema-import.md`. Do this before the
   demo, or you will have no admin user to log in with.
7. **Open `http://<INSTANCE_PUBLIC_IP>/`** in a browser. Port 80 is redirected
   to the app's port 3000 by an iptables rule.

## Things that will bite you

- **No secrets live in this folder.** Every value is a placeholder, and the app
  reads real secrets from SSM at boot using the instance role. If you ever find
  yourself pasting a password into `user-data.sh` or `ecosystem.config.js`,
  something has gone wrong.
- **The iptables rule is not reboot-persistent.** User data re-applies it on
  every *new* instance, so Auto Scaling scale-out is fine, but a manual `reboot`
  of an existing instance needs `user-data.sh` re-run (or the rule re-added).
- **`user-data.sh` and `cloudwatch-agent-config.json` are two separate S3
  objects.** If you edit the CloudWatch config, re-run `build-and-upload.ps1` or
  the instance will fetch the stale copy.
- **`build-and-upload.ps1` uses `npm ci`**, which deletes `node_modules` and
  installs strictly from `package-lock.json`. Commit the lockfile after any
  dependency change or the build will fail.
- **The bundle does not include `database/schema.sql`** — that is deliberate,
  since RDS is set up once and separately from app deploys.
