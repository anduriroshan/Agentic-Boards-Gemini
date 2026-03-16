# Deployment Workflow

Detailed flow of building, containerizing, and deploying the application.

## Docker Build (Multi-Stage)

```mermaid
flowchart TD
    subgraph Stage1["Stage 1: Frontend Builder"]
        Node["node:20-alpine"]
        --> CopyFE["COPY frontend/<br/>package.json + source"]
        --> NPMInstall["npm ci<br/>(install dependencies)"]
        --> ViteBuild["npm run build<br/>(Vite production build)"]
        --> FEDist["Output:<br/>/app/frontend/dist/"]
    end

    subgraph Stage2["Stage 2: Backend + Serve"]
        Python["python:3.12-slim"]
        --> InstallUV["Install uv<br/>(fast Python package manager)"]
        --> CopyBE["COPY backend/<br/>pyproject.toml + source"]
        --> UVInstall["uv pip install<br/>(Python dependencies)"]
        --> CopyDist["COPY --from=stage1<br/>frontend/dist → frontend_dist/"]
        --> Expose["EXPOSE 8000"]
        --> CMD["CMD: uvicorn src.main:app<br/>--host 0.0.0.0 --port 8000"]
    end

    Stage1 --> Stage2

    style Stage1 fill:#89b4fa
    style Stage2 fill:#a6e3a1
```

## Docker Compose (Local Development)

```mermaid
flowchart TD
    DockerCompose["docker-compose.yml"]

    DockerCompose --> AppService["Service: app"]

    AppService --> Build["build: .<br/>(uses Dockerfile)"]
    AppService --> Ports["ports:<br/>${PORT:-8001}:8000"]
    AppService --> EnvFile["env_file:<br/>./backend/.env"]

    subgraph Volumes["Volume Mounts"]
        V1["./data:/app/data<br/>(SQLite DB + Milvus)"]
        V2["./backend/service_account.json<br/>:/app/service_account.json"]
    end

    AppService --> Volumes

    subgraph DataPersistence["Persisted Data"]
        DB["agentic_bi.db<br/>(SQLite)"]
        MilvusDB["milvus_data.db<br/>(Vector embeddings)"]
    end

    V1 --> DataPersistence
```

## GCP Cloud Run Deployment

```mermaid
flowchart TD
    Trigger["Push to GitHub<br/>(or manual deploy)"]
    --> CloudBuild["Cloud Build<br/>(cloudbuild.yaml)"]

    subgraph BuildPhase["Build Phase"]
        DockerBuild["docker build<br/>--tag gcr.io/PROJECT/agentic-boards"]
        --> Push["Push to<br/>Artifact Registry"]
    end

    CloudBuild --> BuildPhase

    subgraph DeployPhase["Deploy Phase"]
        Push --> CloudRun["gcloud run deploy"]

        CloudRun --> Config["Configuration:"]

        Config --> C1["--memory 1Gi<br/>--cpu 1"]
        Config --> C2["--port 8000"]
        Config --> C3["--allow-unauthenticated"]
        Config --> C4["--set-env-vars<br/>(from .env)"]
        Config --> C5["--add-volume<br/>(GCS FUSE mount)"]
        Config --> C6["--add-volume-mount<br/>/app/data → GCS bucket"]
    end

    subgraph GCSPersistence["GCS Persistence"]
        Bucket["GCS Bucket:<br/>PROJECT_ID-data"]
        --> FUSE["GCS FUSE mount<br/>at /app/data"]
        --> PersistDB["SQLite + Milvus<br/>persisted across deploys"]
    end

    DeployPhase --> GCSPersistence

    subgraph DNS["DNS & Domain"]
        CloudRun --> CloudflareAPI["Cloudflare DNS<br/>CNAME → Cloud Run URL"]
        CloudflareAPI --> CustomDomain["Custom domain<br/>(e.g., app.example.com)"]
    end
```

## deploy-gcp.sh Script Flow

```mermaid
flowchart TD
    Start["./deploy-gcp.sh"]
    --> LoadEnv["Load .env variables"]
    --> CheckGCloud["Verify gcloud CLI<br/>authenticated"]

    CheckGCloud --> EnableAPIs["Enable GCP APIs:<br/>- Cloud Run<br/>- Cloud Build<br/>- Artifact Registry"]

    EnableAPIs --> CreateBucket{"GCS bucket<br/>exists?"}
    CreateBucket -->|"No"| MakeBucket["gsutil mb<br/>gs://PROJECT-data"]
    CreateBucket -->|"Yes"| Skip1["Skip"]

    MakeBucket --> CreateRepo
    Skip1 --> CreateRepo

    CreateRepo["Create Artifact Registry<br/>Docker repository"]
    --> SubmitBuild["gcloud builds submit<br/>(Cloud Build)"]
    --> DeployRun["gcloud run deploy<br/>with GCS volume mount"]
    --> MapDomain["Map custom domain<br/>(optional Cloudflare DNS)"]
    --> Output["Output:<br/>Service URL + Custom Domain"]
```

## Environment Configuration

```mermaid
flowchart LR
    subgraph Required["Required Variables"]
        R1["LLM_MODE<br/>(gemini | openai)"]
        R2["GEMINI_API_KEY or<br/>GCP_PROJECT_ID"]
        R3["GOOGLE_CLIENT_ID<br/>+ CLIENT_SECRET"]
        R4["SESSION_SECRET"]
        R5["FRONTEND_URL"]
    end

    subgraph DataSource["Data Source (at least one)"]
        DS1["BIGQUERY_PROJECT_ID<br/>+ DEFAULT_TABLE"]
        DS2["DATABRICKS_HOST<br/>+ TOKEN + HTTP_PATH"]
    end

    subgraph Optional["Optional"]
        O1["MILVUS_ENABLED<br/>+ MILVUS_URI"]
        O2["DATABRICKS_INDEX_TABLES"]
        O3["DATABASE_URL<br/>(default: SQLite)"]
        O4["OPENAI_API_KEY<br/>(if openai mode)"]
    end

    subgraph Deployment["Deployment-Specific"]
        D1["PORT<br/>(default: 8001)"]
        D2["GCP_REGION<br/>(default: us-central1)"]
        D3["GOOGLE_REDIRECT_URI"]
        D4["GOOGLE_APPLICATION_CREDENTIALS"]
    end
```

## CI/CD Pipeline (Cloud Build)

```mermaid
flowchart TD
    GitPush["Git push to<br/>repository"]
    --> Trigger["Cloud Build<br/>trigger fires"]

    subgraph Pipeline["cloudbuild.yaml Steps"]
        Step1["Step 1: Docker Build<br/>gcr.io/$PROJECT_ID/agentic-boards"]
        --> Step2["Step 2: Docker Push<br/>to Artifact Registry"]
        --> Step3["Step 3: Deploy<br/>to Cloud Run"]
    end

    Trigger --> Pipeline

    Step3 --> Live["Application live<br/>at Cloud Run URL"]

    subgraph Rollback["If issues"]
        Live -->|"Error detected"| PrevRevision["gcloud run services<br/>update-traffic<br/>--to-revisions=PREVIOUS=100"]
    end
```

## Infrastructure Diagram

```mermaid
flowchart TB
    subgraph Internet["Internet"]
        User["User Browser"]
    end

    subgraph Cloudflare["Cloudflare"]
        DNS["DNS CNAME"]
    end

    subgraph GCP["Google Cloud Platform"]
        subgraph CloudRun["Cloud Run"]
            Container["Docker Container<br/>(FastAPI + React SPA)"]
        end

        subgraph Storage["Storage"]
            GCS["GCS Bucket<br/>(/app/data via FUSE)"]
            AR["Artifact Registry<br/>(Docker images)"]
        end

        subgraph AI["AI Services"]
            VertexAI["Vertex AI<br/>(Gemini LLM)"]
            BQ["BigQuery<br/>(Data Warehouse)"]
        end

        subgraph Build["CI/CD"]
            CB["Cloud Build"]
        end
    end

    subgraph External["External Services"]
        GoogleAuth["Google OAuth 2.0"]
        DatabricksExt["Databricks<br/>(SQL Warehouse)"]
        ZillizCloud["Zilliz Cloud<br/>(Milvus, optional)"]
    end

    User --> DNS
    DNS --> Container
    Container --> GCS
    Container --> VertexAI
    Container --> BQ
    Container --> GoogleAuth
    Container --> DatabricksExt
    Container --> ZillizCloud
    CB --> AR
    AR --> Container
```
