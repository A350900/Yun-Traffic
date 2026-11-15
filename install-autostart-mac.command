#!/bin/bash
cd "$(dirname "$0")"
node scripts/autorun.mjs install
echo
read -n 1 -s -r -p "Press any key to close"
