# Music Player EC2 Proxy

This is the EC2 proxy server that bridges your Vercel frontend with Raspberry Pi music players on the Tailscale network.

## Architecture

```
Frontend (Vercel) ←→ EC2 Proxy ←→ Raspberry Pi Players (Tailscale)
```

## Features

- **Authentication**: JWT-based user authentication
- **Pi Discovery**: Automatic discovery of Raspberry Pi players
- **Health Monitoring**: Real-time status monitoring of all players
- **Request Proxying**: Secure routing of control commands to Pi players
- **Admin Panel**: Management interface for Pi registration and user access
- **Rate Limiting**: Protection against abuse
- **Logging**: Comprehensive request and error logging

## Installation

### Prerequisites

- Ubuntu/Debian EC2 instance
- Node.js 18+
- Tailscale installed and connected
- Network access to Raspberry Pi players

### Quick Setup

1. **Clone and install:**
   ```bash
   cd ec2-proxy
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   nano .env
   ```

3. **Update configuration:**
   ```bash
   # Required settings in .env:
   JWT_SECRET=your-super-secret-key-min-32-chars
   ADMIN_PASSWORD=your-secure-admin-password
   PI_IPS=100.104.127.38,100.114.175.61  # Your Pi Tailscale IPs
   ALLOWED_ORIGINS=https://your-frontend.vercel.app
   ```

4. **Run setup script:**
   ```bash
   chmod +x setup.sh
   ./setup.sh
   ```

5. **Start the service:**
   ```bash
   sudo systemctl start music-proxy
   ```

### Manual Installation

1. **Install Node.js 18+:**
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
   sudo apt-get install -y nodejs
   ```

2. **Install Tailscale:**
   ```bash
   curl -fsSL https://tailscale.com/install.sh | sh
   sudo tailscale up
   ```

3. **Install dependencies:**
   ```bash
   npm install
   ```

4. **Create directories:**
   ```bash
   mkdir -p logs
   ```

5. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your settings
   ```

6. **Create systemd service:**
   ```bash
   sudo tee /etc/systemd/system/music-proxy.service > /dev/null <<EOF
   [Unit]
   Description=Music Player Proxy Server
   After=network.target

   [Service]
   Type=simple
   User=$USER
   WorkingDirectory=$(pwd)
   Environment=NODE_ENV=production
   ExecStart=$(which node) server.js
   Restart=always
   RestartSec=10
   StandardOutput=journal
   StandardError=journal

   [Install]
   WantedBy=multi-user.target
   EOF
   ```

7. **Enable and start service:**
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable music-proxy
   sudo systemctl start music-proxy
   ```

## Configuration

### Environment Variables (.env)

```bash
# Server Configuration
PORT=3001                    # Server port
NODE_ENV=production         # Environment

# Authentication
JWT_SECRET=your-secret-key  # MUST be 32+ characters
JWT_EXPIRES_IN=7d          # Token expiration
ADMIN_PASSWORD=admin123    # Admin login password

# Pi Discovery
PI_IPS=100.104.127.38,100.114.175.61  # Tailscale IPs (comma-separated)
SCAN_INTERVAL=30000        # Discovery interval (ms)
TAILSCALE_NETWORK_RANGE=100.  # Tailscale IP range

# CORS
ALLOWED_ORIGINS=https://your-app.vercel.app,http://localhost:3000

# Monitoring
LOG_LEVEL=info
MAX_LOG_SIZE=10485760
LOG_RETENTION_DAYS=7
```

### Important Settings

- **JWT_SECRET**: Must be a secure random string (32+ characters)
- **PI_IPS**: Comma-separated list of your Pi Tailscale IPs
- **ALLOWED_ORIGINS**: Your frontend URL(s) for CORS
- **ADMIN_PASSWORD**: Secure password for admin access

## API Endpoints

### Authentication
- `POST /api/auth/login` - User login
- `GET /api/auth/validate` - Token validation
- `POST /api/auth/request-access` - Request access
- `GET /api/auth/access-status` - Check request status

### Player Management
- `GET /api/players` - List all players
- `GET /api/:piId/status` - Get player status
- `POST /api/:piId/control/play` - Start playback
- `POST /api/:piId/control/stop` - Stop playback
- `POST /api/:piId/control/pause` - Pause playback
- `POST /api/:piId/control/resume` - Resume playback
- `POST /api/:piId/control/next` - Next song
- `POST /api/:piId/control/volume` - Set volume

### Admin Endpoints
- `GET /api/admin/pis` - Manage Pi players
- `POST /api/admin/pis` - Add new Pi
- `DELETE /api/admin/pis/:piId` - Remove Pi
- `POST /api/admin/discover` - Discover new Pis
- `POST /api/admin/health-check` - Check all Pi health
- `GET /api/admin/metrics` - System metrics

### System
- `GET /health` - Health check

## Service Management

```bash
# Start service
sudo systemctl start music-proxy

# Stop service
sudo systemctl stop music-proxy

# Restart service
sudo systemctl restart music-proxy

# Check status
sudo systemctl status music-proxy

# View logs
sudo journalctl -u music-proxy -f

# Enable auto-start
sudo systemctl enable music-proxy

# Disable auto-start
sudo systemctl disable music-proxy
```

## Testing

### Health Check
```bash
curl http://localhost:3001/health
```

### Login Test
```bash
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"password": "admin123"}'
```

### Pi Discovery Test
```bash
# Get auth token first, then:
curl -X POST http://localhost:3001/api/admin/discover \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## Troubleshooting

### Service Won't Start
```bash
# Check logs
sudo journalctl -u music-proxy -n 50

# Check configuration
cat .env

# Test manually
node server.js
```

### Pi Discovery Issues
```bash
# Check Tailscale connection
tailscale status

# Test Pi connectivity
curl http://PI_TAILSCALE_IP:5000/api/health

# Check Pi IPs in .env
grep PI_IPS .env
```

### Authentication Issues
```bash
# Verify JWT_SECRET is set
grep JWT_SECRET .env

# Check token expiration
# Tokens expire based on JWT_EXPIRES_IN setting

# Test login endpoint
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"password": "YOUR_ADMIN_PASSWORD"}'
```

### CORS Issues
```bash
# Check allowed origins
grep ALLOWED_ORIGINS .env

# Verify frontend URL is included
# Must match exactly (including https://)
```

## Security

### Best Practices
- Use strong JWT_SECRET (32+ random characters)
- Use secure ADMIN_PASSWORD
- Keep system updated
- Monitor access logs
- Use HTTPS in production
- Restrict EC2 security groups

### Firewall Configuration
```bash
# Allow only necessary ports
sudo ufw allow 22    # SSH
sudo ufw allow 3001  # Proxy server
sudo ufw enable
```

## Monitoring

### Logs
```bash
# Service logs
sudo journalctl -u music-proxy -f

# Application logs
tail -f logs/app.log

# Error logs
tail -f logs/error.log
```

### Metrics
Access admin metrics endpoint:
```bash
GET /api/admin/metrics
```

### Health Monitoring
Set up monitoring for:
- Service uptime
- Pi connectivity
- Response times
- Error rates

## Scaling

### Multiple EC2 Instances
- Use load balancer
- Share Pi configuration
- Implement session storage (Redis)

### High Availability
- Auto Scaling Groups
- Health checks
- Backup configurations

## Updates

```bash
# Update dependencies
npm update

# Restart service
sudo systemctl restart music-proxy

# Check for issues
sudo systemctl status music-proxy
```

## Support

For issues:
1. Check service logs: `sudo journalctl -u music-proxy -f`
2. Verify configuration: `cat .env`
3. Test connectivity: `curl http://localhost:3001/health`
4. Check Pi connectivity: Test Pi health endpoints
5. Review this documentation

## Integration

This proxy integrates with:
- **Frontend**: Next.js application on Vercel
- **Pi Players**: Python Flask applications on Raspberry Pis
- **Tailscale**: For secure networking

See `INTEGRATION_OVERVIEW.md` for complete system architecture.