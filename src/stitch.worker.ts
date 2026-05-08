/// <reference lib="webworker" />
import { 
  Output, 
  Mp4OutputFormat, 
  BufferTarget, 
  StreamTarget,
  EncodedVideoPacketSource, 
  AudioSampleSource, 
  AudioSample,
  EncodedPacket 
} from 'mediabunny';
import type { StreamTargetChunk } from 'mediabunny';
import { WebDemuxer } from 'web-demuxer';
import { WASM_BASE64 } from './wasm_data';

// Worker state
let currentAbortController: AbortController | null = null;
let cachedWasmUrl: string | null = null;

function buffersEqual(a: ArrayBuffer | undefined, b: ArrayBuffer | undefined) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.byteLength !== b.byteLength) return false;
  const viewA = new Uint8Array(a);
  const viewB = new Uint8Array(b);
  for (let i = 0; i < viewA.length; i++) if (viewA[i] !== viewB[i]) return false;
  return true;
}

async function getWasmUrl(): Promise<string> {
  if (cachedWasmUrl) return cachedWasmUrl;
  cachedWasmUrl = `data:application/wasm;base64,${WASM_BASE64}`;
  return cachedWasmUrl;
}

// ATOMIC SUMMIT: WebGPU with HDR Tone Mapping
class WebGPURenderer {
  private device!: GPUDevice;
  private pipeline!: GPURenderPipeline;
  private sampler!: GPUSampler;
  private canvasContext: GPUCanvasContext;
  public isSupported = false;

  constructor(canvas: OffscreenCanvas) {
    this.canvasContext = canvas.getContext('webgpu') as GPUCanvasContext;
  }

  async init() {
    try {
      const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter) return;
      this.device = await adapter.requestDevice();

      this.canvasContext.configure({
        device: this.device,
        format: navigator.gpu.getPreferredCanvasFormat(),
        alphaMode: 'opaque'
      });

      const shader = this.device.createShaderModule({
        code: `
          struct VertexOutput { @builtin(position) pos: vec4f, @location(0) uv: vec2f }
          @vertex fn vs(@builtin(vertex_index) vi: u32) -> VertexOutput {
            var pos = array<vec2f, 4>(vec2f(-1,-1), vec2f(1,-1), vec2f(-1,1), vec2f(1,1));
            var uv = array<vec2f, 4>(vec2f(0,1), vec2f(1,1), vec2f(0,0), vec2f(1,0));
            var out: VertexOutput; out.pos = vec4f(pos[vi], 0, 1); out.uv = uv[vi]; return out;
          }
          @group(0) @binding(0) var s: sampler; @group(0) @binding(1) var t: texture_external;
          @fragment fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
            var color = textureSampleBaseLevel(t, s, uv);
            color = vec4f(color.rgb / (color.rgb + vec3f(1.0)), color.a);
            return color;
          }
        `
      });

      this.pipeline = this.device.createRenderPipeline({
        layout: 'auto',
        vertex: { module: shader, entryPoint: 'vs' },
        fragment: { module: shader, entryPoint: 'fs', targets: [{ format: navigator.gpu.getPreferredCanvasFormat() }] },
        primitive: { topology: 'triangle-strip' }
      });
      this.sampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
      this.isSupported = true;
    } catch { this.isSupported = false; }
  }

  render(frame: VideoFrame, targetWidth: number, targetHeight: number) {
    if (!this.isSupported) return;
    const texture = this.device.importExternalTexture({ source: frame });
    const commandEncoder = this.device.createCommandEncoder();
    const ar = frame.displayWidth / frame.displayHeight, tar = targetWidth / targetHeight;
    let dw = targetWidth, dh = targetHeight, ox = 0, oy = 0;
    if (ar > tar) { dh = targetWidth / ar; oy = (targetHeight - dh) / 2; }
    else { dw = targetHeight * ar; ox = (targetWidth - dw) / 2; }

    const pass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: this.canvasContext.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear', storeOp: 'store'
      }]
    });
    pass.setViewport(ox, oy, dw, dh, 0, 1);
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: this.sampler }, { binding: 1, resource: texture }]
    }));
    pass.draw(4); pass.end();
    this.device.queue.submit([commandEncoder.finish()]);
  }
}

class BufferPool {
  private p1: Float32Array; private p2: Float32Array; private out: Float32Array;
  constructor(maxFrames: number) {
    this.p1 = new Float32Array(maxFrames);
    this.p2 = new Float32Array(maxFrames);
    this.out = new Float32Array(maxFrames * 2);
  }
  getPlane(i: number, size: number) { return i === 0 ? this.p1.subarray(0, size) : this.p2.subarray(0, size); }
  getOutput(size: number) { return this.out.subarray(0, size); }
}

const withTimeout = <T,>(p: Promise<T>, ms: number, label: string): Promise<T> => {
  return Promise.race([
    p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Timeout: ${label}`)), ms))
  ]);
};

self.onmessage = async (e) => {
  const { type, payload } = e.data;
  if (type === 'ABORT') { if (currentAbortController) currentAbortController.abort(); return; }

  if (type === 'START') {
    const { videos, isSafeMode, isMobile, passId, useDiskStream } = payload;
    currentAbortController = new AbortController();
    const wasmUrl = await getWasmUrl();
    const signal = currentAbortController.signal;

    const updateUI = (s?: string, p?: number) => self.postMessage({ type: 'UPDATE_UI', payload: { passId, newStatus: s, newProgress: p } });
    const addLog = (msg: string) => self.postMessage({ type: 'LOG', payload: msg });
    const checkFatal = () => { if (signal.aborted) throw new Error('Pass aborted.'); };

    try {
      updateUI('Queuing for hardware access...', 0);
      await navigator.locks.request('webcodecs_hardware', { signal }, async () => {
        addLog('[Hardware] Lock acquired.');

        // 1. Pre-flight
        let targetWidth = 0, targetHeight = 0, targetCodec = 'avc', hasAudioGlobal = false;
        let firstVideoConfig: VideoDecoderConfig | null = null;
        let canFastPath = true, maxFrameRate = 30;
        let originalMetadata: any = null;
        const videoMetadata: { duration: number, peak: number }[] = [];

        updateUI('Analyzing media grid...', 0);
        for (let i = 0; i < videos.length; i++) {
          const demuxer = new WebDemuxer({ wasmFilePath: wasmUrl });
          let clipPeak = 0;
          try {
            await demuxer.load(videos[i].file);
            const vConfig = await demuxer.getDecoderConfig('video');
            const aConfig = await demuxer.getDecoderConfig('audio').catch(() => null);
            const mediaInfo = await demuxer.getMediaInfo();
            const videoStream = mediaInfo.streams.find(s => s.codec_type_string === 'video');
            if (videoStream) {
               const fps = videoStream.codec_string.includes('60') ? 60 : 30;
               maxFrameRate = Math.max(maxFrameRate, fps);
            }
            if (aConfig) hasAudioGlobal = true;

            if (i === 0) {
              firstVideoConfig = vConfig;
              targetWidth = Math.floor(vConfig.codedWidth! / 2) * 2;
              targetHeight = Math.floor(vConfig.codedHeight! / 2) * 2;
              targetCodec = vConfig.codec.startsWith('hev') ? 'hevc' : 'avc';
              try { originalMetadata = { date: new Date(), title: `Stitched on Pixel 6`, raw: { 'com.apple.quicktime.description': 'Processed by Stitch Engine' } }; } catch {}
            } else {
              const vMatch = vConfig.codec === firstVideoConfig!.codec && vConfig.codedWidth === firstVideoConfig!.codedWidth &&
                             vConfig.codedHeight === firstVideoConfig!.codedHeight && buffersEqual(vConfig.description as ArrayBuffer, firstVideoConfig!.description as ArrayBuffer);
              if (!vMatch) canFastPath = false;
            }

            if (aConfig) {
              const reader = demuxer.read('audio').getReader();
              const audioDecoder = new AudioDecoder({
                output: (data) => {
                  const p0 = new Float32Array(data.numberOfFrames); data.copyTo(p0, { planeIndex: 0 });
                  for (let val of p0) clipPeak = Math.max(clipPeak, Math.abs(val));
                  data.close();
                },
                error: () => {}
              });
              audioDecoder.configure(aConfig);
              for (let j = 0; j < 50; j++) { const { done, value } = await reader.read(); if (done) break; audioDecoder.decode(value); }
              await audioDecoder.flush(); audioDecoder.close(); reader.releaseLock();
            }
            videoMetadata.push({ duration: mediaInfo.duration || 0, peak: clipPeak });
            targetWidth = Math.max(targetWidth, Math.floor(vConfig.codedWidth! / 2) * 2);
            targetHeight = Math.max(targetHeight, Math.floor(vConfig.codedHeight! / 2) * 2);
          } finally { await demuxer.destroy(); }
        }

        if (canFastPath) addLog('[FastPath] Video optimized.');
        addLog(`[Clock] Adaptive Master Clock: ${maxFrameRate}fps.`);

        // 2. Muxer
        let target: BufferTarget | StreamTarget;
        if (useDiskStream) {
          const ws = new WritableStream<StreamTargetChunk>({ write: (c) => self.postMessage({ type: 'DISK_WRITE', payload: c }, [c.data.buffer] as any) });
          target = new StreamTarget(ws);
        } else { target = new BufferTarget(); }

        const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
        const videoSource = new EncodedVideoPacketSource(targetCodec === 'hevc' ? 'hevc' : 'avc');
        output.addVideoTrack(videoSource);
        
        let audioSource: AudioSampleSource | null = null;
        if (hasAudioGlobal) { 
          addLog('[Muxer] Initializing world-class audio track.');
          audioSource = new AudioSampleSource({
            codec: 'aac',
            bitrate: 128_000,
            transform: {
              sampleRate: 44100,
              numberOfChannels: 2
            }
          }); 
          output.addAudioTrack(audioSource); 
        }
        
        if (originalMetadata) output.setMetadataTags(originalMetadata);
        await output.start();

        // 3. Encoders
        let encoder: VideoEncoder | null = null;
        if (!canFastPath) {
          encoder = new VideoEncoder({
            output: async (chunk, meta) => {
              const packet = EncodedPacket.fromEncodedChunk(chunk);
              await videoSource.add(packet, meta?.decoderConfig ? { decoderConfig: { ...meta.decoderConfig, description: meta.decoderConfig.description ? new Uint8Array(meta.decoderConfig.description as any) : undefined } } : undefined);
            },
            error: (e) => self.postMessage({ type: 'ERROR', payload: `VideoEncoder: ${e.message}` })
          });
          encoder.configure({ codec: 'avc1.4D4034', width: targetWidth, height: targetHeight, bitrate: 5_000_000, framerate: maxFrameRate, hardwareAcceleration: 'prefer-hardware' });
        }

        // 4. Loop
        const canvas = new OffscreenCanvas(targetWidth, targetHeight);
        const renderer = new WebGPURenderer(canvas);
        await renderer.init();
        const frameInterval = 1000000 / maxFrameRate;
        const audioBufferPool = new BufferPool(44100);
        let accumulatedTimeMicros = 0, lastAudioTs = -1;

        for (let i = 0; i < videos.length; i++) {
          checkFatal();
          const demuxer = new WebDemuxer({ wasmFilePath: wasmUrl });
          try {
            updateUI(isSafeMode ? `Compatibility Mode: ${i+1}/${videos.length}` : `Stitching: ${i+1}/${videos.length}`);
            await demuxer.load(videos[i].file);
            const vConfig = await demuxer.getDecoderConfig('video');
            const mediaInfo = await demuxer.getMediaInfo();
            const videoDuration = mediaInfo.duration;
            let currentAudioConfig: AudioDecoderConfig | null = await demuxer.getDecoderConfig('audio').catch(() => null);
            let clipVideoMaxTime = 0, clipAudioMaxTime = 0, frameCount = 0;
            const clipGain = videoMetadata[i].peak > 0 ? Math.min(2.0, 0.9 / videoMetadata[i].peak) : 1.0;

            const processVideo = async () => {
              const reader = demuxer.read('video').getReader();
              try {
                if (canFastPath) {
                  while (true) {
                    checkFatal(); const { done, value: chunk } = await reader.read(); if (done) break;
                    const packet = EncodedPacket.fromEncodedChunk(chunk).clone({ timestamp: (accumulatedTimeMicros + (frameCount * frameInterval)) / 1000000 });
                    await videoSource.add(packet, frameCount === 0 ? { decoderConfig: { ...vConfig, description: vConfig.description ? new Uint8Array(vConfig.description as any) : undefined } } : undefined);
                    frameCount++; clipVideoMaxTime = Math.max(clipVideoMaxTime, (frameCount * frameInterval));
                    if (frameCount % 60 === 0) updateUI(undefined, Math.round(((i + Math.min(1, frameCount / (videoDuration * (1000000 / frameInterval)))) / videos.length) * 90));
                  }
                } else {
                  let offset: number | null = null;
                  const decoder = new VideoDecoder({
                    output: (frame) => {
                      if (offset === null) offset = frame.timestamp;
                      const ts = accumulatedTimeMicros + (frameCount * frameInterval);
                      if (renderer.isSupported) renderer.render(frame, targetWidth, targetHeight);
                      const fte = new VideoFrame(canvas, { timestamp: ts, duration: frameInterval });
                      if (encoder!.state === 'configured') { encoder!.encode(fte, { keyFrame: frameCount % 60 === 0 }); frameCount++; }
                      clipVideoMaxTime = Math.max(clipVideoMaxTime, (frameCount * frameInterval));
                      fte.close(); frame.close();
                    },
                    error: (e) => self.postMessage({ type: 'ERROR', payload: `VideoDecoder: ${e.message}` })
                  });
                  decoder.configure(vConfig);
                  while (true) {
                    checkFatal(); if (encoder!.encodeQueueSize > 30) { await new Promise(r => setTimeout(r, 10)); continue; }
                    const { done, value } = await reader.read(); if (done) break; decoder.decode(value);
                  }
                  await decoder.flush(); decoder.close();
                }
              } finally { reader.releaseLock(); }
            };

            const processAudio = async () => {
              if (!audioSource) return;
              if (!currentAudioConfig) {
                const silenceDuration = videoDuration || 0;
                const frames = Math.floor((silenceDuration / 1000000) * 44100);
                const silence = new AudioData({ format: 'f32', sampleRate: 44100, numberOfFrames: frames, numberOfChannels: 2, timestamp: accumulatedTimeMicros, data: new Float32Array(frames * 2) });
                await audioSource!.add(new AudioSample(silence)); silence.close();
                clipAudioMaxTime = silenceDuration;
                return;
              }

              const reader = demuxer.read('audio').getReader();
              try {
                  let offset: number | null = null;
                  let audioCount = 0;
                  const FADE_MICROS = 30000;
                  const audioDecoder = new AudioDecoder({
                    output: async (data) => {
                      if (offset === null) offset = data.timestamp;
                      let ts = Math.max(0, (data.timestamp - offset)) + accumulatedTimeMicros;
                      if (ts <= lastAudioTs) ts = lastAudioTs + 1;
                      lastAudioTs = ts;

                      const ratio = data.sampleRate / 44100, newFrames = Math.floor(data.numberOfFrames / ratio), interleaved = audioBufferPool.getOutput(newFrames * 2);
                      for (let j = 0; j < data.numberOfChannels; j++) data.copyTo(audioBufferPool.getPlane(j, data.numberOfFrames), { planeIndex: j });
                      for (let j = 0; j < newFrames; j++) {
                        const srcIdx = j * ratio, idx1 = Math.floor(srcIdx), idx2 = Math.min(idx1 + 1, data.numberOfFrames - 1), weight = srcIdx - idx1;
                        let fadeGain = 1.0;
                        const relTs = ts - accumulatedTimeMicros;
                        if (relTs < FADE_MICROS) fadeGain = relTs / FADE_MICROS;
                        else if (videoDuration && (videoDuration - relTs) < FADE_MICROS) fadeGain = (videoDuration - relTs) / FADE_MICROS;
                        for (let ch = 0; ch < 2; ch++) {
                          const p = audioBufferPool.getPlane(ch % data.numberOfChannels, data.numberOfFrames);
                          interleaved[j * 2 + ch] = (p[idx1] * (1 - weight) + p[idx2] * weight) * clipGain * fadeGain;
                        }
                      }
                      const finalData = new AudioData({ format: 'f32', sampleRate: 44100, numberOfFrames: newFrames, numberOfChannels: 2, timestamp: ts, data: interleaved.slice() });
                      await audioSource!.add(new AudioSample(finalData)); finalData.close();
                      audioCount++;
                      clipAudioMaxTime = Math.max(clipAudioMaxTime, (ts - accumulatedTimeMicros) + (data.duration || 0)); data.close();
                    },
                    error: (e) => self.postMessage({ type: 'ERROR', payload: `AudioDecoder: ${e.message}` })
                  });
                  audioDecoder.configure(currentAudioConfig);
                  while (true) {
                    checkFatal(); const { done, value } = await reader.read(); if (done) break; audioDecoder.decode(value);
                  }
                  await audioDecoder.flush(); audioDecoder.close();
                  addLog(`[Audio] DSP: Processed ${audioCount} buffers for clip ${i}.`);
              } catch (err) {
                addLog(`[Audio] Warning: Clip ${i} failed: ${err instanceof Error ? err.message : String(err)}`);
              } finally { reader.releaseLock(); }
            };

            await Promise.all([processVideo(), processAudio()]); checkFatal();
            const clipDuration = Math.max(clipVideoMaxTime, clipAudioMaxTime, (videoDuration || 0));
            accumulatedTimeMicros += clipDuration;
            if (isMobile) { updateUI(`Cooling down...`, Math.round(((i + 1) / videos.length) * 90)); await new Promise(r => setTimeout(r, 600)); }
          } finally { await demuxer.destroy(); }
        }

        checkFatal();
        if (encoder) { updateUI('Finalizing Video...', 95); await withTimeout(encoder.flush(), 15000, 'Video Flush'); }
        videoSource.close();
        if (audioSource) audioSource.close();

        updateUI('Writing File...', 99); await withTimeout(output.finalize(), 60000, 'Muxer Finalize');
        const buffer = (target instanceof BufferTarget) ? target.buffer : null;
        self.postMessage({ type: 'COMPLETE', payload: buffer }, buffer ? [buffer] as any : []);
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      self.postMessage({ type: 'ERROR', payload: err instanceof Error ? err.message : String(err) });
    } finally { currentAbortController = null; }
  }
};
