import React, { useState, useRef } from 'react';
import { Muxer, ArrayBufferTarget, type MuxerOptions } from 'mp4-muxer';
import { WebDemuxer } from 'web-demuxer';

if (typeof window !== 'undefined') {
  (window as any).WebDemuxer = WebDemuxer;
}

import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, X, Play, Loader2, Upload, CheckCircle2, AlertTriangle, Trash2 } from 'lucide-react';
import styles from './App.module.css';

// Helper to compare extradata/description buffers
const areBuffersEqual = (a: AllowSharedBufferSource | undefined, b: AllowSharedBufferSource | undefined) => {
  if (a === b) return true;
  if (!a || !b) return false;
  const viewA = new Uint8Array(a instanceof ArrayBuffer || a instanceof SharedArrayBuffer ? a : a.buffer);
  const viewB = new Uint8Array(b instanceof ArrayBuffer || b instanceof SharedArrayBuffer ? b : b.buffer);
  if (viewA.length !== viewB.length) return false;
  for (let i = 0; i < viewA.length; i++) {
    if (viewA[i] !== viewB[i]) return false;
  }
  return true;
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

interface VideoFile {
  id: string;
  file: File;
}

const SortableVideoItem = ({ id, file, onRemove, disabled }: { id: string; file: File; onRemove: (id: string) => void, disabled?: boolean }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id, disabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} className={`${styles.videoItem} ${disabled ? styles.disabled : ''}`}>
      <div {...(disabled ? {} : attributes)} {...(disabled ? {} : listeners)} className={styles.dragHandle}>
        <GripVertical size={20} />
      </div>
      <span className={styles.fileName}>{file.name}</span>
      {!disabled && (
        <button onClick={() => onRemove(id)} className={styles.removeBtn}>
          <X size={20} />
        </button>
      )}
    </div>
  );
};

function App() {
  const [browserSupported] = useState(() => {
    if (typeof window === 'undefined') return true;
    return !!(window.VideoEncoder && window.VideoFrame && window.OffscreenCanvas);
  });
  const [loaded] = useState(true);
  const [videos, setVideos] = useState<VideoFile[]>([]);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isDone, setIsDone] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files).map(file => ({
        id: Math.random().toString(36).substr(2, 9),
        file
      }));
      setVideos(prev => [...prev, ...newFiles]);
      setIsDone(false);
      setError(null);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id && !processing) {
      setVideos((items) => {
        const oldIndex = items.findIndex((i) => i.id === active.id);
        const newIndex = items.findIndex((i) => i.id === over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  const removeVideo = (id: string) => {
    if (processing) return;
    setVideos(prev => prev.filter(v => v.id !== id));
    setIsDone(false);
    setError(null);
  };

  const clearVideos = () => {
    if (processing) return;
    setVideos([]);
    setIsDone(false);
    setError(null);
  };

  const concatenate = async () => {
    if (videos.length < 2) return;
    setProcessing(true);
    setIsDone(false);
    setError(null);
    setProgress(0);

    console.log('--- STITCH ENGINE STARTING ---');
    let encoder: VideoEncoder | null = null;
    let muxer: Muxer<ArrayBufferTarget> | null = null;

    try {
      setStatus('Initializing Engine...');
      console.log('[Init] Loading first video to determine target resolution...');
      
      const initialDemuxer = new WebDemuxer({
        wasmFilePath: `${window.location.origin}/wasm-files/web-demuxer.wasm`
      });
      
      let targetWidth: number;
      let targetHeight: number;
      let targetCodec: string;
      let targetDescription: ArrayBuffer | undefined;
      let targetAudioConfig: AudioDecoderConfig | null = null;

      try {
        await initialDemuxer.load(videos[0].file);
        const targetConfig = await initialDemuxer.getDecoderConfig('video');
        targetWidth = targetConfig.codedWidth!;
        targetHeight = targetConfig.codedHeight!;
        targetCodec = targetConfig.codec;
        targetDescription = targetConfig.description ? new Uint8Array(targetConfig.description as ArrayBuffer).slice().buffer : undefined;

        console.log(`[Init] Target Resolution: ${targetWidth}x${targetHeight}, Codec: ${targetCodec}`);

        if (!targetWidth || !targetHeight) {
          throw new Error('Invalid video dimensions detected.');
        }

        try {
          targetAudioConfig = await initialDemuxer.getDecoderConfig('audio');
          console.log(`[Init] Audio Detected: ${targetAudioConfig.codec}`);
        } catch {
          console.log('[Init] No audio track detected in first video.');
        }
      } finally {
        await initialDemuxer.destroy();
      }

      const isHevc = targetCodec.startsWith('hev') || targetCodec.startsWith('hvc');
      const muxerVideoCodec = isHevc ? 'hevc' : 'avc';

      const muxerConfig: MuxerOptions<ArrayBufferTarget> = {
        target: new ArrayBufferTarget(),
        video: {
          codec: muxerVideoCodec,
          width: targetWidth,
          height: targetHeight
        },
        fastStart: 'in-memory'
      };

      if (targetAudioConfig) {
        muxerConfig.audio = {
          codec: targetAudioConfig.codec.startsWith('mp4a') ? 'aac' : 'opus',
          sampleRate: targetAudioConfig.sampleRate,
          numberOfChannels: targetAudioConfig.numberOfChannels
        };
      }

      muxer = new Muxer(muxerConfig);

      encoder = new VideoEncoder({
        output: (chunk, meta) => muxer!.addVideoChunk(chunk, meta),
        error: (e) => {
          console.error('[Encoder] CRITICAL ERROR:', e);
          setError('Encoder error: ' + e.message);
        }
      });

      const encoderCodec = isHevc ? 'hev1.1.6.L120.90' : 'avc1.4d002a';
      const baseEncoderConfig: VideoEncoderConfig = {
        codec: encoderCodec,
        width: targetWidth,
        height: targetHeight,
        bitrate: 4_000_000,
        framerate: 30,
      };
      
      const optimizedEncoderConfig: VideoEncoderConfig = {
        ...baseEncoderConfig,
        hardwareAcceleration: 'prefer-hardware',
      };

      const support = await VideoEncoder.isConfigSupported(optimizedEncoderConfig);
      if (support.supported) {
        encoder.configure(optimizedEncoderConfig);
      } else {
        encoder.configure(baseEncoderConfig);
      }
      console.log('[Init] Encoder configured.');

      let accumulatedTimeMicros = 0;
      let lastDts = -1;
      let lastAudioDts = -1;
      const canvas = new OffscreenCanvas(targetWidth, targetHeight);
      const ctx = canvas.getContext('2d', { alpha: false });
      
      if (!ctx) throw new Error('Failed to initialize 2D context.');

      // Watchdog helper to prevent silent hangs in stream reading
      const readWithTimeout = async (reader: ReadableStreamDefaultReader<any>, timeoutMs = 10000) => {
        return Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error('Stream read timed out (possible file corruption).')), timeoutMs)
          )
        ]);
      };

      for (let i = 0; i < videos.length; i++) {
        const videoFile = videos[i].file;
        console.log(`[Clip ${i + 1}/${videos.length}] --- STARTING CLIP: ${videoFile.name} ---`);
        
        const demuxer = new WebDemuxer({
          wasmFilePath: `${window.location.origin}/wasm-files/web-demuxer.wasm`
        });

        try {
          setStatus(`Loading clip ${i + 1}/${videos.length}...`);
          await demuxer.load(videoFile);
          const currentMediaInfo = await demuxer.getMediaInfo();
          const videoDuration = currentMediaInfo.duration;
          const currentConfig = await demuxer.getDecoderConfig('video');
          
          console.log(`[Clip ${i + 1}] Duration: ${videoDuration}s, Config: ${currentConfig.codedWidth}x${currentConfig.codedHeight} ${currentConfig.codec}`);

          let currentAudioConfig: AudioDecoderConfig | null = null;
          try {
            currentAudioConfig = await demuxer.getDecoderConfig('audio');
          } catch { /* No audio */ }

          const isCompatible = !(window as any).forceSlowPath && 
            currentConfig.codec === targetCodec &&
            currentConfig.codedWidth === targetWidth &&
            currentConfig.codedHeight === targetHeight &&
            areBuffersEqual(currentConfig.description, targetDescription);

          console.log(`[Clip ${i + 1}] Compatibility Check: ${isCompatible ? 'FAST PATH (Remux)' : 'SLOW PATH (Transcode)'}`);

          if (i > 0) {
            console.log(`[Clip ${i + 1}] Transitioning... Hardening hardware state.`);
            canvas.width = 0;
            canvas.height = 0;
            await delay(50); 
            canvas.width = targetWidth;
            canvas.height = targetHeight;
          }

          let clipMaxTime = 0;
          let clipVideoOffset: number | null = null;
          let clipAudioOffset: number | null = null;

          const processVideo = async () => {
            let chunkCount = 0;
            if (isCompatible) {
              const stream = demuxer.read('video');
              const reader = stream.getReader();
              try {
                while (true) {
                  if (error) throw new Error(error);
                  const { done, value: chunk } = await readWithTimeout(reader);
                  if (done) break;
                  
                  if (clipVideoOffset === null) clipVideoOffset = chunk.timestamp;
                  let timestamp = (chunk.timestamp - clipVideoOffset!) + accumulatedTimeMicros;
                  if (timestamp <= lastDts) timestamp = lastDts + 1;
                  lastDts = timestamp;

                  const data = new Uint8Array(chunk.byteLength);
                  chunk.copyTo(data);
                  
                  try {
                    muxer!.addVideoChunk(new EncodedVideoChunk({
                      type: chunk.type,
                      timestamp,
                      duration: chunk.duration ?? undefined,
                      data
                    }), { decoderConfig: currentConfig });
                  } catch (muxErr) {
                    console.error('[Muxer] Video chunk error:', muxErr);
                    throw muxErr;
                  }

                  clipMaxTime = Math.max(clipMaxTime, timestamp - accumulatedTimeMicros + (chunk.duration ?? 0));
                  
                  chunkCount++;
                  if (chunkCount % 50 === 0) {
                    const currentVideoProgress = videoDuration > 0 ? Math.min(chunk.timestamp / (videoDuration * 1_000_000), 1) : 0;
                    const totalProgress = Math.round(((i + currentVideoProgress) / videos.length) * 90);
                    setProgress(totalProgress);
                    setStatus(`Stitching ${i + 1}/${videos.length}: ${Math.round(currentVideoProgress * 100)}% (Fast)`);
                  }
                }
              } finally {
                reader.releaseLock();
                await stream.cancel();
              }
            } else {
              const clipContext = {
                encodingPromise: Promise.resolve(),
                clipVideoOffset: null as number | null,
                clipMaxTime: 0,
                frameCount: 0,
              };

              const decoder = new VideoDecoder({
                output: (frame) => {
                  const timestampMicros = (frame.timestamp - (clipContext.clipVideoOffset ?? frame.timestamp)) + accumulatedTimeMicros;
                  if (clipContext.clipVideoOffset === null) clipContext.clipVideoOffset = frame.timestamp;
                  
                  // Use a promise chain to ensure frames are processed in order
                  clipContext.encodingPromise = clipContext.encodingPromise.then(async () => {
                    try {
                      if (error) return;
                      if (encoder?.state !== 'configured') return;
                      
                      let frameToEncode: VideoFrame;
                      clipContext.clipMaxTime = Math.max(clipContext.clipMaxTime, timestampMicros - accumulatedTimeMicros + (frame.duration ?? 0));

                      if (frame.displayWidth === targetWidth && frame.displayHeight === targetHeight) {
                        frameToEncode = new VideoFrame(frame, { timestamp: timestampMicros, duration: frame.duration || undefined });
                      } else {
                        ctx.fillStyle = 'black';
                        ctx.fillRect(0, 0, targetWidth, targetHeight);
                        const videoAspectRatio = frame.displayWidth / frame.displayHeight;
                        const targetAspectRatio = targetWidth / targetHeight;
                        let drawW = targetWidth, drawH = targetHeight, offX = 0, offY = 0;
                        if (videoAspectRatio > targetAspectRatio) {
                          drawH = targetWidth / videoAspectRatio;
                          offY = (targetHeight - drawH) / 2;
                        } else {
                          drawW = targetHeight * videoAspectRatio;
                          offX = (targetWidth - drawW) / 2;
                        }
                        ctx.drawImage(frame, offX, offY, drawW, drawH);
                        frameToEncode = new VideoFrame(canvas, { timestamp: timestampMicros, duration: frame.duration || undefined });
                      }
                      
                      // Encoder Backpressure Handling with safety timeout
                      if (encoder!.encodeQueueSize > 128) {
                        let waitStart = Date.now();
                        while (encoder!.encodeQueueSize > 128) {
                          await new Promise(r => setTimeout(r, 0));
                          if (Date.now() - waitStart > 5000) {
                            throw new Error('Encoder timed out (backpressure stall).');
                          }
                        }
                      }

                      if (encoder?.state === 'configured') {
                        try {
                          encoder!.encode(frameToEncode, { keyFrame: clipContext.frameCount % 120 === 0 });
                        } catch (encErr) {
                          console.error('[Encoder] Encode call error:', encErr);
                          throw encErr;
                        }
                      }
                      frameToEncode.close();
                      clipContext.frameCount++;

                      // Update progress based on ENCODED frames
                      if (clipContext.frameCount % 30 === 0) {
                        const currentVideoProgress = videoDuration > 0 ? Math.min(timestampMicros / (videoDuration * 1_000_000), 1) : 0;
                        const totalProgress = Math.round(((i + currentVideoProgress) / videos.length) * 90);
                        setProgress(totalProgress);
                        setStatus(`Stitching ${i + 1}/${videos.length}: ${Math.round(currentVideoProgress * 100)}%`);
                      }
                    } catch (e) {
                      console.error('[FrameTask] Error:', e);
                      setError(e instanceof Error ? e.message : 'Encoding frame task failed.');
                    } finally {
                      frame.close();
                    }
                  });
                },
                error: (e) => {
                  console.error(`[Decoder Clip ${i+1}] ERROR:`, e);
                  setError(`Decoder error: ${e.message}`);
                }
              });

              decoder.configure(currentConfig);
              const stream = demuxer.read('video');
              const reader = stream.getReader();
              
              setStatus(`Stitching ${i + 1}/${videos.length}: Starting transcode...`);

              try {
                while (true) {
                  // Monitor for fatal errors via React state or closure
                  if (error) throw new Error(error);
                  
                  if (encoder?.state === 'closed' || decoder.state === 'closed') break;

                  const { done, value: chunk } = await readWithTimeout(reader);
                  if (done) break;
                  
                  if (decoder.decodeQueueSize > 128) await new Promise(r => setTimeout(r, 0));
                  
                  try {
                    decoder.decode(chunk);
                  } catch (decodeErr) {
                    console.error('[Decode] Fatal decode call error:', decodeErr);
                    throw decodeErr;
                  }

                  chunkCount++;
                  if (chunkCount % 100 === 0) {
                    console.log(`[Clip ${i+1}] Decoded ${chunkCount} chunks. Queue: ${decoder.decodeQueueSize}`);
                  }
                }
              } finally {
                reader.releaseLock();
                await stream.cancel();
              }

              console.log(`[Clip ${i + 1}] Drained demuxer. Finalizing pipeline...`);
              setStatus(`Stitching ${i + 1}/${videos.length}: Finalizing...`);
              
              if (decoder.state === 'configured') {
                await decoder.flush();
              }
              
              await clipContext.encodingPromise;
              clipMaxTime = clipContext.clipMaxTime;
              
              if (decoder.state !== 'closed') {
                decoder.close();
              }
              
              console.log(`[Clip ${i + 1}] Decoder closed cleanly.`);
            }
          };

          const processAudio = async () => {
            if (targetAudioConfig && currentAudioConfig && 
                currentAudioConfig.codec === targetAudioConfig.codec &&
                currentAudioConfig.sampleRate === targetAudioConfig.sampleRate &&
                currentAudioConfig.numberOfChannels === targetAudioConfig.numberOfChannels) {
              console.log(`[Clip ${i + 1}] Audio compatible. Remuxing...`);
              
              const audioStream = demuxer.read('audio');
              const audioReader = audioStream.getReader();
              let audioChunkCount = 0;
              try {
                while (true) {
                  if (error) throw new Error(error);
                  const { done, value: chunk } = await readWithTimeout(audioReader);
                  if (done) break;

                  if (clipAudioOffset === null) clipAudioOffset = chunk.timestamp;
                  let timestamp = (chunk.timestamp - clipAudioOffset!) + accumulatedTimeMicros;
                  if (timestamp <= lastAudioDts) timestamp = lastAudioDts + 1;
                  lastAudioDts = timestamp;
                  const data = new Uint8Array(chunk.byteLength);
                  chunk.copyTo(data);
                  
                  try {
                    muxer!.addAudioChunk(new EncodedAudioChunk({
                      type: chunk.type,
                      timestamp,
                      duration: chunk.duration ?? undefined,
                      data
                    }), { decoderConfig: currentAudioConfig });
                  } catch (muxErr) {
                    console.error('[Muxer] Audio chunk error:', muxErr);
                    throw muxErr;
                  }

                  audioChunkCount++;
                }
              } finally {
                audioReader.releaseLock();
                await audioStream.cancel();
              }
            }
          };

          await Promise.all([processVideo(), processAudio()]);

          accumulatedTimeMicros += Math.max(clipMaxTime, Math.round(videoDuration * 1_000_000));
          console.log(`[Clip ${i + 1}] DONE. Accumulated Time: ${accumulatedTimeMicros}us`);
          setProgress(Math.round(((i + 1) / videos.length) * 90));
        } finally {
          await demuxer.destroy();
        }
      }

      setStatus('Finalizing video...');
      console.log('[Finalize] Flushing encoder...');
      setProgress(95);
      await encoder.flush();
      muxer.finalize();
      
      console.log('[Finalize] Muxer finalized. Triggering download.');
      const { buffer } = muxer.target as ArrayBufferTarget;
      const blob = new Blob([buffer], { type: 'video/mp4' });
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = 'stitched_video.mp4';
      a.click();
      
      setProgress(100);
      setIsDone(true);
      setStatus('Finished!');
      console.log('--- STITCH ENGINE COMPLETE ---');
    } catch (err) {
      console.error('[Engine] FATAL ERROR:', err);
      setError(err instanceof Error ? err.message : 'An unexpected error occurred.');
    } finally {
      setProcessing(false);
      if (encoder && encoder.state !== 'closed') encoder.close();
    }
  };


  if (!loaded) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Stitch</h1>
          <p>Initializing engine...</p>
          <Loader2 className={styles.spinner} size={48} />
        </div>
      </div>
    );
  }

  if (!browserSupported) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Stitch</h1>
          <div className={styles.successCard} style={{ borderColor: '#ef4444' }}>
            <AlertTriangle size={48} color="#ef4444" />
            <h2>Browser Not Supported</h2>
            <p>Your browser doesn't support WebCodecs. Please use a modern version of Chrome, Edge, or Opera.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1>Stitch</h1>
        <p>Combine videos in your browser. Fast, private, and free.</p>
      </div>

      {error && (
        <div className={styles.errorBanner}>
          <AlertTriangle size={20} />
          <span>{error}</span>
          <button onClick={() => setError(null)} className={styles.closeError}>
            <X size={16} />
          </button>
        </div>
      )}

      {!processing && !isDone && (
        <div 
          className={`${styles.dropzone} ${videos.length > 0 ? styles.dropzoneSmall : ''}`} 
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload size={videos.length > 0 ? 32 : 48} color="#2563eb" style={{ marginBottom: '0.5rem' }} />
          <p>{videos.length > 0 ? 'Add more videos' : 'Tap to add videos'}</p>
          <input
            type="file"
            multiple
            accept="video/*"
            ref={fileInputRef}
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />
        </div>
      )}

      {isDone && !processing && (
        <div className={styles.successCard}>
          <CheckCircle2 size={48} color="#10b981" />
          <h2>Successfully Stitched!</h2>
          <p>Your download should have started automatically.</p>
          <button onClick={() => setIsDone(false)} className={styles.secondaryBtn}>
            Start New Project
          </button>
        </div>
      )}

      {videos.length > 0 && !processing && !isDone && (
        <div className={styles.listHeader}>
          <h3>{videos.length} Videos Added</h3>
          <button onClick={clearVideos} className={styles.clearBtn}>
            <Trash2 size={16} />
            Clear All
          </button>
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={videos.map(v => v.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className={styles.videoList}>
            {videos.map((video) => (
              <SortableVideoItem
                key={video.id}
                id={video.id}
                file={video.file}
                onRemove={removeVideo}
                disabled={processing}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {videos.length > 0 && !isDone && (
        <div className={styles.controls}>
          <button
            onClick={concatenate}
            disabled={processing || videos.length < 2}
            className={styles.primaryBtn}
          >
            {processing ? (
              <>
                <Loader2 className={styles.spinnerSmall} size={20} />
                Processing...
              </>
            ) : (
              <>
                <Play size={20} />
                Stitch {videos.length} Videos
              </>
            )}
          </button>

          {processing && (
            <div className={styles.progressContainer}>
              <div className={styles.progressBar}>
                <div className={styles.progressFill} style={{ width: `${progress}%` }} />
              </div>
              <p className={styles.status}>{status} ({progress}%)</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
