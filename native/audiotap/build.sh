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

# CODESIGN_IDENTITY (set by .github/workflows/release.yml once a real
# Developer ID cert is imported) switches this from an ad-hoc signature to
# a real one with the hardened runtime — required because Apple's notary
# service scans every executable bundled inside the .app, including this
# one (shipped via package.json's extraResources), not just the top-level
# app. An ad-hoc-signed nested binary fails notarization even if the main
# app itself is properly signed. Local dev builds (no CODESIGN_IDENTITY)
# keep the original ad-hoc signature — real signing needs a paid Developer
# ID cert that isn't expected to be on every contributor's machine.
if [ -n "${CODESIGN_IDENTITY:-}" ]; then
  codesign --sign "$CODESIGN_IDENTITY" --identifier com.salescallscripter.audiotap \
    --options runtime --timestamp --force build/audiotap
else
  codesign --sign - --identifier com.salescallscripter.audiotap --force build/audiotap
fi

echo "Built universal (arm64 + x86_64) native/audiotap/build/audiotap"
