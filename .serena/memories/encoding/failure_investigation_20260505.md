# Encoding Failure Investigation (May 5, 2026)

## Issues Identified
1. **Unknown Error**: Caused by non-monotonic or negative timestamps passed to `VideoEncoder`/`AudioEncoder`.
2. **Audio Sample Rate Mismatch**: `AudioEncoder` was hardcoded to 44.1kHz while source was dynamic.
3. **Memory Exhaustion**: Lack of backpressure on `encodeQueueSize`.
4. **Decoder Rejection**: `prefer-software` forced without `isConfigSupported` check.
5. **Abort Controller**: Missing mandate for "Recovery" architecture.

## Fixes Implemented
1. **Robust Timestamps**: Added `lastVideoTs` and `lastAudioTs` to ensure `ts` is always `>= 0` and strictly monotonic (`ts = lastTs + 1` if necessary).
2. **Audio Reconstruction**: `AudioData` is now reconstructed with global timestamps using `copyTo`.
3. **Dynamic Audio Config**: `AudioEncoder` and `Muxer` now use `targetAudioConfig` for sample rate and channels.
4. **Strict Backpressure**: Threshold lowered to `16` for both decode and encode queues.
5. **Baseline Profile**: Forced `avc1.42E028` (Baseline 4.0) in Safe Mode for maximum software compatibility.
6. **Decoder Support Check**: Added `VideoDecoder.isConfigSupported()` before configuration.
7. **AbortSignal**: Integrated `AbortController` into `runStitchEngine` for clean pass transitions.
