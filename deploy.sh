#!/bin/bash
set -e

echo "Deploying orthonu-intelligent..."

docker build -t intelligent .

docker stop intelligent 2>/dev/null || true
docker rm intelligent 2>/dev/null || true

mkdir -p public/uploads

docker run -d \
  --name intelligent \
  --network=host \
  --env-file .env \
  -v "$(pwd)/public/uploads:/app/public/uploads" \
  intelligent

echo "Done — container 'intelligent' running on port 3500"
