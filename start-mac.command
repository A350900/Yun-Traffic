#!/bin/bash
cd "$(dirname "$0")"

echo "Getting the latest version..."
git pull

echo "Installing anything new..."
npm install --no-audit --no-fund

echo "Starting Yun Traffic. Your browser will open in a few seconds."
echo "Keep this window open while you use the site. Close it to stop."
(sleep 6; open http://localhost:5173) &
npm run dev
