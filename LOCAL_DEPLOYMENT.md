# Local Machine Hosting Guide

This guide explains how to set up **Agentic Boards** to run locally as a robust backup to your AWS deployment.

## 1. Prerequisites
- Docker & Docker Compose
- Node.js (for local development, optional)
- Python 3.11+ (for local development, optional)

## 2. Configuration for Persistence
The local setup is configured to store all critical data (SQLite & Milvus) in a `./data` directory on your host machine. This ensures that your chat history, users, and embeddings are preserved even if the container is recreated.

### Persistence Check
Ensure the `data/` directory exists in the project root:
```bash
mkdir -p data
```

## 3. Deployment
Run the stack using Docker Compose:
```bash
docker compose up -d --build
```
- `-d`: Runs in detached mode (background).
- `--build`: Rebuilds the image with your latest changes.

The application will be accessible at `http://localhost:8000`.

## 4. Automation & Reliability
### Auto-Restart
The `docker-compose.yml` is configured with `restart: always`. This means the application will start automatically when:
- The Docker daemon starts.
- The machine reboots.
- The container crashes.

### Backups
A backup script is provided to create timestamped copies of your data.
```bash
bash backup_data.sh
```
**Tip:** Add this to your crontab to run daily:
```bash
0 3 * * * cd /path/to/Agentic-Boards && bash backup_data.sh
```

## 5. Remote Access (Optional)
If you want to access your local host via your domain (`agnetic-boards.live`), we recommend using a **Cloudflare Tunnel**.

1. Install `cloudflared` on your machine.
2. Run the tunnel:
   ```bash
   cloudflared tunnel run agentic-boards
   ```
3. Point your domain to the tunnel in the Cloudflare dashboard.

## 6. Maintenance
- **View logs**: `docker compose logs -f`
- **Stop app**: `docker compose down`
- **Update app**: `git pull` followed by `docker compose up -d --build`
