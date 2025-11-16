/**
 * Dynamic PI Discovery and Registration Service
 * Allows automatic discovery of Pis on Tailscale network
 */

const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

class PIDiscovery {
  constructor() {
    this.pis = new Map();
    this.configPath = path.join(__dirname, 'pis.json');
    this.tailscaleNetwork = process.env.TAILSCALE_NETWORK_RANGE || '100.';
    this.scanInterval = process.env.SCAN_INTERVAL || 30000; // 30 seconds
    this.loadPIs();
  }

  async loadPIs() {
    try {
      const data = await fs.readFile(this.configPath, 'utf8');
      const config = JSON.parse(data);
      this.pis = new Map(Object.entries(config.pis || {}));
      console.log(`Loaded ${this.pis.size} Pis from config`);
    } catch (error) {
      console.log('No existing PI config found, starting fresh');
      this.pis = new Map();
    }
  }

  async savePIs() {
    const config = {
      pis: Object.fromEntries(this.pis),
      lastUpdated: new Date().toISOString()
    };
    await fs.writeFile(this.configPath, JSON.stringify(config, null, 2));
  }

  async discoverPis() {
    console.log('Scanning for Pis on Tailscale network...');
    
    // For now, we'll use a simple approach - check known IP ranges
    // In production, you might use Tailscale API or mDNS discovery
    const potentialIPs = [
      '100.104.127.38',  // Known PI 1
      '100.114.175.61',  // Known PI 2
      // Add more as needed
    ];

    const discovered = [];
    
    for (const ip of potentialIPs) {
      try {
        const response = await axios.get(`http://${ip}:5000/api/health`, {
          timeout: 3000,
          headers: { 'User-Agent': 'PI-Discovery/1.0' }
        });
        
        if (response.data.success) {
          const piInfo = {
            id: `pi-${ip.replace(/\./g, '-')}`,
            ip: ip,
            name: response.data.hostname || `Music Player ${this.pis.size + 1}`,
            status: 'online',
            lastSeen: new Date().toISOString(),
            version: response.data.version || 'unknown',
            storage: response.data.storage || {},
            uptime: response.data.uptime || 0
          };

          this.pis.set(piInfo.id, piInfo);
          discovered.push(piInfo);
          console.log(`✅ Discovered PI: ${piInfo.name} at ${ip}`);
        }
      } catch (error) {
        // Check if this PI was previously known
        const existingPI = Array.from(this.pis.values()).find(pi => pi.ip === ip);
        if (existingPI && existingPI.status === 'online') {
          existingPI.status = 'offline';
          existingPI.lastSeen = new Date().toISOString();
          console.log(`❌ PI went offline: ${existingPI.name} at ${ip}`);
        }
      }
    }

    if (discovered.length > 0) {
      await this.savePIs();
    }

    return discovered;
  }

  async registerPI(piData) {
    const pi = {
      id: piData.id || `pi-${piData.ip.replace(/\./g, '-')}`,
      ip: piData.ip,
      name: piData.name || `Music Player ${this.pis.size + 1}`,
      location: piData.location || 'Unknown',
      description: piData.description || '',
      status: 'pending',
      addedAt: new Date().toISOString(),
      lastSeen: new Date().toISOString()
    };

    this.pis.set(pi.id, pi);
    await this.savePIs();
    
    console.log(`📝 Registered new PI: ${pi.name} (${pi.ip})`);
    return pi;
  }

  async removePI(piId) {
    if (this.pis.has(piId)) {
      const pi = this.pis.get(piId);
      this.pis.delete(piId);
      await this.savePIs();
      console.log(`🗑️ Removed PI: ${pi.name}`);
      return true;
    }
    return false;
  }

  async updatePIStatus(piId, status) {
    const pi = this.pis.get(piId);
    if (pi) {
      pi.status = status;
      pi.lastSeen = new Date().toISOString();
      await this.savePIs();
      return pi;
    }
    return null;
  }

  getAllPIs() {
    return Array.from(this.pis.values());
  }

  getOnlinePIs() {
    return Array.from(this.pis.values()).filter(pi => pi.status === 'online');
  }

  getPI(piId) {
    return this.pis.get(piId);
  }

  async healthCheck() {
    const results = [];
    
    for (const [piId, pi] of this.pis) {
      try {
        const response = await axios.get(`http://${pi.ip}:5000/api/health`, {
          timeout: 5000
        });
        
        results.push({
          piId,
          ip: pi.ip,
          name: pi.name,
          status: 'online',
          response: response.data,
          checkTime: new Date().toISOString()
        });
        
        // Update PI status
        await this.updatePIStatus(piId, 'online');
      } catch (error) {
        results.push({
          piId,
          ip: pi.ip,
          name: pi.name,
          status: 'offline',
          error: error.message,
          checkTime: new Date().toISOString()
        });
        
        // Update PI status
        await this.updatePIStatus(piId, 'offline');
      }
    }
    
    return results;
  }

  startAutoDiscovery() {
    console.log('🔍 Starting automatic PI discovery...');
    
    // Initial discovery
    this.discoverPis();
    
    // Set up recurring discovery
    this.discoveryInterval = setInterval(() => {
      this.discoverPis();
    }, this.scanInterval);
    
    // Set up health checks
    this.healthInterval = setInterval(() => {
      this.healthCheck();
    }, this.scanInterval * 2); // Health checks less frequently
  }

  stopAutoDiscovery() {
    if (this.discoveryInterval) {
      clearInterval(this.discoveryInterval);
    }
    if (this.healthInterval) {
      clearInterval(this.healthInterval);
    }
    console.log('⏹️ Stopped automatic PI discovery');
  }
}

module.exports = PIDiscovery;
