#!/usr/bin/env node

// MongoDB Atlas Connection Tester for Ubuntu Server Deployment
// Run with: node test-mongodb-connection.js

import { MongoClient } from 'mongodb';
import { readFileSync } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function getPublicIP() {
  try {
    const { stdout } = await execAsync('curl -s ifconfig.me || curl -s ipinfo.io/ip');
    return stdout.trim();
  } catch (error) {
    return 'Unknown';
  }
}

async function testDNSResolution(hostname) {
  try {
    const { stdout } = await execAsync(`nslookup ${hostname}`);
    return stdout.includes('Address:');
  } catch (error) {
    return false;
  }
}

async function testPortConnectivity(host, port) {
  try {
    const { stdout, stderr } = await execAsync(`nc -zv ${host} ${port} 2>&1`);
    return stdout.includes('succeeded') || stdout.includes('open');
  } catch (error) {
    return false;
  }
}

async function loadEnvironmentVariables() {
  try {
    const envContent = readFileSync('.env', 'utf8');
    const envVars = {};
    envContent.split('\n').forEach(line => {
      const [key, ...valueParts] = line.split('=');
      if (key && valueParts.length > 0) {
        envVars[key.trim()] = valueParts.join('=').trim();
      }
    });
    return envVars;
  } catch (error) {
    console.error('❌ Could not load .env file:', error.message);
    return {};
  }
}

async function testMongoDBConnection(uri) {
  console.log('🔄 Testing MongoDB connection...');
  
  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 10000,
    socketTimeoutMS: 45000,
    tls: true,
  });

  try {
    await client.connect();
    console.log('✅ MongoDB connection successful');
    
    // Test ping
    await client.db('admin').command({ ping: 1 });
    console.log('✅ MongoDB ping successful');
    
    // Test database access
    const db = client.db('marco3');
    const collections = await db.listCollections().toArray();
    console.log('✅ Database access successful');
    console.log('📂 Collections:', collections.map(c => c.name));
    
    return true;
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
    
    if (error.message.includes('authentication failed')) {
      console.error('🔐 This is an authentication error. Check:');
      console.error('   - Username and password in connection string');
      console.error('   - Database user exists and has proper permissions');
      console.error('   - IP address is whitelisted in MongoDB Atlas');
    }
    
    if (error.message.includes('ENOTFOUND') || error.message.includes('timeout')) {
      console.error('🌐 This is a network connectivity error. Check:');
      console.error('   - Server IP is whitelisted in MongoDB Atlas Network Access');
      console.error('   - Firewall allows outbound connections on port 27017');
      console.error('   - DNS resolution is working');
    }
    
    return false;
  } finally {
    await client.close();
  }
}

async function main() {
  console.log('🚀 MongoDB Atlas Connection Diagnostics');
  console.log('=========================================');
  
  // Get server info
  const publicIP = await getPublicIP();
  console.log(`🌐 Server public IP: ${publicIP}`);
  
  // Load environment variables
  const envVars = await loadEnvironmentVariables();
  const mongoUri = envVars.MONGODB_URI || process.env.MONGODB_URI;
  
  if (!mongoUri) {
    console.error('❌ MONGODB_URI not found in environment variables or .env file');
    process.exit(1);
  }
  
  // Extract hostname from URI
  const hostname = mongoUri.match(/@([^\/]+)\//)?.[1] || 'cluster0.isg22.mongodb.net';
  console.log(`🔍 MongoDB hostname: ${hostname}`);
  
  // Test DNS resolution
  console.log('\n1️⃣  Testing DNS resolution...');
  const dnsWorks = await testDNSResolution(hostname);
  console.log(dnsWorks ? '✅ DNS resolution successful' : '❌ DNS resolution failed');
  
  // Test port connectivity
  console.log('\n2️⃣  Testing port connectivity...');
  const port27017 = await testPortConnectivity(hostname, 27017);
  const port443 = await testPortConnectivity(hostname, 443);
  console.log(`   Port 27017: ${port27017 ? '✅ Open' : '❌ Blocked'}`);
  console.log(`   Port 443: ${port443 ? '✅ Open' : '❌ Blocked'}`);
  
  // Test MongoDB connection
  console.log('\n3️⃣  Testing MongoDB connection...');
  const connectionWorks = await testMongoDBConnection(mongoUri);
  
  // Summary and recommendations
  console.log('\n📋 Summary');
  console.log('===========');
  console.log(`DNS Resolution: ${dnsWorks ? '✅' : '❌'}`);
  console.log(`Port 27017: ${port27017 ? '✅' : '❌'}`);
  console.log(`Port 443: ${port443 ? '✅' : '❌'}`);
  console.log(`MongoDB Connection: ${connectionWorks ? '✅' : '❌'}`);
  
  if (!connectionWorks) {
    console.log('\n🎯 Next Steps:');
    console.log('===============');
    console.log(`1. Add this IP to MongoDB Atlas Network Access: ${publicIP}`);
    console.log('2. Go to MongoDB Atlas → Network Access → Add IP Address');
    console.log(`3. Add: ${publicIP}/32 (or 0.0.0.0/0 for testing)`);
    console.log('4. Verify database user permissions in MongoDB Atlas');
    console.log('5. Check firewall settings on this server');
  }
}

main().catch(console.error);
