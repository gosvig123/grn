#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="${SCRIPT_DIR}/../build"
APP_DIR="${BUILD_DIR}/GappdCapture.app/Contents"
BINARY_PATH="${APP_DIR}/MacOS/gappd-capture"
MACOS_MIN_VERSION="${GAPPD_MACOS_MIN_VERSION:-13.0}"
MAC_BUILD_PROFILE="${GAPPD_MAC_BUILD:-native}"
HOST_ARCH="$(uname -m)"

case "${MAC_BUILD_PROFILE}" in
    universal)
        TARGET_ARCHS=(arm64 x86_64)
        ;;
    arm64)
        TARGET_ARCHS=(arm64)
        ;;
    x64)
        TARGET_ARCHS=(x86_64)
        ;;
    native)
        TARGET_ARCHS=("${HOST_ARCH}")
        ;;
    *)
        echo "Unsupported GAPPD_MAC_BUILD value: ${MAC_BUILD_PROFILE}" >&2
        exit 1
        ;;
esac

build_arch_binary() {
    local arch="$1"
    local output_path="$2"

    swiftc \
        -O \
        -target "${arch}-apple-macos${MACOS_MIN_VERSION}" \
        -framework AVFoundation \
        -framework ScreenCaptureKit \
        -framework CoreMedia \
        -framework CoreAudio \
        "${SCRIPT_DIR}/main.swift" \
        -o "${output_path}"
}

rm -rf "${BUILD_DIR}/GappdCapture.app"
mkdir -p "${APP_DIR}/MacOS"
cp "${SCRIPT_DIR}/Info.plist" "${APP_DIR}/Info.plist"
plutil -replace LSMinimumSystemVersion -string "${MACOS_MIN_VERSION}" "${APP_DIR}/Info.plist"

TEMP_DIR="$(mktemp -d "${BUILD_DIR}/gappd-capture.XXXXXX")"
cleanup() {
    rm -rf "${TEMP_DIR}"
}
trap cleanup EXIT

if [ "${#TARGET_ARCHS[@]}" -eq 1 ]; then
    build_arch_binary "${TARGET_ARCHS[0]}" "${BINARY_PATH}"
else
    LIPO_INPUTS=()
    for arch in "${TARGET_ARCHS[@]}"; do
        arch_output_path="${TEMP_DIR}/gappd-capture-${arch}"
        build_arch_binary "${arch}" "${arch_output_path}"
        LIPO_INPUTS+=("${arch_output_path}")
    done
    lipo -create "${LIPO_INPUTS[@]}" -output "${BINARY_PATH}"
fi

codesign --force --sign - --deep "${BUILD_DIR}/GappdCapture.app"

echo "Built: ${BUILD_DIR}/GappdCapture.app"
echo "Run:   ${APP_DIR}/MacOS/gappd-capture --help"
