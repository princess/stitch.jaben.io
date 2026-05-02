# 🧵 Stitch Project Context for Agents

## Project Overview
Stitch is a serverless, browser-based video concatenator using WebCodecs, mp4-muxer, and web-demuxer.

## Technical Architecture
- **Frontend**: React 19, TypeScript, Vite.
- **Processing**: Native `VideoEncoder` and `VideoDecoder` APIs.
- **Muxing**: `mp4-muxer` for containerizing chunks.
- **Demuxing**: `web-demuxer` (WASM) for reading input files.

## Common Pitfalls
1. **Timestamp Monotonicity**: Output chunks must have strictly increasing timestamps.
2. **Backpressure**: `encoder.encodeQueueSize` must be monitored to prevent browser crashes.
3. **Muxer Requirements**: The first chunk of each track MUST have a timestamp of 0.
4. **WASM Pathing**: `web-demuxer.wasm` is located in `/public/wasm-files/`.

## Testing Standards
- Use Playwright for E2E tests.
- Mocking video files: Use `tests/fixtures/test.mp4`.
- Verification: Always check for success messages and absence of error banners.
