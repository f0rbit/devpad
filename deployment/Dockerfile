# Use a base image with Bun installed
FROM oven/bun:latest as builder

# Set the working directory
WORKDIR /app

# Copy the application files
COPY ../app/ .

# Install dependencies and build the project
RUN bun install
RUN bun run build

# Use a base image with Caddy installed
FROM caddy:latest

# Copy the built files and Caddyfile
COPY --from=builder /app/dist /srv
COPY ../deployment/Caddyfile /etc/caddy/Caddyfile

# Copy the Bun server files
COPY --from=builder /app /app

# Expose the port Caddy will serve on
EXPOSE 80

# Start both Caddy and Bun server
CMD ["sh", "-c", "caddy run & bun start"]