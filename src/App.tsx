import React, { useState, useRef } from 'react';
import { Muxer, ArrayBufferTarget, type MuxerOptions } from 'mp4-muxer';
import { WebDemuxer } from 'web-demuxer';
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
import { GripVertical, X, Play, Loader2, Upload, CheckCircle2, AlertTriangle } from 'lucide-react';
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

  const concatenate = async () => {
    if (videos.length < 2) return;
    setProcessing(true);
    setIsDone(false);
    setError(null);
    setProgress(0);

    let encoder: VideoEncoder | null = null;
    const demuxer = new WebDemuxer({
      wasmFilePath: `${window.location.origin}/wasm-files/web-demuxer.wasm`
    });

    try {
      setStatus('Initializing...');
      
      // Get dimensions from first video to use as target resolution
      await demuxer.load(videos[0].file);
      const targetConfig = await demuxer.getDecoderConfig('video');
      const targetWidth = targetConfig.codedWidth;
      const targetHeight = targetConfig.codedHeight;
      const targetCodec = targetConfig.codec;
      const targetDescription = targetConfig.description ? new Uint8Array(targetConfig.description as ArrayBuffer).slice().buffer : undefined;

      if (!targetWidth || !targetHeight) {
        throw new Error('Invalid video dimensions detected.');
      }

      // Check for audio
      let targetAudioConfig: AudioDecoderConfig | null = null;
      try {
        targetAudioConfig = await demuxer.getDecoderConfig('audio');
      } catch {
        // No audio track
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

      const muxer = new Muxer(muxerConfig);

      encoder = new VideoEncoder({
        output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
        error: (e) => {
          console.error('VideoEncoder error:', e);
          setError('Encoder error: ' + e.message);
        }
      });

      // avc1.4d002a = Main Profile, Level 4.2 (supports 1080p @ 60fps)
      // hev1.1.6.L120.90 = Main Profile, Level 4.0 (for HEVC)
      const encoderCodec = isHevc ? 'hev1.1.6.L120.90' : 'avc1.4d002a';

      const baseEncoderConfig: VideoEncoderConfig = {
        codec: encoderCodec,
        width: targetWidth,
        height: targetHeight,
        bitrate: 4_000_000, // Reduced from 5Mbps for better mobile performance/speed
        framerate: 30,
      };
      
      const optimizedEncoderConfig: VideoEncoderConfig = {
        ...baseEncoderConfig,
        latencyMode: 'realtime', // Keep low latency for faster pipeline flow
        hardwareAcceleration: 'prefer-hardware',
      };

      const support = await VideoEncoder.isConfigSupported(optimizedEncoderConfig);
      if (support.supported) {
        encoder.configure(optimizedEncoderConfig);
      } else {
        const baseSupport = await VideoEncoder.isConfigSupported(baseEncoderConfig);
        if (!baseSupport.supported) {
          throw new Error(`Video configuration not supported by this browser: ${targetWidth}x${targetHeight}`);
        }
        encoder.configure(baseEncoderConfig);
      }

      let accumulatedTimeMicros = 0;
      let lastDts = -1;
      let lastAudioDts = -1;
      const canvas = new OffscreenCanvas(targetWidth, targetHeight);
      const ctx = canvas.getContext('2d', { alpha: false })!;

      for (let i = 0; i < videos.length; i++) {
        const videoFile = videos[i].file;
        await demuxer.load(videoFile);
        const currentMediaInfo = await demuxer.getMediaInfo();
        const videoDuration = currentMediaInfo.duration;
        const currentConfig = await demuxer.getDecoderConfig('video');
        
        let currentAudioConfig: AudioDecoderConfig | null = null;
        try {
          currentAudioConfig = await demuxer.getDecoderConfig('audio');
        } catch {
          // No audio
        }

        let clipMaxTime = 0;
        let clipVideoOffset: number | null = null;
        let clipAudioOffset: number | null = null;

        // Check compatibility
        const isCompatible = currentConfig.codec === targetCodec &&
          currentConfig.codedWidth === targetWidth &&
          currentConfig.codedHeight === targetHeight &&
          areBuffersEqual(currentConfig.description, targetDescription);

        // Remux audio if available and compatible
        const remuxAudio = async () => {
          if (
            targetAudioConfig && 
            currentAudioConfig && 
            currentAudioConfig.codec === targetAudioConfig.codec &&
            currentAudioConfig.sampleRate === targetAudioConfig.sampleRate &&
            currentAudioConfig.numberOfChannels === targetAudioConfig.numberOfChannels
          ) {
            const audioStream = demuxer.read('audio');
            const audioReader = audioStream.getReader();
            while (true) {
              const { done, value: chunk } = await audioReader.read();
              if (done) break;

              if (clipAudioOffset === null) clipAudioOffset = chunk.timestamp;
              let timestamp = (chunk.timestamp - clipAudioOffset) + accumulatedTimeMicros;
              
              if (timestamp <= lastAudioDts) {
                timestamp = lastAudioDts + 1;
              }
              lastAudioDts = timestamp;

              const data = new Uint8Array(chunk.byteLength);
              chunk.copyTo(data);
              const newChunk = new EncodedAudioChunk({
                type: chunk.type,
                timestamp: timestamp,
                duration: chunk.duration ?? undefined,
                data: data
              });

              muxer.addAudioChunk(newChunk, { decoderConfig: currentAudioConfig });
            }
          }
        };

        if (isCompatible) {
          // Fast Path (Remuxing)
          const stream = demuxer.read('video');
          const reader = stream.getReader();
          
          while (true) {
            const { done, value: chunk } = await reader.read();
            if (done) break;
            
            if (clipVideoOffset === null) clipVideoOffset = chunk.timestamp;
            let timestamp = (chunk.timestamp - clipVideoOffset) + accumulatedTimeMicros;

            if (timestamp <= lastDts) {
              timestamp = lastDts + 1;
            }
            lastDts = timestamp;

            const data = new Uint8Array(chunk.byteLength);
            chunk.copyTo(data);
            const newChunk = new EncodedVideoChunk({
              type: chunk.type,
              timestamp: timestamp,
              duration: chunk.duration ?? undefined,
              data: data
            });

            muxer.addVideoChunk(newChunk, { decoderConfig: currentConfig });
            clipMaxTime = Math.max(clipMaxTime, timestamp - accumulatedTimeMicros + (chunk.duration ?? 0));

            // Update progress
            const currentVideoProgress = Math.min(chunk.timestamp / (videoDuration * 1_000_000), 1);
            const totalProgress = ((i + currentVideoProgress) / videos.length) * 90;
            setProgress(Math.round(totalProgress));
            setStatus(`Stitching video ${i + 1}/${videos.length}: ${Math.round(currentVideoProgress * 100)}% (Fast)`);
          }
        } else {
          // Slow Path (Transcoding)
          let frameCount = 0;
          const decoder = new VideoDecoder({
            output: async (frame) => {
              if (clipVideoOffset === null) clipVideoOffset = frame.timestamp;
              const timestampMicros = (frame.timestamp - clipVideoOffset) + accumulatedTimeMicros;
              
              let frameToEncode: VideoFrame;
              clipMaxTime = Math.max(clipMaxTime, timestampMicros - accumulatedTimeMicros + (frame.duration ?? 0));

              if (frame.displayWidth === targetWidth && frame.displayHeight === targetHeight) {
                // Optimization: If dimensions match exactly, we can skip drawImage
                frameToEncode = new VideoFrame(frame, {
                  timestamp: timestampMicros,
                  duration: frame.duration || undefined
                });
              } else {
                // Clear to black for pillarboxing/letterboxing
                ctx.fillStyle = 'black';
                ctx.fillRect(0, 0, targetWidth, targetHeight);

                const videoWidth = frame.displayWidth;
                const videoHeight = frame.displayHeight;
                const videoAspectRatio = videoWidth / videoHeight;
                const targetAspectRatio = targetWidth / targetHeight;

                let drawWidth = targetWidth;
                let drawHeight = targetHeight;
                let offsetX = 0;
                let offsetY = 0;

                if (videoAspectRatio > targetAspectRatio) {
                  // Video is wider than target: letterbox
                  drawHeight = targetWidth / videoAspectRatio;
                  offsetY = (targetHeight - drawHeight) / 2;
                } else {
                  // Video is taller than target: pillarbox
                  drawWidth = targetHeight * videoAspectRatio;
                  offsetX = (targetWidth - drawWidth) / 2;
                }

                ctx.drawImage(frame, offsetX, offsetY, drawWidth, drawHeight);
                
                frameToEncode = new VideoFrame(canvas, {
                  timestamp: timestampMicros,
                  duration: frame.duration || undefined
                });
              }
              
              // Encoder Backpressure Handling
              if (encoder!.encodeQueueSize > 20) {
                await new Promise(r => setTimeout(r, 10));
              }

              encoder!.encode(frameToEncode, { keyFrame: frameCount % 120 === 0 });
              frameToEncode.close();
              frame.close();
              frameCount++;
            },
            error: (e) => {
              console.error('VideoDecoder error:', e);
              setError('Decoder error: ' + e.message);
            }
          });

          decoder.configure(currentConfig);

          const stream = demuxer.read('video');
          const reader = stream.getReader();
          
          while (true) {
            const { done, value: chunk } = await reader.read();
            if (done) break;
            
            decoder.decode(chunk);

            // Update progress
            const currentVideoProgress = Math.min(chunk.timestamp / (videoDuration * 1_000_000), 1);
            const totalProgress = ((i + currentVideoProgress) / videos.length) * 90;
            setProgress(Math.round(totalProgress));
            setStatus(`Stitching video ${i + 1}/${videos.length}: ${Math.round(currentVideoProgress * 100)}%`);
          }

          await decoder.flush();
          decoder.close();
        }

        await remuxAudio();
        
        accumulatedTimeMicros += Math.max(clipMaxTime, Math.round(videoDuration * 1_000_000));
      }

      setStatus('Finalizing video...');
      setProgress(95);
      await encoder.flush();
      muxer.finalize();
      
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
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'An unexpected error occurred during stitching.');
    } finally {
      setProcessing(false);
      demuxer.destroy();
      if (encoder && encoder.state !== 'closed') {
        encoder.close();
      }
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
