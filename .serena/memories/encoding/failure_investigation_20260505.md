# Encoding Failure Investigation (May 5, 2026)

## Issues Identified
1. **Unknown Error (Desktop)**: Caused by non-monotonic or negative timestamps.
2. **Unknown Error (Mobile)**: Caused by resource exhaustion due to per-chunk `OfflineAudioContext` creation (thousands of contexts).
3. **Memory Crashes (Mobile)**: Concurrent video/audio processing exceeding mobile memory limits.
4. **Decoder Rejection**: Lack of support check for software decoding configurations.

## Fixes Implemented (Mobile-Extreme Architecture)
1. **Sequential Processing**: Switched to `await processVideo(); await processAudio();` to halve peak memory usage.
2. **Zero-Allocation Audio Resampler**: Replaced `OfflineAudioContext` with a lightweight linear resampler for audio chunks, eliminating thousands of expensive allocations.
3. **Ultra-Strict Backpressure**: Threshold lowered to `4` frames (video and audio) to minimize memory footprint on high-resolution videos.
4. **Robust Timestamps**: Guaranteed non-negative, strictly monotonic timestamps for all tracks.
5. **Standardized Audio**: Forced 44.1kHz/2ch/AAC pipeline with robust internal resampling.
6. **Even Dimensions**: Enforced even width/height for H.264 compatibility.
7. **Decoder Support Check**: Mandatory `VideoDecoder.isConfigSupported()` check before configuration.
8. **Abort Controller**: Fully integrated for immediate resource cleanup during mode switches.
9. **Muxer Alignment**: Enabled `firstTimestampBehavior: 'offset'` in `mp4-muxer` for perfect timing.
