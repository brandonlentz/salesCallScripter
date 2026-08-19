#!/bin/bash
# Builds the audiotap helper: compiles main.swift, embeds Info.plist so the binary has
# its own TCC identity (NSAudioCaptureUsageDescription needs a bundle Info.plist, but a
# bare CLI tool can get one via a linker section instead of a full .app bundle), then
# ad-hoc codesigns with a *stable* identifier so the one-time "allow audio capture"
# permission grant survives rebuilds instead of re-prompting every time.
set -euo pipefail

cd "$(dirname "$0")"
mkdir -p build

swiftc main.swift \
  -O \
  -o build/audiotap \
  -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker Info.plist

codesign --sign - --identifier com.salescallscripter.audiotap --force build/audiotap

echo "Built native/audiotap/build/audiotap"
