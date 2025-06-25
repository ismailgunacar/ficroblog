#!/bin/bash

# MongoDB Atlas Connection Troubleshooting Script for Ubuntu Server
# Run this on your Ubuntu server to diagnose connection issues

echo "🔍 MongoDB Atlas Connection Diagnostics"
echo "========================================"

# 1. Check server's public IP
echo ""
echo "1️⃣  Checking server's public IP address..."
PUBLIC_IP=$(curl -s ifconfig.me || curl -s ipinfo.io/ip || echo "Could not detect")
echo "   Public IP: $PUBLIC_IP"

# 2. Test DNS resolution for MongoDB Atlas
echo ""
echo "2️⃣  Testing DNS resolution for MongoDB Atlas..."
nslookup cluster0.isg22.mongodb.net
dig cluster0.isg22.mongodb.net

# 3. Test network connectivity to MongoDB Atlas
echo ""
echo "3️⃣  Testing network connectivity to MongoDB Atlas..."
echo "   Testing port 27017..."
nc -zv cluster0.isg22.mongodb.net 27017
echo "   Testing HTTPS (443) as fallback..."
nc -zv cluster0.isg22.mongodb.net 443

# 4. Check if MongoDB client tools are available
echo ""
echo "4️⃣  Checking MongoDB client availability..."
if command -v mongosh &> /dev/null; then
    echo "   ✅ mongosh is available"
else
    echo "   ❌ mongosh not found"
    echo "   Install with: wget -qO - https://www.mongodb.org/static/pgp/server-6.0.asc | sudo apt-key add -"
    echo "                echo 'deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu focal/mongodb-org/6.0 multiverse' | sudo tee /etc/apt/sources.list.d/mongodb-org-6.0.list"
    echo "                sudo apt-get update && sudo apt-get install -y mongodb-mongosh"
fi

# 5. Check firewall settings
echo ""
echo "5️⃣  Checking firewall settings..."
if command -v ufw &> /dev/null; then
    echo "   UFW status:"
    sudo ufw status
else
    echo "   UFW not found, checking iptables..."
    sudo iptables -L OUTPUT | grep -E "(27017|443|53)"
fi

# 6. Test MongoDB connection with environment variables
echo ""
echo "6️⃣  Testing MongoDB connection with your credentials..."
if [ -f ".env" ]; then
    source .env
    if [ ! -z "$MONGODB_URI" ]; then
        echo "   Environment file found, testing connection..."
        # Extract just the host for testing
        HOST=$(echo $MONGODB_URI | sed 's/.*@\([^\/]*\)\/.*/\1/')
        echo "   Testing connection to: $HOST"
        mongosh "$MONGODB_URI" --eval "db.adminCommand('ping')" 2>/dev/null || echo "   ❌ Connection failed"
    else
        echo "   ❌ MONGODB_URI not found in .env file"
    fi
else
    echo "   ⚠️  .env file not found"
fi

echo ""
echo "🎯 Common Solutions:"
echo "==================="
echo "1. Add your server's IP ($PUBLIC_IP) to MongoDB Atlas Network Access:"
echo "   - Go to MongoDB Atlas Dashboard"
echo "   - Navigate to Network Access"
echo "   - Click 'Add IP Address'"
echo "   - Add: $PUBLIC_IP/32"
echo ""
echo "2. If using dynamic IP, add 0.0.0.0/0 (allow from anywhere) temporarily"
echo ""
echo "3. Check MongoDB Atlas user permissions:"
echo "   - Ensure user has readWrite permissions on 'marco3' database"
echo "   - Verify username/password in connection string"
echo ""
echo "4. Ensure outbound connections are allowed on ports 27017 and 443"
echo ""
echo "5. If behind NAT/proxy, you may need to configure additional networking"
