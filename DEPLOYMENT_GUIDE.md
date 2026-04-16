# Eavesight Frontend Deployment Guide

## Prerequisites

1. Install Vercel CLI globally:
   ```bash
   npm install -g vercel
   ```

2. Login to Vercel:
   ```bash
   vercel login
   ```

## Deployment Steps

### Option 1: Deploy with Vercel CLI (Recommended)

1. Navigate to the frontend directory:
   ```bash
   cd apps/frontend
   ```

2. Deploy to Vercel:
   ```bash
   vercel --prod
   ```

### Option 2: Deploy using Git Integration

1. Push your changes to GitHub:
   ```bash
   git add .
   git commit -m "Prepare for deployment"
   git push origin main
   ```

2. Connect your GitHub repository to Vercel:
   - Go to https://vercel.com/dashboard
   - Click "New Project"
   - Import your GitHub repository
   - Configure the project with these settings:
     - Framework Preset: Next.js
     - Root Directory: apps/frontend
     - Build Command: next build
     - Output Directory: .next
     - Install Command: npm install

### Option 3: Manual Deployment

1. Build the frontend:
   ```bash
   cd apps/frontend
   npm run build
   ```

2. Export the static site:
   ```bash
   npx next export
   ```

3. Upload the contents of the `out` directory to your hosting provider.

## Environment Variables

Make sure to set these environment variables in your Vercel project:

- `NEXT_PUBLIC_API_URL` - Your backend API URL
- `NEXT_PUBLIC_MAP_PROVIDER` - Map provider (default: maplibre)
- `NEXT_PUBLIC_MAP_STYLE_URL` - Map style URL

## Troubleshooting

If you encounter TypeScript errors during build:
1. Check the `tsconfig.json` file for proper configuration
2. Ensure all API responses are properly typed
3. Run `npm run lint` to check for any issues

For any issues with the deployment, contact the development team.