#!/bin/bash
# Builds the audiotap helper: compiles main.swift for both Apple Silicon and
# Intel (so one build works across the whole team's MacBooks, not just the
# machine it was built on), lipo's the two slices into a universal binary,
# embeds Info.plist so the binary has its own TCC identity
# (NSAudioCaptureUsageDescription needs a bundle Info.plist, but a bare CLI
# tool can get one via a linker section instead of a full .app bundle), then
# ad-hoc codesigns with a *stable* identifier so the one-time "allow audio
# capture" permission grant survives rebuilds instead of re-prompting every
# time.
set -euo pipefail

cd "$(dirname "$0")"
mkdir -p build

# The Core Audio process-tap APIs used below (AudioHardwareTap,
# AudioHardwareAggregateDevice, AudioHardwareSystem) require macOS 15+
# (Sequoia) even though the README's general prerequisite is 14.4+ — swiftc
# confirms this at compile time if you lower it.
MIN_MACOS=15.0

for arch in arm64 x86_64; do
  swiftc main.swift \
    -O \
    -target "$arch-apple-macos$MIN_MACOS" \
    -o "build/audiotap-$arch" \
    -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker Info.plist
done

lipo -create -output build/audiotap build/audiotap-arm64 build/audiotap-x86_64
rm build/audiotap-arm64 build/audiotap-x86_64

codesign --sign - --identifier com.salescallscripter.audiotap --force build/audiotap

echo "Built universal (arm64 + x86_64) native/audiotap/build/audiotap"
