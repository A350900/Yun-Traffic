#!/bin/bash
cd "$(dirname "$0")"
node scripts/yun.mjs setup
echo
read -n 1 -s -r -p "Press any key to close"
