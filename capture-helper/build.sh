#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="${SCRIPT_DIR}/../build"
APP_DIR="${BUILD_DIR}/GrnCapture.app/Contents"

rm -rf "${BUILD_DIR}/GrnCapture.app"
mkdir -p "${APP_DIR}/MacOS"
cp "${SCRIPT_DIR}/Info.plist" "${APP_DIR}/Info.plist"

swiftc \
    -O \
    -framework AVFoundation \
    -framework ScreenCaptureKit \
    -framework CoreMedia \
    -framework CoreAudio \
    "${SCRIPT_DIR}/main.swift" \
    -o "${APP_DIR}/MacOS/grn-capture"

codesign --force --sign - --deep "${BUILD_DIR}/GrnCapture.app"

echo "Built: ${BUILD_DIR}/GrnCapture.app"
echo "Run:   ${APP_DIR}/MacOS/grn-capture --help"
