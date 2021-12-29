#!/usr/bin/env sh

cd $(dirname $0)/..

mkdir -p artifacts/programs/

# saber
curl -L https://github.com/saber-hq/stable-swap/releases/download/v1.6.1/stable_swap.so > \
    artifacts/programs/stable_swap.so
