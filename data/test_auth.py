import os
import google.auth
from google.auth.transport.requests import Request

os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = "/app/service_account.json"

# Vertex AI and general Cloud Platform scopes
SCOPES = [
    "https://www.googleapis.com/auth/cloud-platform",
    "https://www.googleapis.com/auth/cloud-platform.read-only"
]

try:
    credentials, project = google.auth.default(scopes=SCOPES)
    print(f"Credentials loaded for project: {project}")
    print(f"Service Account Email: {getattr(credentials, 'service_account_email', 'N/A')}")
    
    # Try to refresh/get token
    credentials.refresh(Request())
    print("Token refresh successful!")
    print(f"Token: {credentials.token[:10]}...")
except Exception as e:
    print(f"Authentication failed: {e}")
