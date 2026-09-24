# Importing the schema into RDS

RDS sits in the **private** subnets with **public access = No**, and `db-sg` only
accepts MySQL from `app-sg`. You therefore cannot reach it from your laptop —
run everything below **from the EC2 instance** over Session Manager.

The `database/schema.sql` file is not part of `app.tar.gz`, so step 1 puts it in
S3 first and the instance pulls it down.

## 1. Upload the schema (Windows, once)

```powershell
aws s3 cp database/schema.sql "s3://<BUCKET_NAME>/deploy/schema.sql" --region ap-south-1
```

## 2. Open a shell on the instance

Console: **EC2 → Instances → select your instance → Connect → Session Manager → Connect**

Or from PowerShell:

```powershell
aws ssm start-session --target <INSTANCE_ID> --region ap-south-1
```

No SSH key or open port 22 is needed — that is what the
`AmazonSSMManagedInstanceCore` managed policy enables.

## 3. Install the MySQL client

Amazon Linux 2023 ships the MariaDB 10.5 client, which is compatible:

```bash
sudo dnf install -y mariadb105
```

## 4. Fetch the schema

```bash
aws s3 cp s3://<BUCKET_NAME>/deploy/schema.sql ~/schema.sql
```

## 5. Import it

```bash
mysql -h <RDS_ENDPOINT> -u <DB_USER> -p tc_events < ~/schema.sql
```

`<RDS_ENDPOINT>` is the RDS hostname from the console (it is also the value of
the `/tc-events/prod/DB_HOST` SSM parameter). The `tc_events` database already
exists because you set it as the initial database name when creating the RDS
instance.

The schema uses `CREATE TABLE IF NOT EXISTS`, so re-running this is harmless.

## 6. Verify

```bash
mysql -h <RDS_ENDPOINT> -u <DB_USER> -p -e "SHOW TABLES;" tc_events
```

You should see all nine tables: `attendance`, `certificates`, `event_files`,
`events`, `organizers`, `outcomes`, `participants`, `registrations`, `users`.

---

## Before your demo: the tables are empty

`schema.sql` creates **structure only** — no rows. A fresh RDS database means:

- there is **no admin user, so you cannot log in**, and
- the dashboard legitimately shows all zeros.

Your local Docker MySQL is already seeded, so the quickest fix is to dump that
data and load it into RDS.

**On your Windows machine:**

```powershell
docker exec tc-mysql mysqldump -uroot -proot --no-create-info --skip-add-locks tc_events > seed-data.sql
aws s3 cp seed-data.sql "s3://<BUCKET_NAME>/deploy/seed-data.sql" --region ap-south-1
```

**On the instance (Session Manager):**

```bash
aws s3 cp s3://<BUCKET_NAME>/deploy/seed-data.sql ~/seed-data.sql
mysql -h <RDS_ENDPOINT> -u <DB_USER> -p tc_events < ~/seed-data.sql
mysql -h <RDS_ENDPOINT> -u <DB_USER> -p -e "SELECT COUNT(*) FROM users;" tc_events
```

`--no-create-info` dumps data only, so it will not clash with the schema you
already imported. After this, log in with `admin@council.edu` / `Admin@123`.

Delete `seed-data.sql` from your machine and from the bucket afterwards — it
contains password hashes.
