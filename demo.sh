#!/bin/bash

echo "🚀 Eavesight Implementation Demo"
echo "=================================="
echo

echo "1. Checking if services are running..."
echo "--------------------------------------"
curl -s -o /dev/null -w "Backend (API): %{http_code}\n" http://localhost:4000/api/health
curl -s -o /dev/null -w "Frontend (Web): %{http_code}\n" http://localhost:3003/

echo
echo "2. Demonstrating API functionality..."
echo "-------------------------------------"

echo "Getting authentication token for demo user:"
TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login -H "Content-Type: application/json" -d '{"email":"demo@eavesight.com","password":"demo1234"}' | grep -o '"accessToken":"[^"]*' | cut -d'"' -f4)
echo "[Token received - length: ${#TOKEN} characters]"
echo

echo "Fetching storm data from NOAA integration:"
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:4000/api/storms/active | head -200
echo "... (truncated for brevity)"
echo

echo "Searching for properties in Huntsville, AL:"
curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:4000/api/properties?city=Huntsville&state=AL" | head -200
echo "... (truncated for brevity)"
echo

echo "Checking lead statistics:"
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:4000/api/leads/stats
echo

echo "Fetching sample leads:"
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:4000/api/leads | head -100
echo "... (truncated for brevity)"
echo

echo "3. Key Implementation Features:"
echo "-------------------------------"
echo "✅ Real NOAA storm data integration (free public data)"
echo "✅ Property database with storm associations"
echo "✅ Lead management system with status tracking"
echo "✅ Roof age estimation algorithms"
echo "✅ Complete REST API with authentication"
echo "✅ Sample data for immediate demonstration"
echo

echo "4. Next Steps for Monetization:"
echo "------------------------------"
echo "💰 Deploy with \$100 budget:"
echo "   - Domain registration (\$15/year)"
echo "   - Vercel deployment (free tier available)"
echo "   - Basic analytics (free tier available)"
echo
echo "🎯 Target Market:"
echo "   - Roofing contractors in storm-prone regions"
echo "   - Insurance companies assessing claims"
echo "   - Property managers monitoring assets"
echo
echo "📈 Revenue Model:"
echo "   - Subscription fees per lead (\$10-50/lead)"
echo "   - Monthly plans (\$99-499/month)"
echo "   - Enterprise licensing for large fleets"