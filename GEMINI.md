# Stitch Project Standards

## Core Mandates
1. **Maximum Effort**: Deeply research and implement robust, idiomatic solutions.
2. **TDD (Test-Driven Development)**: Always write or update tests to verify fixes and features.
3. **Team Execution**: Work as a coordinated unit (Architect, Engineer, QA).
4. **Devil's Advocate**: Critically evaluate solutions for edge cases and bottlenecks.
5. **Build Integrity**: Always run `npm run build` before completing any task to ensure CI/CD stability.

## Architectural Notes
- **Isolation**: Fresh `VideoDecoder` and `WebDemuxer` instances per clip to prevent state leakage.
- **Backpressure**: Monitor `encoder.encodeQueueSize` and `decoder.decodeQueueSize` to prevent memory exhaustion.
- **Normalization**: All tracks must start at timestamp 0 in the output muxer.
