<#
.SYNOPSIS
    Builds the frontend and backend, bundles the deployment archive and uploads
    it to S3 for the EC2 launch template to download.

.DESCRIPTION
    Runs on the Windows development machine. Requires the AWS CLI to already be
    configured (aws configure) with access to the target bucket.

    The archive has this layout, and matches what deploy/user-data.sh expects
    once extracted into /opt/tc-app:

        backend/dist/
        backend/package.json
        backend/package-lock.json
        frontend/dist/
        deploy/ecosystem.config.js

.PARAMETER BucketName
    Target S3 bucket, e.g. tc-events-deploy.

.PARAMETER Region
    AWS region. Defaults to ap-south-1.

.EXAMPLE
    .\build-and-upload.ps1 -BucketName tc-events-deploy
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$BucketName,

    [string]$Region = "ap-south-1"
)

$ErrorActionPreference = "Stop"

# Repo root is the parent of this script's folder (deploy/)
$RepoRoot = Split-Path -Parent $PSScriptRoot
$Archive  = Join-Path $RepoRoot "app.tar.gz"

Write-Host "==> Repo root : $RepoRoot"
Write-Host "==> Bucket    : s3://$BucketName"
Write-Host "==> Region    : $Region"

function Invoke-Step {
    param([string]$WorkingDirectory, [scriptblock]$Action)
    Push-Location $WorkingDirectory
    try { & $Action } finally { Pop-Location }
}

# ── 1. Build the frontend ──
Write-Host "`n==> Building frontend"
Invoke-Step (Join-Path $RepoRoot "frontend") {
    npm ci
    if ($LASTEXITCODE -ne 0) { throw "frontend: npm ci failed" }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "frontend: npm run build failed" }
}

# ── 2. Build the backend ──
Write-Host "`n==> Building backend"
Invoke-Step (Join-Path $RepoRoot "backend") {
    npm ci
    if ($LASTEXITCODE -ne 0) { throw "backend: npm ci failed" }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "backend: npm run build failed" }
}

# ── 3. Bundle ──
# `tar` is the one built into Windows 10+ (bsdtar). -C keeps the member paths
# relative to the repo root so they extract correctly into /opt/tc-app.
Write-Host "`n==> Creating app.tar.gz"
if (Test-Path $Archive) { Remove-Item $Archive -Force }

Invoke-Step $RepoRoot {
    tar -czf $Archive `
        -C $RepoRoot `
        backend/dist `
        backend/package.json `
        backend/package-lock.json `
        frontend/dist `
        deploy/ecosystem.config.js
    if ($LASTEXITCODE -ne 0) { throw "tar failed creating $Archive" }
}

Write-Host ("    {0} ({1:N1} KB)" -f $Archive, ((Get-Item $Archive).Length / 1KB))

# ── 4. Upload ──
Write-Host "`n==> Uploading to S3"
aws s3 cp $Archive "s3://$BucketName/deploy/app.tar.gz" --region $Region
if ($LASTEXITCODE -ne 0) { throw "upload of app.tar.gz failed" }

# The CloudWatch agent config travels separately: EC2 user data downloads it
# from here so the launch template stays self-contained.
aws s3 cp (Join-Path $PSScriptRoot "cloudwatch-agent-config.json") `
    "s3://$BucketName/deploy/cloudwatch-agent-config.json" --region $Region
if ($LASTEXITCODE -ne 0) { throw "upload of cloudwatch-agent-config.json failed" }

Write-Host "`n==> Done. Launch/replace the instance with deploy/user-data.sh as user data."
