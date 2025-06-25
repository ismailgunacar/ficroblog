#!/bin/bash

# Quick MongoDB Atlas IP Whitelist Helper
# Run this on your Ubuntu server to get the exact IP to add to Atlas

echo "🔍 MongoDB Atlas IP Whitelist Helper"
echo "==================================="

# Get public IP
echo "📍 Getting your server's public IP..."
PUBLIC_IP=$(curl -s ifconfig.me 2>/dev/null || curl -s ipinfo.io/ip 2>/dev/null || echo "Could not detect")

if [ "$PUBLIC_IP" = "Could not detect" ]; then
    echo "❌ Could not detect public IP address"
    echo "   Try manually checking with: curl ifconfig.me"
    exit 1
fi

echo "✅ Your server's public IP: $PUBLIC_IP"
echo ""

echo "🎯 ADD THIS TO MONGODB ATLAS:"
echo "=============================="
echo "IP Address: $PUBLIC_IP/32"
echo "Description: Ubuntu Server - $(hostname)"
echo ""

echo "📋 Steps to add IP to MongoDB Atlas:"
echo "1. Go to https://cloud.mongodb.com"
echo "2. Select your project and cluster"
echo "3. Click 'Network Access' in the left sidebar"
echo "4. Click 'Add IP Address' button"
echo "5. Enter: $PUBLIC_IP/32"
echo "6. Add description: Ubuntu Server - $(hostname)"
echo "7. Click 'Confirm'"
echo ""

echo "⏱️  Note: It may take a few minutes for the IP whitelist to become active"
echo ""

# Test if we can reach MongoDB Atlas
echo "🔄 Testing connectivity to MongoDB Atlas..."
if nc -zv cluster0.isg22.mongodb.net 27017 2>&1 | grep -q "succeeded\|open"; then
    echo "✅ Can reach MongoDB Atlas on port 27017"
else
    echo "❌ Cannot reach MongoDB Atlas on port 27017"
    echo "   This could be due to:"
    echo "   - IP not whitelisted yet"
    echo "   - Firewall blocking outbound connections"
    echo "   - Network configuration issues"
fi

echo ""
echo "🔧 To test after adding IP, run your app with:"
echo "   npm run prod"
