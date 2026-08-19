// audiotap: captures a target process's audio output via the macOS 14.4+ Core Audio
// process-tap API (AudioHardwareSystem/AudioHardwareTap) and streams it to stdout as
// raw 16-bit signed little-endian PCM, mono, at --sample-rate (default 16000 — matches
// Deepgram's recommended phone-quality input).
//
// This replaces BlackHole for capturing the caller's side of a call: no virtual audio
// driver, no system Output device hijack — the target process keeps playing through the
// real speakers/headset exactly as normal while this also reads its audio directly.
// See src/main/audioTap.js for how this process is spawned and consumed.
//
// Target selection: default is --bundle-id com.apple.avconferenced, NOT the visible
// "Phone"/"FaceTime" app. Confirmed via --list-processes during a real Continuity call:
// the GUI app only plays UI sounds (ringtone/connect tone) itself — the actual two-way
// call audio is rendered by this background daemon, which is invisible to NSWorkspace's
// running-application list (it only enumerates GUI apps, not daemons). --process-name
// <name> switches to the old NSWorkspace-based lookup for an actual GUI app if ever
// needed; --bundle-id <id> overrides the daemon target directly.
//
// Usage: audiotap [--bundle-id com.apple.avconferenced | --process-name Phone] [--sample-rate 16000]
//        audiotap --list-processes   (diagnostic: print every process currently
//                                     rendering audio, every 2s, to find the real target)
//
// Status/diagnostic lines go to stderr, one per line. Audio bytes go to stdout only.
// Exits only on SIGINT/SIGTERM; if the target process isn't running (or quits mid
// capture), it polls once a second and resumes automatically rather than exiting —
// a rep may open the Live Call screen before dialing, or make several calls in a row.

import AVFAudio
import AppKit
import CoreAudio
import CoreAudioTypes
import Foundation

func logStatus(_ message: String) {
    FileHandle.standardError.write(Data((message + "\n").utf8))
}

// MARK: - Argument parsing

// Default target is the bundle ID, not a GUI app name: on modern macOS, the
// visible "Phone" app (and FaceTime) only plays UI sounds (ringtone/connect
// tone) itself — the actual two-way call audio is rendered by this
// background daemon (confirmed via --list-processes: it's the only process
// with isRunningOutput/isRunningInput both true during a real call).
// NSWorkspace can't find daemons like this at all (it only lists GUI apps),
// so bundle-ID matching goes straight through AudioHardwareSystem instead.
var bundleID: String? = "com.apple.avconferenced"
var processName: String?
var targetSampleRate: Double = 16000
var listProcesses = false

do {
    var args = CommandLine.arguments.dropFirst().makeIterator()
    while let arg = args.next() {
        switch arg {
        case "--process-name":
            if let value = args.next() {
                processName = value
                bundleID = nil // explicit GUI-app targeting overrides the bundle-ID default
            }
        case "--bundle-id":
            if let value = args.next() { bundleID = value }
        case "--sample-rate":
            if let value = args.next(), let rate = Double(value) { targetSampleRate = rate }
        case "--list-processes":
            listProcesses = true
        default:
            logStatus("audiotap: ignoring unrecognized argument \(arg)")
        }
    }
}

// Diagnostic mode: --process-name only finds GUI apps (NSWorkspace), which
// misses background daemons. This polls every Core Audio process object
// directly and prints which ones are *actually* rendering audio right now
// (isRunningOutput) — run this while on a real call to find the real
// process name/pid to tap, if "Phone" itself turns out to carry no audio.
if listProcesses {
    logStatus("audiotap: --list-processes — polling every 2s, Ctrl+C to stop")
    while true {
        let processes = (try? AudioHardwareSystem.shared.processes) ?? []
        for proc in processes {
            guard let isOut = try? proc.isRunningOutput, isOut else { continue }
            let pid = (try? proc.pid) ?? -1
            let bundleID = (try? proc.bundleID) ?? "?"
            let isIn = (try? proc.isRunningInput) ?? false
            logStatus("audiotap: RENDERING AUDIO — pid=\(pid) bundleID=\(bundleID) isRunningInput=\(isIn)")
        }
        RunLoop.main.run(until: Date().addingTimeInterval(2))
    }
}

let outputFormat = AVAudioFormat(
    commonFormat: .pcmFormatInt16,
    sampleRate: targetSampleRate,
    channels: 1,
    interleaved: true
)!

// MARK: - Clean shutdown

var shouldExit = false
let exitSource = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
let termSource = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
signal(SIGINT, SIG_IGN)
signal(SIGTERM, SIG_IGN)
exitSource.setEventHandler { shouldExit = true }
termSource.setEventHandler { shouldExit = true }
exitSource.resume()
termSource.resume()

// MARK: - One capture session against a single running instance of the target process

/// Owns every Core Audio object created for one capture session (one tap + one private
/// aggregate device + one IOProc) and tears them all down on `stop()`. A new instance is
/// created each time the target process is (re)found, since the tap is tied to a PID.
final class CaptureSession {
    private let system = AudioHardwareSystem.shared
    private var tap: AudioHardwareTap?
    private var aggregate: AudioHardwareAggregateDevice?
    private var ioProcID: AudioDeviceIOProcID?
    private var converter: AVAudioConverter?
    private var inputFormat: AVAudioFormat?

    /// Starts tapping the given process. Throws on any Core Audio failure so the caller
    /// can log it and retry rather than crash the whole helper over a transient error.
    func start(processObjectID: AudioObjectID) throws {
        let description = CATapDescription(stereoMixdownOfProcesses: [processObjectID])
        description.isPrivate = true
        description.muteBehavior = .unmuted // don't silence the call for the person on it

        guard let tap = try system.makeProcessTap(description: description) else {
            throw AudioTapError.message("makeProcessTap returned nil")
        }
        self.tap = tap

        var tapFormat = try tap.format
        guard let inputFormat = withUnsafePointer(to: &tapFormat, { AVAudioFormat(streamDescription: $0) })
        else {
            throw AudioTapError.message("could not interpret tap format")
        }
        self.inputFormat = inputFormat

        guard let converter = AVAudioConverter(from: inputFormat, to: outputFormat) else {
            throw AudioTapError.message("could not build audio converter")
        }
        self.converter = converter

        let aggregateUID = UUID().uuidString
        let composition: [String: Any] = [
            kAudioAggregateDeviceNameKey: "salesCallScripter-audiotap",
            kAudioAggregateDeviceUIDKey: aggregateUID,
            kAudioAggregateDeviceIsPrivateKey: true,
            kAudioAggregateDeviceTapAutoStartKey: true,
            kAudioAggregateDeviceTapListKey: [
                [
                    kAudioSubTapUIDKey: try tap.uid,
                    kAudioSubTapDriftCompensationKey: true
                ]
            ]
        ]
        guard let aggregate = try system.makeAggregateDevice(description: composition) else {
            throw AudioTapError.message("makeAggregateDevice returned nil")
        }
        self.aggregate = aggregate

        var ioProcID: AudioDeviceIOProcID?
        let status = AudioDeviceCreateIOProcIDWithBlock(&ioProcID, aggregate.id, nil) { [weak self] _, inInputData, _, _, _ in
            self?.handle(inInputData)
        }
        guard status == noErr, let ioProcID else {
            throw AudioTapError.message("AudioDeviceCreateIOProcIDWithBlock failed (\(status))")
        }
        self.ioProcID = ioProcID

        try aggregate.start(IOProcID: ioProcID)
    }

    private func handle(_ inInputData: UnsafePointer<AudioBufferList>) {
        guard let inputFormat, let converter else { return }
        guard let inputBuffer = AVAudioPCMBuffer(pcmFormat: inputFormat, bufferListNoCopy: inInputData) else { return }
        guard inputBuffer.frameLength > 0 else { return }

        let ratio = outputFormat.sampleRate / inputFormat.sampleRate
        let capacity = AVAudioFrameCount(Double(inputBuffer.frameLength) * ratio) + 256
        guard let outputBuffer = AVAudioPCMBuffer(pcmFormat: outputFormat, frameCapacity: capacity) else { return }

        var consumed = false
        var conversionError: NSError?
        converter.convert(to: outputBuffer, error: &conversionError) { _, outStatus in
            if consumed {
                outStatus.pointee = .noDataNow
                return nil
            }
            consumed = true
            outStatus.pointee = .haveData
            return inputBuffer
        }

        if let conversionError {
            logStatus("audiotap: conversion error: \(conversionError.localizedDescription)")
            return
        }
        guard outputBuffer.frameLength > 0, let channelData = outputBuffer.int16ChannelData else { return }

        let byteCount = Int(outputBuffer.frameLength) * MemoryLayout<Int16>.size
        let data = Data(bytes: channelData[0], count: byteCount)
        FileHandle.standardOutput.write(data)
    }

    func stop() {
        if let aggregate, let ioProcID {
            try? aggregate.stop(IOProcID: ioProcID)
            AudioDeviceDestroyIOProcID(aggregate.id, ioProcID)
        }
        if let aggregate {
            try? system.destroyAggregateDevice(aggregate)
        }
        if let tap {
            try? system.destroyProcessTap(tap)
        }
        tap = nil
        aggregate = nil
        ioProcID = nil
        converter = nil
        inputFormat = nil
    }
}

enum AudioTapError: Error, CustomStringConvertible {
    case message(String)
    var description: String {
        switch self {
        case .message(let text): return text
        }
    }
}

// MARK: - Find-and-capture loop

func findRunningProcess(named name: String) -> pid_t? {
    NSWorkspace.shared.runningApplications.first { $0.localizedName == name }?.processIdentifier
}

// Finds the current (AudioObjectID, pid) for whichever target was
// configured — a bundle ID matched directly against Core Audio's process
// list (covers background daemons NSWorkspace can't see), or a GUI app name
// matched via NSWorkspace then resolved to its Core Audio process object.
func findTarget() -> (id: AudioObjectID, pid: pid_t)? {
    if let bundleID {
        let processes = (try? AudioHardwareSystem.shared.processes) ?? []
        guard let match = processes.first(where: { (try? $0.bundleID) == bundleID }) else { return nil }
        guard let pid = try? match.pid else { return nil }
        return (match.id, pid)
    }
    guard let processName else { return nil }
    guard let pid = findRunningProcess(named: processName) else { return nil }
    guard let objectID = try? AudioHardwareSystem.shared.process(for: pid)?.id else { return nil }
    return (objectID, pid)
}

let targetDescription = bundleID ?? processName ?? "?"
logStatus("audiotap: watching for \"\(targetDescription)\" (output: \(Int(targetSampleRate))Hz mono s16le)")

var lastLoggedWaiting = false

while !shouldExit {
    guard let target = findTarget() else {
        if !lastLoggedWaiting {
            logStatus("audiotap: waiting for \(targetDescription) to launch")
            lastLoggedWaiting = true
        }
        RunLoop.main.run(until: Date().addingTimeInterval(1))
        continue
    }
    lastLoggedWaiting = false

    let session = CaptureSession()
    do {
        try session.start(processObjectID: target.id)
        logStatus("audiotap: capturing \(targetDescription) (pid \(target.pid))")
    } catch {
        logStatus("audiotap: failed to start capture: \(error). Retrying in 1s (check System Settings → Privacy & Security → Screen & System Audio Recording if this persists).")
        session.stop()
        RunLoop.main.run(until: Date().addingTimeInterval(1))
        continue
    }

    // Keep running while the same instance of the target process is alive and we
    // haven't been asked to exit; poll rather than relying on a notification so a
    // dead/relaunched process (new pid, or — for daemons — a new Core Audio
    // process object even at the same pid) is picked up cleanly on the next loop.
    while !shouldExit, findTarget()?.pid == target.pid {
        RunLoop.main.run(until: Date().addingTimeInterval(1))
    }

    session.stop()
    if !shouldExit {
        logStatus("audiotap: \(targetDescription) exited, resuming watch")
    }
}

logStatus("audiotap: exiting")
