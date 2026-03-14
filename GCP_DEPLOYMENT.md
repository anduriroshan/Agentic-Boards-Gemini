# Agentic Boards - GCP Deployment Guide

This guide explains how to deploy the Agentic Boards application to Google Cloud Run.

## Prerequisites

1.  **Google Cloud Project**: Create a project in the [GCP Console](https://console.cloud.google.com/).
2.  **gcloud CLI**: [Install and initialize](https://cloud.google.com/sdk/docs/install) the Google Cloud SDK.
3.  **Enable APIs**:
    ```bash
    gcloud services enable run.googleapis.com \
                           artifactregistry.googleapis.com \
                           cloudbuild.googleapis.com
    ```

4.  **Service Account Permissions**:
    Instead of using a `service_account.json` file, Cloud Run uses **Application Default Credentials (ADC)**. This is safer because you don't need to push keys to GitHub.
    
    Grant your project's service account (usually `[PROJECT_NUMBER]-compute@developer.gserviceaccount.com`) the following roles in the [IAM Console](https://console.cloud.google.com/iam-admin/iam):
    - `BigQuery Admin` (If using BigQuery)
    - `Vertex AI User` (If using Gemini)
    - `Storage Admin` (To allow the deployment script to create/mount the persistence bucket)

## Quick Deployment

Use the provided automated script:

```bash
chmod +x deploy-gcp.sh
./deploy-gcp.sh
```

The script will:
- Build the Docker image using Cloud Build.
- Push the image to Artifact Registry.
- Deploy to Google Cloud Run with **GCS volume mounting** for SQLite persistence.
- (Optional) Automate Cloudflare DNS records.

## Environment Variables

The `deploy-gcp.sh` script **automatically** reads your `backend/.env` file and pushes all variables to Cloud Run. You don't need to add them manually in the terminal.

If you ever need to update a single variable *without* re-deploying the whole app, you can use:

```bash
gcloud run services update agentic-boards \
  --set-env-vars="GEMINI_API_KEY=your_key,ALLOWED_ORIGINS=https://agentic-boards.live"
```

> [!TIP]
> For sensitive values like `DATABRICKS_TOKEN`, use **Google Cloud Secret Manager** and link them to Cloud Run.

## Custom Domain (Cloudflare)

Deployment and DNS are now **fully automated**! If you provide the Cloudflare variables in your `.env`, the script will:
1.  Map the domain in Google Cloud.
2.  Update your Cloudflare CNAME record to point to Google.

If you prefer to do it manually:
1.  **GCP Console**: Go to **Cloud Run** -> select `agentic-boards` -> **Manage Custom Domains**.
2.  **Add Mapping**: Click **Add Mapping**, select your domain, and follow the verification steps (Google may ask you to add a TXT record to Cloudflare to prove ownership).
3.  **DNS Records**: Once verified, Google will provide you with DNS records (usually a **CNAME** pointing to `ghs.googlehosted.com` or a set of **A/AAAA** records).
4.  **Cloudflare Dashboard**:
    - Go to the **DNS** tab.
    - Add the records provided by Google.
    - **Pro Tip**: Set the **Proxy status** to "Proxied" (Orange cloud) for Cloudflare's security and performance benefits.
5.  **SSL/TLS**: In Cloudflare, go to **SSL/TLS** -> **Overview** and set the encryption mode to **Full (strict)**. Cloud Run provides its own managed certificates, and this setting ensures the connection is encrypted all the way from the user to Cloud Run.

## CI/CD with Cloud Build

A `cloudbuild.yaml` is included. You can connect your GitHub repository to Cloud Build to automate deployments on every `git push`.

1.  Go to [Cloud Build Triggers](https://console.cloud.google.com/cloud-build/triggers).
2.  Click **Connect Repository**.
3.  Create a trigger using `cloudbuild.yaml`.

## Data Persistence (GCS Mount)

The app uses **Cloud Run Volume Mounts** to persist the SQLite database. 
- A GCS bucket `[PROJECT-ID]-data` is created.
- It is mounted to `/app/data` in the container.
- If you lose your service account, the bucket remains safe.

## Troubleshooting: "Account Deleted"

If you see an error about a deleted account during build:
1.  Run `gcloud iam service-accounts undelete [UID]` (UID is in the error message).
2.  Ensure Cloud Build and Compute Engine APIs are enabled.
