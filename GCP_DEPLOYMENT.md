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

## Quick Deployment

Use the provided automated script:

```bash
chmod +x deploy-gcp.sh
./deploy-gcp.sh
```

The script will:
- Build the Docker image using Cloud Build.
- Push the image to your project's Container Registry.
- Deploy a new revision to Google Cloud Run.

## Environment Variables

Cloud Run services need environment variables to function correctly. The frontend is configured to use relative paths (`/api`), so it will automatically point to the correct domain when deployed.

```bash
gcloud run services update agentic-boards \
  --set-env-vars="GEMINI_API_KEY=your_key,LLM_MODE=gemini,ALLOWED_ORIGINS=https://agentic-boards.live"
```

> [!TIP]
> For sensitive values like `DATABRICKS_TOKEN`, use **Google Cloud Secret Manager** and link them to Cloud Run.

## Custom Domain (Cloudflare)

Since you have `agentic-boards.live` on Cloudflare, follow these steps to connect it to Cloud Run:

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
