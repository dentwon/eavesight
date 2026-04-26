#!/bin/bash

# Eavesight Deployment Script

echo "Eavesight Deployment Script"
echo "============================"

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
  echo "Error: This script must be run from the Eavesight root directory"
  exit 1
fi

echo "Building frontend application..."

# Navigate to frontend directory
cd apps/frontend

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi

# Build the application
echo "Building the application..."
npm run build

if [ $? -eq 0 ]; then
  echo "Build successful!"
  
  # Try to deploy with Vercel if vercel command exists
  if command -v vercel &> /dev/null; then
    echo "Deploying to Vercel..."
    vercel --prod
  else
    echo "Vercel CLI not found. To deploy:"
    echo "1. Install Vercel CLI: npm install -g vercel"
    echo "2. Login: vercel login"
    echo "3. Deploy: vercel --prod"
  fi
else
  echo "Build failed. Please check the errors above."
  exit 1
fi