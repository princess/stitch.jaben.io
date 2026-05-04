# Stitch Project Standards

## Core Mandates
1. **Maximum Effort**: Deeply research and implement robust, idiomatic solutions.
2. **TDD (Test-Driven Development)**: ALWAYS write or update tests before completing a task. A feature or fix is not "functional" until it is verified by an automated test.
3. **Regression Prevention**: When a bug is reported, first write a test that reproduces the failure, then implement the fix.
4. **Team Execution**: Work as a coordinated unit (Architect, Engineer, QA).
5. **Devil's Advocate**: Critically evaluate solutions for edge cases and bottlenecks.
6. **Build Integrity**: Always run `npm run build` before completing any task.

## Architectural Notes
- **Isolation**: Fresh `VideoDecoder` and `WebDemuxer` instances per clip.
- **Backpressure**: Monitor `encoder.encodeQueueSize` and `decoder.decodeQueueSize` to prevent memory exhaustion.
- **Normalization**: All tracks must start at timestamp 0 in the output muxer.
- **Recovery**: Use the "Pass-Locked" architecture with `AbortController` for all hardware fallback paths.
