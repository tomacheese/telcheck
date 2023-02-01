#!/bin/sh

while :
do
  node index.js || true

  # wait 1 second
  sleep 1
done