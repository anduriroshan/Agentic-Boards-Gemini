# AWS Deployment Guide (EC2 + Docker Compose)

This guide explains how to deploy Agentic Boards to an AWS EC2 instance. This setup is optimized for a single-container deployment using **Milvus Lite**, which runs on a **t3.micro** (1GB RAM) or **t3.small** (2GB RAM) instance, saving significantly on costs.

## 1. Launch an EC2 Instance

1.  Log in to the [AWS Management Console](https://console.aws.amazon.com/).
2.  Go to **EC2** -> **Instances** -> **Launch Instances**.
3.  **Name**: `Agentic-Boards-Server`
4.  **OS**: **Ubuntu 24.04 LTS** (64-bit x86).
5.  **Instance Type**: Choose **t3.micro** (Free Tier eligible) or **t3.small** for better performance.
6.  **Key Pair**: Create or select an existing `.pem` key for SSH access.
7.  **Network Settings**:
    *   Allow **SSH** (Port 22).
    *   Allow **HTTP** (Port 80) and **HTTPS** (Port 443).
    *   Allow Custom TCP **8000** (Optional, for direct testing).

## 2. Prepare the Server

Connect to your instance via SSH:
```bash
# First, fix key permissions (Required by SSH)
chmod 400 agenticboards.pem

ssh -i agenticboards.pem ubuntu@your-ec2-ip
```

Install Docker:
```bash
sudo apt-get update
sudo apt-get install -y docker.io
sudo usermod -aG docker ubuntu
# Log out and log back in for group changes to take effect
exit
```

## 3. Deploy the Application

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/your-username/Agentic-Boards.git
    cd Agentic-Boards
    ```

2.  **Configure Environment Variables**:
    Create a `.env` file in the root directory:
    ```bash
    cp .env.example .env
    nano .env
    ```
    Ensure you set:
    *   `LLM_API_KEY`: Your Gemini/OpenAI key.
    *   `MILVUS_URI`: `./milvus_data.db` (This uses Milvus Lite for FREE).

3.  **Start the container**:
    ```bash
    docker build -t agentic-boards .
    docker run -d --name app -p 8000:8000 --env-file .env agentic-boards
    ```

## 4. Setting up HTTPS (Caddy/Nginx)

The easiest way to get SSL is using **Caddy** as a reverse proxy.

1.  **Install Caddy** on the EC2 host:
    ```bash
    sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
    curl -1G 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1G 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
    sudo apt update
    sudo apt install caddy
    ```

2.  **Edit the Caddyfile**:
    ```bash
    sudo nano /etc/caddy/Caddyfile
    ```
    Replace the contents with:
    ```
    agentic-boards.live {
        reverse_proxy localhost:8000
    }
    ```

3.  **Restart Caddy**:
    ```bash
    sudo systemctl restart caddy
    ```

## Troubleshooting

*   **Memory Issues**: If Milvus fails to start, check `free -m`. You may need to add a swap file if using a smaller instance.
*   **Logs**: View combined logs with `docker-compose logs -f`.
*   **Persistence**: The current setup stores Milvus and SQLite data in files inside the container. To persist data across container recreations, you should use Docker volumes (e.g., `-v /data:/app`).
