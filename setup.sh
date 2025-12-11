#!/bin/bash

# EC2 Proxy Setup Script
# This script sets up the music player proxy server on EC2

set -e

echo "🎵 Setting up Music Player EC2 Proxy..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    echo "   Visit: https://nodejs.org/"
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js version 18+ is required. Current version: $(node -v)"
    exit 1
fi

echo "✅ Node.js $(node -v) detected"

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Create logs directory
mkdir -p logs

# Copy environment file if it doesn't exist
if [ ! -f .env ]; then
    echo "📝 Creating .env file from example..."
    cp .env.example .env
    echo "⚠️  Please edit .env file with your configuration:"
    echo "   - Set JWT_SECRET to a secure random string"
    echo "   - Update PI_IPS with your Raspberry Pi Tailscale IPs"
    echo "   - Set ALLOWED_ORIGINS to your frontend URL"
    echo "   - Change ADMIN_PASSWORD to a secure password"
else
    echo "✅ .env file already exists"
fi

# Check if Tailscale is installed
if command -v tailscale &> /dev/null; then
    echo "✅ Tailscale detected"
    echo "📡 Current Tailscale status:"
    tailscale status --peers=false || echo "   (Not connected or no permission to view status)"
else
    echo "⚠️  Tailscale not detected. Install it for Pi discovery:"
    echo "   curl -fsSL https://tailscale.com/install.sh | sh"
fi

# Create systemd service file
echo "🔧 Creating systemd service..."
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

# Reload systemd and enable service
sudo systemctl daemon-reload
sudo systemctl enable music-proxy

echo ""
echo "🎉 Setup complete!"
echo ""
echo "Next steps:"
echo "1. Edit .env file with your configuration:"
echo "   nano .env"
echo ""
echo "2. Start the service:"
echo "   sudo systemctl start music-proxy"
echo ""
echo "3. Check service status:"
echo "   sudo systemctl status music-proxy"
echo ""
echo "4. View logs:"
echo "   sudo journalctl -u music-proxy -f"
echo ""
echo "5. Test the server:"
echo "   curl http://localhost:3001/health"
echo ""
echo "📋 Service commands:"
echo "   Start:   sudo systemctl start music-proxy"
echo "   Stop:    sudo systemctl stop music-proxy"
echo "   Restart: sudo systemctl restart music-proxy"
echo "   Status:  sudo systemctl status music-proxy"
echo "   Logs:    sudo journalctl -u music-proxy -f"