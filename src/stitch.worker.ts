/// <reference lib="webworker" />
import { 
  Output, 
  Mp4OutputFormat, 
  BufferTarget, 
  StreamTarget,
  EncodedVideoPacketSource, 
  EncodedAudioPacketSource, 
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
            // REINHARD TONE MAPPING for Pixel 6 HDR
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

        // 1. Pre-flight (Adaptive Clock + Normalization)
        let targetWidth = 0, targetHeight = 0, targetCodec = 'avc', targetAudioConfig: AudioDecoderConfig | null = null;
        let firstVideoConfig: VideoDecoderConfig | null = null, canFastPath = true, globalPeak = 0, maxFrameRate = 30;
        let originalMetadata: any = null;

        updateUI('Analyzing media grid...', 0);
        for (let i = 0; i < videos.length; i++) {
          const demuxer = new WebDemuxer({ wasmFilePath: wasmUrl });
          try {
            await demuxer.load(videos[i].file);
            const vConfig = await demuxer.getDecoderConfig('video');
            const aConfig = await demuxer.getDecoderConfig('audio').catch(() => null);
            const streams = (await demuxer.getMediaInfo()).streams;
            const videoStream = streams.find(s => s.codec_type_string === 'video');
            if (videoStream) {
               // Extract framerate: usually coded as string like "60/1" or similar
               // This is a rough estimation for adaptive clock
               const fps = videoStream.codec_string.includes('60') ? 60 : 30;
               maxFrameRate = Math.max(maxFrameRate, fps);
            }

            if (i === 0) {
              firstVideoConfig = vConfig;
              targetWidth = Math.floor(vConfig.codedWidth! / 2) * 2;
              targetHeight = Math.floor(vConfig.codedHeight! / 2) * 2;
              targetCodec = vConfig.codec.startsWith('hev') ? 'hevc' : 'avc';
              targetAudioConfig = aConfig;
              try { originalMetadata = { date: new Date(), title: `Stitched on Pixel 6`, raw: { 'com.apple.quicktime.description': 'Processed by Stitch Engine' } }; } catch {}
            } else {
              if (vConfig.codec !== firstVideoConfig!.codec || vConfig.codedWidth !== firstVideoConfig!.codedWidth ||
                  vConfig.codedHeight !== firstVideoConfig!.codedHeight || !buffersEqual(vConfig.description as ArrayBuffer, firstVideoConfig!.description as ArrayBuffer)) {
                canFastPath = false;
              }
            }

            if (aConfig) {
              const reader = demuxer.read('audio').getReader();
              const audioDecoder = new AudioDecoder({
                output: (data) => {
                  const p0 = new Float32Array(data.numberOfFrames); data.copyTo(p0, { planeIndex: 0 });
                  for (let val of p0) globalPeak = Math.max(globalPeak, Math.abs(val));
                  data.close();
                },
                error: () => {}
              });
              audioDecoder.configure(aConfig);
              for (let j = 0; j < 50; j++) { const { done, value } = await reader.read(); if (done) break; audioDecoder.decode(value); }
              await audioDecoder.flush(); audioDecoder.close(); reader.releaseLock();
            }
            targetWidth = Math.max(targetWidth, Math.floor(vConfig.codedWidth! / 2) * 2);
            targetHeight = Math.max(targetHeight, Math.floor(vConfig.codedHeight! / 2) * 2);
          } finally { await demuxer.destroy(); }
        }

        const audioGain = globalPeak > 0 ? Math.min(2.0, 0.9 / globalPeak) : 1.0;
        if (canFastPath) addLog('[FastPath] ENABLED.');
        addLog(`[Clock] Adaptive Master Clock: ${maxFrameRate}fps.`);

        if (isMobile && (targetWidth > 1920 || targetHeight > 1080)) {
           const scale = Math.min(1920 / targetWidth, 1080 / targetHeight);
           targetWidth = Math.floor((targetWidth * scale) / 2) * 2;
           targetHeight = Math.floor((targetHeight * scale) / 2) * 2;
        }

        // 2. Muxer
        let target: BufferTarget | StreamTarget;
        if (useDiskStream) {
          const ws = new WritableStream<StreamTargetChunk>({ write: (c) => self.postMessage({ type: 'DISK_WRITE', payload: c }, [c.data.buffer] as any) });
          target = new StreamTarget(ws);
        } else { target = new BufferTarget(); }

        const output = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target });
        const videoSource = new EncodedVideoPacketSource(targetCodec === 'hevc' ? 'hevc' : 'avc');
        output.addVideoTrack(videoSource);
        let audioSource: EncodedAudioPacketSource | null = null;
        if (targetAudioConfig) { audioSource = new EncodedAudioPacketSource('aac'); output.addAudioTrack(audioSource); }
        if (originalMetadata) output.setMetadataTags(originalMetadata);
        await output.start();

        // 3. Encoders
        let encoder: VideoEncoder | null = null, audioEncoder: AudioEncoder | null = null;
        if (!canFastPath) {
          encoder = new VideoEncoder({
            output: (chunk, meta) => {
              const packet = EncodedPacket.fromEncodedChunk(chunk);
              if (meta?.decoderConfig) videoSource.add(packet, { decoderConfig: meta.decoderConfig });
              else videoSource.add(packet);
            },
            error: (e) => self.postMessage({ type: 'ERROR', payload: `VideoEncoder: ${e.message}` })
          });
          const configs: VideoEncoderConfig[] = [
            { codec: 'avc1.4D4034', width: targetWidth, height: targetHeight, bitrate: 5_000_000, framerate: maxFrameRate, hardwareAcceleration: 'prefer-hardware', // @ts-ignore
              colorSpace: { fullRange: false, matrix: 'bt709', primaries: 'bt709', transfer: 'bt709' } },
            { codec: 'avc1.42E028', width: targetWidth, height: targetHeight, bitrate: 3_000_000, framerate: maxFrameRate, hardwareAcceleration: 'prefer-hardware' },
            { codec: 'avc1.42E028', width: targetWidth, height: targetHeight, bitrate: 2_000_000, framerate: maxFrameRate, hardwareAcceleration: 'prefer-software' }
          ];
          let startIndex = (isSafeMode || isMobile) ? 1 : 0, selected = configs[2];
          for (let i = startIndex; i < configs.length; i++) { if ((await VideoEncoder.isConfigSupported(configs[i])).supported) { selected = configs[i]; break; } }
          encoder.configure(selected);

          if (targetAudioConfig && audioSource) {
            audioEncoder = new AudioEncoder({
              output: (chunk, meta) => {
                const packet = EncodedPacket.fromEncodedChunk(chunk);
                if (meta?.decoderConfig) audioSource!.add(packet, { decoderConfig: meta.decoderConfig });
                else audioSource!.add(packet);
              },
              error: (e) => self.postMessage({ type: 'ERROR', payload: `AudioEncoder: ${e.message}` })
            });
            audioEncoder.configure({ codec: 'mp4a.40.2', numberOfChannels: 2, sampleRate: 44100, bitrate: 128_000 });
          }
        }

        // 4. Loop
        const canvas = new OffscreenCanvas(targetWidth, targetHeight);
        const renderer = new WebGPURenderer(canvas);
        await renderer.init();
        const frameInterval = 1000000 / maxFrameRate;
        const audioBufferPool = new BufferPool(44100);
        let accumulatedTimeMicros = 0, accumulatedAudioTimeMicros = 0, lastAudioTs = -1;

        for (let i = 0; i < videos.length; i++) {
          checkFatal();
          const demuxer = new WebDemuxer({ wasmFilePath: wasmUrl });
          try {
            updateUI(isSafeMode ? `Compatibility Mode: ${i+1}/${videos.length}` : `Stitching: ${i+1}/${videos.length}`);
            await demuxer.load(videos[i].file);
            const videoConfig = await demuxer.getDecoderConfig('video');
            const mediaInfo = await demuxer.getMediaInfo();
            const videoDuration = mediaInfo.duration;
            let currentAudioConfig: AudioDecoderConfig | null = await demuxer.getDecoderConfig('audio').catch(() => null);
            let clipVideoMaxTime = 0, clipAudioMaxTime = 0, frameCount = 0;

            const processVideo = async () => {
              const reader = demuxer.read('video').getReader();
              try {
                if (canFastPath) {
                  while (true) {
                    checkFatal(); const { done, value: chunk } = await reader.read(); if (done) break;
                    const adjusted = EncodedPacket.fromEncodedChunk(chunk).clone({ timestamp: (accumulatedTimeMicros + (frameCount * frameInterval)) / 1000000 });
                    videoSource.add(adjusted, (i === 0 && frameCount === 0) ? { decoderConfig: firstVideoConfig! } : undefined);
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
                  const dSupport = await VideoDecoder.isConfigSupported({ ...videoConfig, hardwareAcceleration: isSafeMode ? 'prefer-software' : 'prefer-hardware' });
                  decoder.configure(dSupport.supported ? dSupport.config! : { ...videoConfig, hardwareAcceleration: 'prefer-hardware' });
                  let lastProgressTime = Date.now();
                  while (true) {
                    checkFatal(); if (Date.now() - lastProgressTime > 15000) throw new Error('Decoder Timeout');
                    const maxQueue = isMobile ? 5 : 30;
                    while (encoder!.encodeQueueSize > maxQueue) { checkFatal(); await new Promise(r => setTimeout(r, 10)); lastProgressTime = Date.now(); }
                    while (decoder.decodeQueueSize > 10) { checkFatal(); await new Promise(r => setTimeout(r, 10)); }
                    const { done, value: chunk } = await reader.read(); if (done) break;
                    decoder.decode(chunk); if (decoder.decodeQueueSize === 0) lastProgressTime = Date.now(); 
                    if (frameCount % 30 === 0) { lastProgressTime = Date.now(); updateUI(undefined, Math.round(((i + Math.min(1, frameCount / (videoDuration * (1000000 / frameInterval)))) / videos.length) * 90)); await new Promise(r => setTimeout(r, 0)); }
                  }
                  await decoder.flush(); decoder.close();
                }
              } finally { reader.releaseLock(); }
            };

            const processAudio = async () => {
              const reader = demuxer.read('audio').getReader();
              try {
                if (canFastPath) {
                  while (true) {
                    checkFatal(); const { done, value: chunk } = await reader.read(); if (done) break;
                    const adjusted = EncodedPacket.fromEncodedChunk(chunk).clone({ timestamp: (accumulatedAudioTimeMicros + (chunk.timestamp)) / 1000000 });
                    audioSource!.add(adjusted, (i === 0 && chunk.timestamp === 0) ? { decoderConfig: targetAudioConfig! } : undefined); 
                    clipAudioMaxTime = Math.max(clipAudioMaxTime, (chunk.timestamp + (chunk.duration || 0)));
                  }
                } else {
                  if (!audioEncoder || !currentAudioConfig) return;
                  let offset: number | null = null;
                  const audioDecoder = new AudioDecoder({
                    output: (data) => {
                      if (offset === null) offset = data.timestamp;
                      let ts = Math.max(0, (data.timestamp - offset)) + accumulatedAudioTimeMicros;
                      if (ts <= lastAudioTs) ts = lastAudioTs + 1;
                      lastAudioTs = ts;
                      if (audioEncoder!.state === 'configured') {
                        const ratio = data.sampleRate / 44100, newFrames = Math.floor(data.numberOfFrames / ratio), interleaved = audioBufferPool.getOutput(newFrames * 2);
                        for (let j = 0; j < data.numberOfChannels; j++) data.copyTo(audioBufferPool.getPlane(j, data.numberOfFrames), { planeIndex: j });
                        for (let j = 0; j < newFrames; j++) {
                          const srcIdx = j * ratio, idx1 = Math.floor(srcIdx), idx2 = Math.min(idx1 + 1, data.numberOfFrames - 1), weight = srcIdx - idx1;
                          for (let ch = 0; ch < 2; ch++) {
                            const p = audioBufferPool.getPlane(ch % data.numberOfChannels, data.numberOfFrames);
                            interleaved[j * 2 + ch] = (p[idx1] * (1 - weight) + p[idx2] * weight) * audioGain;
                          }
                        }
                        const finalData = new AudioData({ format: 'f32', sampleRate: 44100, numberOfFrames: newFrames, numberOfChannels: 2, timestamp: ts, data: interleaved.slice() });
                        audioEncoder!.encode(finalData); finalData.close();
                      }
                      clipAudioMaxTime = Math.max(clipAudioMaxTime, (ts - accumulatedAudioTimeMicros) + (data.duration || 0)); data.close();
                    },
                    error: (e) => self.postMessage({ type: 'ERROR', payload: `AudioDecoder: ${e.message}` })
                  });
                  audioDecoder.configure(currentAudioConfig);
                  while (true) {
                    checkFatal(); while (audioEncoder!.encodeQueueSize > 30) { checkFatal(); await new Promise(r => setTimeout(r, 10)); }
                    while (audioDecoder.decodeQueueSize > 10) { checkFatal(); await new Promise(r => setTimeout(r, 10)); }
                    const { done, value: chunk } = await reader.read(); if (done) break; audioDecoder.decode(chunk);
                  }
                  await audioDecoder.flush(); audioDecoder.close();
                }
              } finally { reader.releaseLock(); }
            };

            await processVideo(); await processAudio(); checkFatal();
            const clipDuration = Math.max(clipVideoMaxTime, clipAudioMaxTime, (videoDuration || 0));
            accumulatedTimeMicros += clipDuration; accumulatedAudioTimeMicros += clipDuration;
            if (isMobile) { updateUI(`Cooling down...`, Math.round(((i + 1) / videos.length) * 90)); await new Promise(r => setTimeout(r, 600)); }
          } finally { await demuxer.destroy(); }
        }

        checkFatal();
        if (encoder) { updateUI('Finalizing Video...', 95); await withTimeout(encoder.flush(), 15000, 'Video Flush'); }
        if (audioEncoder) { updateUI('Finalizing Audio...', 97); await withTimeout(audioEncoder.flush(), 10000, 'Audio Flush'); }
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
