# First stage is to build todo-tracker application from go source code
# url: https://github.com/f0rbit/todo-tracker
# the go application is under /go
FROM golang:1.22.1 as go-builder

WORKDIR /todo-tracker

# need to git clone (its a public directory)
RUN apt-get update && apt-get install -y git
RUN git clone https://github.com/f0rbit/todo-tracker.git .

# build the go application
RUN go build -o todo-tracker

# Use a base image with Bun installed
FROM oven/bun:1.1.37 as builder

# install 'unzip'
RUN apt-get update && apt-get install -y unzip

WORKDIR /

COPY ../todo-config.json .
COPY --from=go-builder /todo-tracker/todo-tracker .

# Set the working directory
WORKDIR /app

# Copy the application files
COPY ../app/ .
RUN rm -f ./.env.example
COPY ../deployment/.en[v] .

# Install dependencies and build the project
RUN bun install
RUN bun run check
RUN bun run build

WORKDIR /server

COPY ../deployment/ .

RUN bun install

CMD ["bun", "index.ts"]
