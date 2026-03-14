#!/bin/bash

# Configuration
# Default values if environment variables are not set
GCP_PROJECT_ID=${GCP_PROJECT_ID:-$(gcloud config get-value project)}
GCP_REGION=${GCP_REGION:-"us-central1"}
SERVICE_NAME="agentic-boards"
IMAGE_TAG="gcr.io/${GCP_PROJECT_ID}/${SERVICE_NAME}:latest"

echo "🚀 Starting deployment for project: ${GCP_PROJECT_ID}"

# 1. Parse backend/.env into gcloud format (KEY=VAL,KEY2=VAL2)
echo "📝 Parsing environment variables from backend/.env..."
ENV_VARS=$(grep -v '^#' backend/.env | grep -v '^$' | xargs | sed 's/ /,/g')

# 2. Build and Push using Cloud Build
echo "📦 Building and pushing image via Cloud Build..."
gcloud builds submit --tag ${IMAGE_TAG} .

# 3. Deploy to Cloud Run
echo "☁️ Deploying to Cloud Run..."
gcloud run deploy ${SERVICE_NAME} \
  --image ${IMAGE_TAG} \
  --platform managed \
  --region ${GCP_REGION} \
  --allow-unauthenticated \
  --set-env-vars="${ENV_VARS}"

# Note: You can add more environment variables with --set-env-vars="KEY1=VAL1,KEY2=VAL2"
# or use -set-secrets="MY_TOKEN=MY_SECRET_NAME:latest" for sensitive data.

echo "✅ Deployment complete!"
gcloud run services describe ${SERVICE_NAME} --region ${GCP_REGION} --format='value(status.url)'
