import Foundation
import AVFoundation
import ScreenCaptureKit
import CoreGraphics

enum CaptureMode: String {
    case mic, system, both
}

struct Config {
    let mode: CaptureMode
    let outputDir: String
    let sampleRate: Double
    let deviceIndex: Int?
}

func parseArgs() -> Config {
    var mode: CaptureMode = .both
    var outputDir = "."
    var sampleRate = 16000.0
    var deviceIndex: Int? = nil

    let args = CommandLine.arguments
    var i = 1
    while i < args.count {
        switch args[i] {
        case "--mode":
            i += 1; mode = CaptureMode(rawValue: args[i]) ?? .both
        case "--output-dir":
            i += 1; outputDir = args[i]
        case "--sample-rate":
            i += 1; sampleRate = Double(args[i]) ?? 16000.0
        case "--device":
            i += 1; deviceIndex = Int(args[i])
        case "--list-devices":
            listDevices(); exit(0)
        case "--help":
            printUsage(); exit(0)
        default:
            break
        }
        i += 1
    }
    return Config(mode: mode, outputDir: outputDir, sampleRate: sampleRate, deviceIndex: deviceIndex)
}

func printUsage() {
    let usage = """
    grn-capture: Record mic and/or system audio

    Usage:
      grn-capture --mode <mic|system|both> --output-dir <path> [options]

    Options:
      --mode <mic|system|both>  Capture mode (default: both)
      --output-dir <path>       Directory for output files
      --sample-rate <hz>        Sample rate (default: 16000)
      --device <index>          Mic device index
      --list-devices            List available audio input devices
      --help                    Show this help

    Outputs:
      mic.wav      - Microphone audio (when mode is mic or both)
      system.wav   - System audio (when mode is system or both)

    Send SIGINT (Ctrl-C) to stop recording.
    """
    print(usage)
}

func listDevices() {
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyDevices,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var size: UInt32 = 0
    AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size)
    let count = Int(size) / MemoryLayout<AudioDeviceID>.size
    var ids = [AudioDeviceID](repeating: 0, count: count)
    AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &ids)

    var defaultID: AudioDeviceID = 0
    var defAddr = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyDefaultInputDevice,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var defSize = UInt32(MemoryLayout<AudioDeviceID>.size)
    AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &defAddr, 0, nil, &defSize, &defaultID)

    var idx = 0
    for id in ids {
        var inputAddr = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyStreamConfiguration,
            mScope: kAudioDevicePropertyScopeInput,
            mElement: kAudioObjectPropertyElementMain
        )
        var inputSize: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(id, &inputAddr, 0, nil, &inputSize) == noErr, inputSize > 0 else { continue }
        let bufList = UnsafeMutablePointer<AudioBufferList>.allocate(capacity: 1)
        defer { bufList.deallocate() }
        guard AudioObjectGetPropertyData(id, &inputAddr, 0, nil, &inputSize, bufList) == noErr else { continue }
        guard bufList.pointee.mNumberBuffers > 0 else { continue }

        var nameAddr = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyDeviceNameCFString,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var name: CFString = "" as CFString
        var nameSize = UInt32(MemoryLayout<CFString>.size)
        AudioObjectGetPropertyData(id, &nameAddr, 0, nil, &nameSize, &name)

        let def = id == defaultID ? " (default)" : ""
        print("  [\(idx)] \(name)\(def)")
        idx += 1
    }
}

// MARK: - WAV Writer

class WAVWriter {
    private let fileHandle: FileHandle
    private let filePath: String
    private let sampleRate: UInt32
    private let channels: UInt16
    private let bitsPerSample: UInt16
    private var dataSize: UInt32 = 0

    init(path: String, sampleRate: UInt32, channels: UInt16 = 1, bitsPerSample: UInt16 = 16) throws {
        self.filePath = path
        self.sampleRate = sampleRate
        self.channels = channels
        self.bitsPerSample = bitsPerSample
        FileManager.default.createFile(atPath: path, contents: nil)
        self.fileHandle = try FileHandle(forWritingTo: URL(fileURLWithPath: path))
        writeHeader()
    }

    private func writeHeader() {
        var header = Data(count: 44)
        let byteRate = sampleRate * UInt32(channels) * UInt32(bitsPerSample / 8)
        let blockAlign = channels * (bitsPerSample / 8)

        header.replaceSubrange(0..<4, with: "RIFF".data(using: .ascii)!)
        header.replaceSubrange(4..<8, with: withUnsafeBytes(of: UInt32(0).littleEndian) { Data($0) })
        header.replaceSubrange(8..<12, with: "WAVE".data(using: .ascii)!)
        header.replaceSubrange(12..<16, with: "fmt ".data(using: .ascii)!)
        header.replaceSubrange(16..<20, with: withUnsafeBytes(of: UInt32(16).littleEndian) { Data($0) })
        header.replaceSubrange(20..<22, with: withUnsafeBytes(of: UInt16(1).littleEndian) { Data($0) })
        header.replaceSubrange(22..<24, with: withUnsafeBytes(of: channels.littleEndian) { Data($0) })
        header.replaceSubrange(24..<28, with: withUnsafeBytes(of: sampleRate.littleEndian) { Data($0) })
        header.replaceSubrange(28..<32, with: withUnsafeBytes(of: byteRate.littleEndian) { Data($0) })
        header.replaceSubrange(32..<34, with: withUnsafeBytes(of: blockAlign.littleEndian) { Data($0) })
        header.replaceSubrange(34..<36, with: withUnsafeBytes(of: bitsPerSample.littleEndian) { Data($0) })
        header.replaceSubrange(36..<40, with: "data".data(using: .ascii)!)
        header.replaceSubrange(40..<44, with: withUnsafeBytes(of: UInt32(0).littleEndian) { Data($0) })
        fileHandle.write(header)
    }

    func write(pcmBuffer: AVAudioPCMBuffer) {
        guard let floatData = pcmBuffer.floatChannelData else { return }
        let frameCount = Int(pcmBuffer.frameLength)
        var int16Data = Data(count: frameCount * 2)
        for i in 0..<frameCount {
            let sample = max(-1.0, min(1.0, floatData[0][i]))
            let int16 = Int16(sample * 32767.0)
            int16Data[i * 2] = UInt8(int16 & 0xFF)
            int16Data[i * 2 + 1] = UInt8((int16 >> 8) & 0xFF)
        }
        fileHandle.write(int16Data)
        dataSize += UInt32(int16Data.count)
    }

    func writeRaw(data: Data) {
        fileHandle.write(data)
        dataSize += UInt32(data.count)
    }

    func finalize() {
        let fileSize = dataSize + 36
        fileHandle.seek(toFileOffset: 4)
        fileHandle.write(withUnsafeBytes(of: fileSize.littleEndian) { Data($0) })
        fileHandle.seek(toFileOffset: 40)
        fileHandle.write(withUnsafeBytes(of: dataSize.littleEndian) { Data($0) })
        fileHandle.closeFile()
    }
}

// MARK: - Mic Recorder

class MicRecorder {
    private let engine = AVAudioEngine()
    private var writer: WAVWriter?
    private let sampleRate: Double
    private let requestedDevice: Int?
    private var converter: AVAudioConverter?

    init(sampleRate: Double, deviceIndex: Int?) {
        self.sampleRate = sampleRate
        self.requestedDevice = deviceIndex
    }

    private func applyDeviceSelection() {
        guard let idx = requestedDevice else { return }
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDevices,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var size: UInt32 = 0
        AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size)
        let count = Int(size) / MemoryLayout<AudioDeviceID>.size
        var ids = [AudioDeviceID](repeating: 0, count: count)
        AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &ids)

        let inputDevices = ids.filter { id -> Bool in
            var inputAddr = AudioObjectPropertyAddress(
                mSelector: kAudioDevicePropertyStreamConfiguration,
                mScope: kAudioDevicePropertyScopeInput,
                mElement: kAudioObjectPropertyElementMain
            )
            var inputSize: UInt32 = 0
            guard AudioObjectGetPropertyDataSize(id, &inputAddr, 0, nil, &inputSize) == noErr, inputSize > 0 else { return false }
            let bufList = UnsafeMutablePointer<AudioBufferList>.allocate(capacity: 1)
            defer { bufList.deallocate() }
            guard AudioObjectGetPropertyData(id, &inputAddr, 0, nil, &inputSize, bufList) == noErr else { return false }
            return bufList.pointee.mNumberBuffers > 0
        }

        guard idx < inputDevices.count else {
            print("  warning: device index \(idx) out of range, using default")
            return
        }

        let deviceID = inputDevices[idx]
        var deviceIDVar = deviceID
        var propAddr = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultInputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        let status = AudioObjectSetPropertyData(
            AudioObjectID(kAudioObjectSystemObject), &propAddr, 0, nil,
            UInt32(MemoryLayout<AudioDeviceID>.size), &deviceIDVar
        )
        if status == noErr {
            print("  mic device set to index \(idx)")
        } else {
            print("  warning: failed to set mic device (err \(status))")
        }
    }

    func start(outputPath: String) throws {
        applyDeviceSelection()

        let inputNode = engine.inputNode
        let hwFormat = inputNode.outputFormat(forBus: 0)
        print("  mic hw: \(UInt32(hwFormat.sampleRate))Hz \(hwFormat.channelCount)ch")

        let targetFormat = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 1)!
        writer = try WAVWriter(path: outputPath, sampleRate: UInt32(sampleRate), channels: 1)
        converter = AVAudioConverter(from: hwFormat, to: targetFormat)

        inputNode.installTap(onBus: 0, bufferSize: 4096, format: hwFormat) { [weak self] buffer, _ in
            guard let self = self, let converter = self.converter else { return }
            let ratio = self.sampleRate / hwFormat.sampleRate
            let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 1
            guard let converted = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: capacity) else { return }
            var error: NSError?
            var consumed = false
            converter.convert(to: converted, error: &error) { _, outStatus in
                if consumed { outStatus.pointee = .noDataNow; return nil }
                consumed = true
                outStatus.pointee = .haveData
                return buffer
            }
            if error == nil && converted.frameLength > 0 {
                self.writer?.write(pcmBuffer: converted)
            }
        }

        try engine.start()
    }

    func stop() {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        writer?.finalize()
    }
}

// MARK: - System Audio Recorder

class SystemAudioRecorder: NSObject, SCStreamOutput {
    private var stream: SCStream?
    private var writer: WAVWriter?
    private let sampleRate: Double

    init(sampleRate: Double) {
        self.sampleRate = sampleRate
    }

    func start(outputPath: String) async throws {
        writer = try WAVWriter(path: outputPath, sampleRate: UInt32(sampleRate))

        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)

        let display = content.displays.first!
        let filter = SCContentFilter(display: display, excludingWindows: [])

        let config = SCStreamConfiguration()
        config.capturesAudio = true
        config.sampleRate = Int(sampleRate)
        config.channelCount = 1
        config.excludesCurrentProcessAudio = true

        stream = SCStream(filter: filter, configuration: config, delegate: nil)
        try stream!.addStreamOutput(self, type: .audio, sampleHandlerQueue: .global())
        try await stream!.startCapture()
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio else { return }
        guard let blockBuffer = CMSampleBufferGetDataBuffer(sampleBuffer) else { return }

        let length = CMBlockBufferGetDataLength(blockBuffer)
        var data = Data(count: length)
        _ = data.withUnsafeMutableBytes { ptr in
            CMBlockBufferCopyDataBytes(blockBuffer, atOffset: 0, dataLength: length, destination: ptr.baseAddress!)
        }

        convertAndWrite(data: data, sampleBuffer: sampleBuffer)
    }

    private func convertAndWrite(data: Data, sampleBuffer: CMSampleBuffer) {
        guard let formatDesc = CMSampleBufferGetFormatDescription(sampleBuffer) else { return }
        guard let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(formatDesc) else { return }

        let isFloat = asbd.pointee.mFormatFlags & kAudioFormatFlagIsFloat != 0
        let bytesPerSample = Int(asbd.pointee.mBitsPerChannel / 8)
        let numChannels = Int(asbd.pointee.mChannelsPerFrame)
        let numFrames = data.count / (bytesPerSample * numChannels)

        var int16Data = Data(count: numFrames * 2)

        data.withUnsafeBytes { rawPtr in
            if isFloat && bytesPerSample == 4 {
                let floatPtr = rawPtr.bindMemory(to: Float.self)
                for i in 0..<numFrames {
                    let sample = max(-1.0, min(1.0, floatPtr[i * numChannels]))
                    let int16 = Int16(sample * 32767.0)
                    int16Data[i * 2] = UInt8(int16 & 0xFF)
                    int16Data[i * 2 + 1] = UInt8((int16 >> 8) & 0xFF)
                }
            } else if isFloat && bytesPerSample == 8 {
                let doublePtr = rawPtr.bindMemory(to: Float64.self)
                for i in 0..<numFrames {
                    let sample = max(-1.0, min(1.0, Float(doublePtr[i * numChannels])))
                    let int16 = Int16(sample * 32767.0)
                    int16Data[i * 2] = UInt8(int16 & 0xFF)
                    int16Data[i * 2 + 1] = UInt8((int16 >> 8) & 0xFF)
                }
            } else if !isFloat && bytesPerSample == 2 {
                let int16Ptr = rawPtr.bindMemory(to: Int16.self)
                for i in 0..<numFrames {
                    let val = int16Ptr[i * numChannels]
                    int16Data[i * 2] = UInt8(val & 0xFF)
                    int16Data[i * 2 + 1] = UInt8((val >> 8) & 0xFF)
                }
            }
        }

        writer?.writeRaw(data: int16Data)
    }

    func stop() async {
        try? await stream?.stopCapture()
        writer?.finalize()
    }
}

// MARK: - Permission Checks

func stderrPrint(_ message: String) {
    FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
}

func checkMicPermission() {
    let status = AVCaptureDevice.authorizationStatus(for: .audio)
    switch status {
    case .authorized:
        return
    case .notDetermined:
        let sema = DispatchSemaphore(value: 0)
        AVCaptureDevice.requestAccess(for: .audio) { _ in sema.signal() }
        sema.wait()
        if AVCaptureDevice.authorizationStatus(for: .audio) != .authorized {
            stderrPrint("error: Microphone access denied.\n  Grant permission: System Settings → Privacy & Security → Microphone → enable GrnCapture")
            exit(126)
        }
    case .denied, .restricted:
        stderrPrint("error: Microphone access denied.\n  Grant permission: System Settings → Privacy & Security → Microphone → enable GrnCapture")
        exit(126)
    @unknown default:
        return
    }
}

func checkScreenRecordingPermission() {
    if #available(macOS 15.0, *) {
        if !CGPreflightScreenCaptureAccess() {
            _ = CGRequestScreenCaptureAccess()
            stderrPrint("error: Screen Recording access required for system audio capture.\n  A System Settings window should have opened — enable GrnCapture, then re-run.\n  Manual path: System Settings → Privacy & Security → Screen Recording → enable GrnCapture")
            exit(126)
        }
    } else {
        let sema = DispatchSemaphore(value: 0)
        var denied = false
        Task {
            do {
                _ = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
            } catch {
                denied = true
            }
            sema.signal()
        }
        sema.wait()
        if denied {
            stderrPrint("error: Screen Recording access required for system audio capture.\n  Manual path: System Settings → Privacy & Security → Screen Recording → enable GrnCapture")
            exit(126)
        }
    }
}

// MARK: - Main

let config = parseArgs()

if config.mode == .mic || config.mode == .both {
    checkMicPermission()
}

if config.mode == .system || config.mode == .both {
    checkScreenRecordingPermission()
}

let micRecorder: MicRecorder? = (config.mode == .mic || config.mode == .both)
    ? MicRecorder(sampleRate: config.sampleRate, deviceIndex: config.deviceIndex) : nil

let systemRecorder: SystemAudioRecorder? = (config.mode == .system || config.mode == .both)
    ? SystemAudioRecorder(sampleRate: config.sampleRate) : nil

let stopSemaphore = DispatchSemaphore(value: 0)

let sigintSource = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
signal(SIGINT, SIG_IGN)
sigintSource.setEventHandler {
    stopSemaphore.signal()
}
sigintSource.resume()

if let mic = micRecorder {
    let micPath = (config.outputDir as NSString).appendingPathComponent("mic.wav")
    do {
        try mic.start(outputPath: micPath)
        print("● Mic recording to \(micPath)")
    } catch {
        print("Error starting mic: \(error)")
        exit(1)
    }
}

if let sys = systemRecorder {
    let sysPath = (config.outputDir as NSString).appendingPathComponent("system.wav")
    let group = DispatchGroup()
    group.enter()
    Task {
        do {
            try await sys.start(outputPath: sysPath)
            print("● System audio recording to \(sysPath)")
        } catch {
            print("Error starting system audio: \(error)")
            exit(1)
        }
        group.leave()
    }
    group.wait()
}

print("● Recording... send SIGINT to stop")

DispatchQueue.global().async {
    stopSemaphore.wait()
    print("\n● Stopping...")
    micRecorder?.stop()
    let done = DispatchSemaphore(value: 0)
    Task {
        await systemRecorder?.stop()
        done.signal()
    }
    done.wait()
    print("● Capture stopped")
    exit(0)
}

dispatchMain()
