FROM ghcr.io/dever-labs/devcontainers/frontend-dev:latest

# The base image runs `minikube status || minikube start --driver=docker` as a
# postStartCommand. Postly doesn't use Kubernetes, and the amd64 minikube binary
# fails on ARM hosts. Replace it with a no-op stub so the lifecycle hook exits cleanly.
RUN printf '#!/bin/sh\nexit 0\n' > /usr/local/bin/minikube && chmod +x /usr/local/bin/minikube

