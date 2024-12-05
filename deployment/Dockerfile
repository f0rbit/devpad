# Use a base image with Bun installed
FROM oven/bun:latest as builder

# Set the working directory
WORKDIR /app

# Copy the application files
COPY ../app/ .
COPY ../deployment/.env .

# Install dependencies and build the project
RUN bun install
RUN bun run build

WORKDIR /server

COPY ../deployment/ .

RUN bun install

CMD ["bun", "index.ts"]