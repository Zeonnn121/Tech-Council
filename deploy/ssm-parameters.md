# SSM Parameter Store — `/tc-events/prod/`

The backend loads **all** of its configuration from SSM when `NODE_ENV=production`
(see `backend/src/config/index.ts`). It calls `GetParametersByPath` on
`SSM_PATH` (default `/tc-events/prod/`) with `WithDecryption: true` and
`Recursive: true`, then maps each parameter to a config key using the **last
segment of its name**. So the parameter names below are the config keys.

`AWS_REGION` is the only value that does **not** come from SSM — it is read from
the process environment (pm2 sets it to `ap-south-1` in `ecosystem.config.js`).

## Parameters to create

| Parameter name | Type | Example value | Notes |
| --- | --- | --- | --- |
| `/tc-events/prod/DB_HOST` | String | `<RDS_ENDPOINT>` | RDS endpoint hostname, e.g. `tc-events-db.abc123.ap-south-1.rds.amazonaws.com` |
| `/tc-events/prod/DB_PORT` | String | `3306` | MySQL port |
| `/tc-events/prod/DB_USER` | String | `<DB_USER>` | RDS master user you set at creation |
| `/tc-events/prod/DB_PASSWORD` | **SecureString** | `<DB_PASSWORD>` | Never store this as a plain String |
| `/tc-events/prod/DB_NAME` | String | `tc_events` | The initial database name |
| `/tc-events/prod/JWT_SECRET` | **SecureString** | `<RANDOM_SECRET>` | Signs login tokens — treat as a password |
| `/tc-events/prod/S3_BUCKET` | String | `<BUCKET_NAME>` | Private bucket for event files and certificates |

> Note: the parameter list in the project's prompt pack listed `JWT_SECRET` under
> both String and SecureString. It is created as **SecureString** here, which is
> the correct type for a signing key.

## Creating them (PowerShell)

Run these from your Windows machine with the AWS CLI configured. Replace every
`<PLACEHOLDER>` before running. Quoting is single-quote style so PowerShell does
not mangle the value.

```powershell
$Region = "ap-south-1"

aws ssm put-parameter --name "/tc-events/prod/DB_HOST"     --type String       --value "<RDS_ENDPOINT>"  --region $Region
aws ssm put-parameter --name "/tc-events/prod/DB_PORT"     --type String       --value "3306"            --region $Region
aws ssm put-parameter --name "/tc-events/prod/DB_USER"     --type String       --value "<DB_USER>"       --region $Region
aws ssm put-parameter --name "/tc-events/prod/DB_PASSWORD" --type SecureString --value "<DB_PASSWORD>"   --region $Region
aws ssm put-parameter --name "/tc-events/prod/DB_NAME"     --type String       --value "tc_events"       --region $Region
aws ssm put-parameter --name "/tc-events/prod/JWT_SECRET"  --type SecureString --value "<RANDOM_SECRET>" --region $Region
aws ssm put-parameter --name "/tc-events/prod/S3_BUCKET"   --type String       --value "<BUCKET_NAME>"   --region $Region
```

Generate a strong `JWT_SECRET` rather than inventing one, e.g.:

```powershell
[Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 }))
```

## Updating a value later

`put-parameter` fails if the parameter already exists. Add `--overwrite`:

```powershell
aws ssm put-parameter --name "/tc-events/prod/DB_PASSWORD" --type SecureString --value "<NEW_PASSWORD>" --overwrite --region ap-south-1
```

After changing a value, restart the app so it re-reads SSM (config is cached in
memory for the lifetime of the process):

```bash
pm2 restart tc-backend
```

## Verifying

```powershell
aws ssm get-parameters-by-path --path "/tc-events/prod/" --recursive --with-decryption --region ap-south-1 --query "Parameters[].Name"
```

You should see all seven names. The EC2 instance role only needs read access to
this path — that is what `deploy/iam-ec2-policy.json` grants.
