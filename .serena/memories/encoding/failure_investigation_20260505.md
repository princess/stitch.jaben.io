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
3. **Standardized Audio**: Forced 44.1kHz/2ch/AAC pipeline with robust `OfflineAudioContext` resampling.
4. **Strict Backpressure**: Threshold lowered to `8` frames for both decode and encode queues.
5. **Baseline Profile**: Forced `avc1.42E028` (Baseline 4.0) in Safe Mode for maximum software compatibility.
6. **Decoder Support Check**: Added `VideoDecoder.isConfigSupported()` before configuration.
7. **AbortSignal**: Integrated `AbortController` into `runStitchEngine` for clean pass transitions.
8. **Even Dimensions**: Enforced even width/height for H.264 compatibility.
9. **Planar Audio Fix**: Robustly reconstructs multi-plane AudioData using allocationSize.
10. **Track Alignment**: Synchronized A/V tracks using a shared global offset based on max clip duration.
11. **Muxer Offset**: Enabled `firstTimestampBehavior: 'offset'` for perfect 0-start timing.
12. **Enhanced Logging**: Added stack traces and explicit error names to FATAL logs.
