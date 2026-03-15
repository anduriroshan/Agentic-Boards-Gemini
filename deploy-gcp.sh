#!/bin/bash
set -euo pipefail

# Configuration
# Default values if environment variables are not set
GCP_PROJECT_ID=${GCP_PROJECT_ID:-$(gcloud config get-value project)}
GCP_REGION=${GCP_REGION:-"us-central1"}
SERVICE_NAME="agentic-boards"
# 1. Parse backend/.env into gcloud format
echo "📝 Parsing environment variables from backend/.env..."
# More robust parsing: ignore comments/empty lines, handle quotes, join with commas
# ALSO: filter out GOOGLE_APPLICATION_CREDENTIALS so Cloud Run uses its default ADC
ENV_VARS=$(grep -v '^#' backend/.env | grep -v '^$' | grep '=' | grep -v 'GOOGLE_APPLICATION_CREDENTIALS' | sed 's/"//g' | sed "s/'//g" | paste -sd "," -)

# Load specifically for script use (Cloudflare/Domain)
source <(grep -E '^(CLOUDFLARE|DOMAIN_NAME)' backend/.env | sed 's/"//g' | sed "s/'//g" || true)

# 2. Ensure Artifact Registry exists
REPO_NAME="app-repo"
echo "📦 Ensuring Artifact Registry exists..."
gcloud artifacts repositories create ${REPO_NAME} \
    --repository-format=docker \
    --location=${GCP_REGION} \
    --description="Docker repository for Agentic Boards" 2>/dev/null || true

# 3. Persistence: Ensure GCS Bucket exists for SQLite
BUCKET_NAME="${GCP_PROJECT_ID}-data"
echo "🗄️ Checking persistence bucket: gs://${BUCKET_NAME}"
gcloud storage buckets create gs://${BUCKET_NAME} --location=${GCP_REGION} 2>/dev/null || true

# 4. Build and Deploy in one step using --source
echo "🚀 Building and deploying to Cloud Run (this handles containerization)..."
# Extract custom service account if provided in .env
CUSTOM_SA=$(grep '^GCP_SERVICE_ACCOUNT=' backend/.env | cut -d '=' -f 2 || true)
SA_FLAG=""
if [ -n "$CUSTOM_SA" ]; then
    SA_FLAG="--service-account=${CUSTOM_SA}"
    echo "🔑 Using custom service account: ${CUSTOM_SA}"
fi

gcloud run deploy ${SERVICE_NAME} \
  --source . \
  --platform managed \
  --region ${GCP_REGION} \
  --allow-unauthenticated \
  --memory 2Gi \
  --cpu 2 \
  --cpu-boost \
  ${SA_FLAG} \
  --add-volume=name=app-data,type=cloud-storage,bucket=${BUCKET_NAME} \
  --add-volume-mount=volume=app-data,mount-path=/app/data \
  --set-env-vars="${ENV_VARS}"

# 5. DNS Automation (Optional)
if [ -n "${CLOUDFLARE_API_TOKEN:-}" ] && [ -n "${DOMAIN_NAME:-}" ] && [ -n "${CLOUDFLARE_ZONE_ID:-}" ]; then
    echo "🌐 Automating DNS for ${DOMAIN_NAME}..."
    
    # Create domain mapping if it doesn't exist
    gcloud beta run domain-mappings create --service ${SERVICE_NAME} --domain ${DOMAIN_NAME} --region ${GCP_REGION} 2>/dev/null || true
    
    TARGET="ghs.googlehosted.com"
    
    echo "🌍 Updating Cloudflare DNS record..."
    RESPONSE=$(curl -s -X GET "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records?name=${DOMAIN_NAME}&type=CNAME" \
        -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
        -H "Content-Type: application/json")
    
    RECORD_ID=$(echo $RESPONSE | python3 -c "import sys, json; data=json.load(sys.stdin); res=data.get('result', []); print(res[0]['id'] if res else 'null')")

    if [ "$RECORD_ID" != "null" ] && [ -n "$RECORD_ID" ]; then
        curl -s -X PUT "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records/${RECORD_ID}" \
            -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
            -H "Content-Type: application/json" \
            --data "{\"type\":\"CNAME\",\"name\":\"${DOMAIN_NAME}\",\"content\":\"${TARGET}\",\"proxied\":true}" > /dev/null
    else
        curl -s -X POST "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records" \
            -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
            -H "Content-Type: application/json" \
            --data "{\"type\":\"CNAME\",\"name\":\"@\",\"content\":\"${TARGET}\",\"proxied\":true}" > /dev/null
    fi
    echo "✨ DNS record updated on Cloudflare (Proxied)!"
fi

echo "✅ Deployment complete!"
gcloud run services describe ${SERVICE_NAME} --region ${GCP_REGION} --format='value(status.url)'
