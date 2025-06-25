# MongoDB Atlas Deployment Guide for Ubuntu Server

This guide helps you resolve MongoDB authentication errors when deploying Marco3 on an Ubuntu server.

## 🚨 Common Issue: Authentication Failed

When you see errors like:
```
MongoServerError: Authentication failed
```

This is usually caused by **IP address restrictions** in MongoDB Atlas, not credential issues.

## 🔧 Step-by-Step Solution

### 1. Find Your Ubuntu Server's Public IP

```bash
curl ifconfig.me
# or
curl ipinfo.io/ip
```

### 2. Add IP to MongoDB Atlas Network Access

1. Go to [MongoDB Atlas Dashboard](https://cloud.mongodb.com)
2. Navigate to your cluster
3. Click **"Network Access"** in the left sidebar
4. Click **"Add IP Address"**
5. Add your server's IP address with `/32` suffix
   - Example: `203.0.113.123/32`
6. Click **"Confirm"**

### 3. Alternative: Allow All IPs (Testing Only)

For testing purposes, you can temporarily allow all IPs:
- Add IP: `0.0.0.0/0`
- ⚠️ **Remove this after testing for security!**

### 4. Verify Database User Permissions

1. In MongoDB Atlas, go to **"Database Access"**
2. Ensure your user (`igunacar`) has:
   - **Role**: `readWrite` on `marco3` database
   - **Authentication Method**: Password

### 5. Test Connection on Ubuntu Server

Copy these files to your Ubuntu server and run:

```bash
# Make diagnostic script executable
chmod +x diagnose-mongodb.sh

# Run diagnostics
./diagnose-mongodb.sh

# Test with Node.js (if you have Node.js installed)
node test-mongodb-connection.js
```

## 🛠️ Deployment Checklist

- [ ] Server's public IP added to MongoDB Atlas Network Access
- [ ] Database user exists with proper permissions
- [ ] Environment variables (`.env` file) copied to server
- [ ] Outbound port 27017 allowed in server firewall
- [ ] DNS resolution working for `cluster0.isg22.mongodb.net`

## 🔥 Quick Fix Commands

Run these on your Ubuntu server:

```bash
# Test network connectivity
nc -zv cluster0.isg22.mongodb.net 27017

# Test DNS resolution
nslookup cluster0.isg22.mongodb.net

# Check your public IP
curl ifconfig.me

# Test firewall (if using UFW)
sudo ufw status
```

## 🌐 Environment Variables

Ensure your `.env` file on the Ubuntu server contains:

```env
MONGODB_URI=mongodb+srv://igunacar:fbVBpdpDuyTHxB5t@cluster0.isg22.mongodb.net/marco3?retryWrites=true&w=majority&appName=Cluster0
JWT_SECRET=your-secret-key-for-development
NODE_ENV=production
```

## 🔍 Troubleshooting Network Issues

### If DNS resolution fails:
```bash
# Add Google DNS
echo "nameserver 8.8.8.8" | sudo tee -a /etc/resolv.conf
```

### If firewall blocks connections:
```bash
# Allow outbound on port 27017 (UFW)
sudo ufw allow out 27017

# Allow outbound on port 443 (HTTPS fallback)
sudo ufw allow out 443
```

### If using Docker:
Make sure Docker container can access external networks:
```bash
docker run --network host your-app
```

## 🚀 Production Deployment

1. **Set NODE_ENV**: `NODE_ENV=production`
2. **Use PM2 or systemd**: Keep the app running
3. **Nginx reverse proxy**: For production traffic
4. **SSL certificate**: Use Let's Encrypt
5. **Firewall**: Only allow necessary ports

## 📞 Still Having Issues?

1. Check MongoDB Atlas status page
2. Verify your server can reach the internet
3. Try connecting from a different IP address
4. Contact your hosting provider about outbound restrictions

## ⚡ Quick Start Commands

```bash
# Clone your project
git clone <your-repo>
cd ficroblog

# Install dependencies
npm install

# Copy environment file
cp .env.example .env
# Edit .env with your credentials

# Add server IP to MongoDB Atlas Network Access

# Start the application
npm run prod
```

The most common cause is the IP restriction - make sure your Ubuntu server's public IP is whitelisted in MongoDB Atlas!
