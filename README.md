# EC2 Proxy Gateway Setup

This EC2 instance acts as a bridge between your Vercel frontend (public internet) and your Raspberry Pis (Tailscale network).

## Architecture

```
Internet Users (No Tailscale needed!)
        ↓
Vercel Frontend (Public)
        ↓
    HTTPS/WSS
        ↓
EC2 Proxy Server (Public IP + Tailscale)
        ↓
Tailscale Network
        ↓
Raspberry Pis (100.104.127.38, 100.114.175.61)
```

## What This Does

The EC2 instance:
1. Has a public IP address (accessible from internet)
2. Is connected to Tailscale network (can reach your Pis)
3. Runs a proxy server that forwards requests from Vercel to your Pis
4. Handles WebSocket connections for real-time updates

## Benefits

✅ No Tailscale needed on user devices
✅ Access from anywhere, any device
✅ Share with anyone (no VPN setup required)
✅ Still secure (EC2 ↔ Pi traffic encrypted via Tailscale)

## Setup Instructions

### 1. Launch EC2 Instance

**Recommended Specs:**
- Instance Type: `t3.micro` or `t4g.micro` (Free tier eligible)
- OS: Ubuntu 22.04 LTS
- Storage: 8GB (default)
- Security Group: Allow ports 80, 443, 3001

**Cost**: ~$3-7/month (or free for 12 months with AWS free tier)

### 2. Connect to EC2

```bash
ssh -i your-key.pem ubuntu@your-ec2-public-ip
```

### 3. Install Tailscale on EC2

```bash
# Install Tailscale
curl -fsSL https://tailscale.com/install.sh | sh

# Start Tailscale
sudo tailscale up

# Verify connection to Pis
ping 100.104.127.38
ping 100.114.175.61
```

### 4. Install Node.js

```bash
# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify
node --version
npm --version
```

### 5. Setup Proxy Server

```bash
# Create directory
mkdir -p /home/ubuntu/music-proxy
cd /home/ubuntu/music-proxy

# Copy files (from your computer)
# scp -i your-key.pem -r ec2-proxy/* ubuntu@your-ec2-ip:/home/ubuntu/music-proxy/
```

### 6. Install Dependencies

```bash
cd /home/ubuntu/music-proxy
npm install
```

### 7. Configure Environment

```bash
nano .env
```

Add:
```bash
PORT=3001
PI1_IP=100.104.127.38
PI2_IP=100.114.175.61
PI_API_PORT=5000
ALLOWED_ORIGINS=https://your-vercel-app.vercel.app
```

### 8. Setup SSL (Optional but Recommended)

```bash
# Install Certbot
sudo apt install certbot

# Get SSL certificate (requires domain name)
sudo certbot certonly --standalone -d your-domain.com

# Certificates will be at:
# /etc/letsencrypt/live/your-domain.com/fullchain.pem
# /etc/letsencrypt/live/your-domain.com/privkey.pem
```

### 9. Create Systemd Service

```bash
sudo nano /etc/systemd/system/music-proxy.service
```

Add:
```ini
[Unit]
Description=Music Player Proxy Service
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/music-proxy
Environment="NODE_ENV=production"
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

### 10. Start Service

```bash
# Reload systemd
sudo systemctl daemon-reload

# Enable service
sudo systemctl enable music-proxy.service

# Start service
sudo systemctl start music-proxy.service

# Check status
sudo systemctl status music-proxy.service
```

### 11. Configure Security Group

In AWS Console:
1. Go to EC2 → Security Groups
2. Edit inbound rules:
   - Port 80 (HTTP): 0.0.0.0/0
   - Port 443 (HTTPS): 0.0.0.0/0
   - Port 3001 (Proxy): 0.0.0.0/0

### 12. Test Proxy

```bash
# From your computer
curl http://your-ec2-public-ip:3001/health

# Should return:
# {"status":"healthy","timestamp":"..."}
```

## Update Frontend Configuration

Update your Vercel environment variables:

```bash
# Instead of Pi IPs, use EC2 proxy
NEXT_PUBLIC_PROXY_URL=http://your-ec2-public-ip:3001
# Or with domain:
NEXT_PUBLIC_PROXY_URL=https://your-domain.com
```

## API Endpoints

The proxy exposes these endpoints:

- `GET /health` - Proxy health check
- `GET /api/pi1/status` - Pi 1 status
- `GET /api/pi2/status` - Pi 2 status
- `POST /api/pi1/control` - Control Pi 1
- `POST /api/pi2/control` - Control Pi 2
- `GET /api/pi1/stats` - Pi 1 statistics
- `GET /api/pi2/stats` - Pi 2 statistics

## Monitoring

```bash
# View logs
sudo journalctl -u music-proxy.service -f

# Check service status
sudo systemctl status music-proxy.service

# Restart service
sudo systemctl restart music-proxy.service
```

## Security Considerations

1. **CORS**: Only allow your Vercel domain
2. **Rate Limiting**: Implemented in proxy (100 req/15min per IP)
3. **SSL**: Use HTTPS in production
4. **Firewall**: Only open necessary ports
5. **Updates**: Keep system updated

## Cost Optimization

**Free Tier (12 months):**
- t3.micro: 750 hours/month free
- Data transfer: 15GB/month free

**After Free Tier:**
- t3.micro: ~$7/month
- t4g.micro: ~$5/month (ARM-based, cheaper)
- Data transfer: ~$0.09/GB

**Estimated Monthly Cost**: $5-10/month

## Troubleshooting

### Can't reach Pis from EC2

```bash
# Check Tailscale status
sudo tailscale status

# Ping Pis
ping 100.104.127.38
ping 100.114.175.61

# Check if Pi services are running
curl http://100.104.127.38:5000/api/status
```

### Proxy not responding

```bash
# Check service
sudo systemctl status music-proxy.service

# Check logs
sudo journalctl -u music-proxy.service -n 50

# Check if port is listening
sudo netstat -tulpn | grep 3001
```

### CORS errors

```bash
# Update .env with correct Vercel URL
nano /home/ubuntu/music-proxy/.env

# Restart service
sudo systemctl restart music-proxy.service
```

## Maintenance

### Update Proxy Code

```bash
# Stop service
sudo systemctl stop music-proxy.service

# Update files
cd /home/ubuntu/music-proxy
# Copy new files

# Install dependencies
npm install

# Start service
sudo systemctl start music-proxy.service
```

### Renew SSL Certificate

```bash
# Certbot auto-renews, but to manually renew:
sudo certbot renew
sudo systemctl restart music-proxy.service
```

## Alternative: Use Tailscale Funnel

Tailscale has a feature called "Funnel" that can expose services publicly without EC2:

```bash
# On one of your Pis
tailscale funnel 5000
```

This gives you a public URL, but has limitations. EC2 proxy gives you more control.

## Summary

With this setup:
- ✅ Anyone can access your frontend (no Tailscale needed)
- ✅ Secure communication (EC2 ↔ Pi via Tailscale)
- ✅ Low cost (~$5-10/month)
- ✅ Full control over proxy logic
- ✅ Can add authentication, caching, etc.
