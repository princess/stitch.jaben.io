# Encoding Failure Investigation (May 5, 2026)

## Issues Identified
1. **Unknown Error (Desktop)**: Caused by non-monotonic or negative timestamps.
2. **Unknown Error (Mobile)**: Caused by resource exhaustion due to per-chunk `OfflineAudioContext` creation.
3. **Memory Crashes (Mobile)**: Concurrent video/audio processing exceeding mobile memory limits.
4. **Decoder Rejection**: Lack of support check for software decoding configurations.
5. **Background Suspension**: Process fails when phone screen turns off or tab is minimized.

## Fixes Implemented (Mobile-Extreme Architecture)
1. **Sequential Processing**: Switched to sequential track processing to halve peak memory usage.
2. **Zero-Allocation Audio Resampler**: Lightweight linear resampler replacing `OfflineAudioContext`.
3. **Ultra-Strict Backpressure**: Threshold lowered to `4` frames.
4. **Robust Timestamps**: Guaranteed non-negative, strictly monotonic timestamps.
5. **Standardized Audio**: 44.1kHz/2ch/AAC pipeline.
6. **Even Dimensions**: Enforced even width/height for H.264 compatibility.
7. **Decoder Support Check**: `VideoDecoder.isConfigSupported()` before configuration.
8. **Abort Controller**: Immediate resource cleanup during mode switches.
9. **Screen Wake Lock API**: Prevents device from sleeping during processing. Re-acquires lock on `visibilitychange`.
10. **Muxer Alignment**: `firstTimestampBehavior: 'offset'` enabled.
