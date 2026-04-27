#!/bin/bash

echo "Starting deployment for Backend..."

# Build the Docker image
echo "Building image 'intelligent'..."
docker build -t intelligent .

# Stop and remove the existing container if it exists
echo "Stopping and removing existing container..."
docker stop intelligent || true
docker rm intelligent || true

# Ensure the uploads directory exists on the host machine
mkdir -p public/uploads

# Run the new container
# - Port 3500 mapped for frontend consumption
# - Volume added for persistent file uploads
# - Using .env file if it exists
echo "Starting new container 'intelligent' on port 3500..."

if [ -f .env ]; then
  ENV_ARG="--env-file .env"
else
  ENV_ARG=""
fi

docker run -d \
  --name intelligent \
  -p 3500:3500 \
  -e PORT=3500 \
  $ENV_ARG \
  intelligent

echo "intelligent service deployed successfully!"