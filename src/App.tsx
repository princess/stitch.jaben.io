import React, { useState, useRef } from 'react';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { WebDemuxer } from 'web-demuxer';

 
if (typeof window !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

interface VideoFile {
  id: string;
  file: File;
}

// Helper to compare extradata/description buffers
const areBuffersEqual = (a: AllowSharedBufferSource | undefined, b: AllowSharedBufferSource | undefined) => {
  if (a === b) return true;
  if (!a || !b) return false;
  const isSharedA = typeof SharedArrayBuffer !== 'undefined' && a instanceof SharedArrayBuffer;
  const isSharedB = typeof SharedArrayBuffer !== 'undefined' && b instanceof SharedArrayBuffer;
  const viewA = new Uint8Array(a instanceof ArrayBuffer || isSharedA ? (a as ArrayBuffer | SharedArrayBuffer) : (a as ArrayBufferView).buffer);
  const viewB = new Uint8Array(b instanceof ArrayBuffer || isSharedB ? (b as ArrayBuffer | SharedArrayBuffer) : (b as ArrayBufferView).buffer);
  if (viewA.length !== viewB.length) return false;
  for (let i = 0; i < viewA.length; i++) {
    if (viewA[i] !== viewB[i]) return false;
  }
  return true;
};

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
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [showDebug, setShowDebug] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addDebugLog = (msg: string) => {
    setDebugLogs(prev => [...prev.slice(-29), `${new Date().toLocaleTimeString()}: ${msg}`]);
  };

  React.useEffect(() => {
    const originalLog = console.log;
    const originalError = console.error;
    
    const stringifyArgs = (args: any[]) => {
      return args.map(arg => {
        if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
        if (arg instanceof DOMException) return `DOMException: ${arg.name} - ${arg.message}`;
        if (typeof arg === 'object') {
          try { return JSON.stringify(arg); } catch { return String(arg); }
        }
        return String(arg);
      }).join(' ');
    };

    console.log = (...args) => {
      addDebugLog(stringifyArgs(args));
      originalLog(...args);
    };
    console.error = (...args) => {
      addDebugLog('ERROR: ' + stringifyArgs(args));
      originalError(...args);
    };

    const handleError = (e: ErrorEvent) => {
      setError(`Global Error: ${e.message}`);
    };
    const handleRejection = (e: PromiseRejectionEvent) => {
      setError(`Unhandled Rejection: ${e.reason?.message || String(e.reason)}`);
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);

    return () => {
      console.log = originalLog;
      console.error = originalError;
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const newFiles = Array.from(e.target.files).map(file => ({
        id: Math.random().toString(36).substr(2, 9),
        file
      }));
      setVideos(prev => [...prev, ...newFiles]);
      setIsDone(false);
      setError(null);
      e.target.value = '';
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
    if (videos.length < 2) {
      setError('Please add at least 2 videos to stitch.');
      return;
    }
    setProcessing(true);
    setIsDone(false);
    setError(null);
    setProgress(0);

    console.log('--- STITCH ENGINE STARTING ---');
    let muxer: Muxer<ArrayBufferTarget> | null = null;

    try {
      setStatus('Initializing Engine...');
      const wasmUrl = new URL('/wasm-files/web-demuxer.wasm', window.location.origin).href;
      
      const initialDemuxer = new WebDemuxer({ wasmFilePath: wasmUrl });
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

        try {
          targetAudioConfig = await initialDemuxer.getDecoderConfig('audio');
          console.log(`[Init] Audio Detected: ${targetAudioConfig.codec}`);
        } catch { /* No audio */ }
      } finally {
        await initialDemuxer.destroy();
      }

      muxer = new Muxer({
        target: new ArrayBufferTarget(),
        video: {
          codec: (targetCodec.startsWith('hev') || targetCodec.startsWith('hvc')) ? 'hevc' : 'avc',
          width: targetWidth,
          height: targetHeight
        },
        audio: targetAudioConfig ? {
          codec: targetAudioConfig.codec.startsWith('mp4a') ? 'aac' : 'opus',
          sampleRate: targetAudioConfig.sampleRate,
          numberOfChannels: targetAudioConfig.numberOfChannels
        } : undefined,
        fastStart: 'in-memory'
      });

      let accumulatedTimeMicros = 0;
      let lastDts = -1;
      let lastAudioDts = -1;

      for (let i = 0; i < videos.length; i++) {
        const videoFile = videos[i].file;
        console.log(`[Clip ${i + 1}/${videos.length}] --- STARTING CLIP: ${videoFile.name} ---`);
        
        const demuxer = new WebDemuxer({ wasmFilePath: wasmUrl });

        try {
          setStatus(`Loading clip ${i + 1}/${videos.length}...`);
          await demuxer.load(videoFile);
          const currentConfig = await demuxer.getDecoderConfig('video');
          const mediaInfo = await demuxer.getMediaInfo();
          const videoDuration = mediaInfo.duration;

          let currentAudioConfig: AudioDecoderConfig | null = null;
          try {
            currentAudioConfig = await demuxer.getDecoderConfig('audio');
          } catch { /* No audio */ }

          const isCompatible = currentConfig.codec === targetCodec &&
            currentConfig.codedWidth === targetWidth &&
            currentConfig.codedHeight === targetHeight &&
            areBuffersEqual(currentConfig.description, targetDescription);

          console.log(`[Clip ${i + 1}] Path: ${isCompatible ? 'FAST' : 'SLOW (Not supported yet)'}`);
          if (!isCompatible) throw new Error(`Clip ${i+1} is incompatible with first clip resolution/codec.`);

          let clipMaxTime = 0;
          let clipVideoOffset: number | null = null;
          let clipAudioOffset: number | null = null;

          const processVideo = async () => {
            const stream = demuxer.read('video');
            const reader = stream.getReader();
            let chunkCount = 0;
            let batchStartTime = performance.now();
            try {
              while (true) {
                if (error) throw new Error(error);
                const { done, value: chunk } = await reader.read();
                if (done) break;
                
                if (clipVideoOffset === null) clipVideoOffset = chunk.timestamp;
                let timestamp = (chunk.timestamp - clipVideoOffset!) + accumulatedTimeMicros;
                if (timestamp <= lastDts) timestamp = lastDts + 1;
                lastDts = timestamp;

                const data = new Uint8Array(chunk.byteLength);
                chunk.copyTo(data);
                
                muxer!.addVideoChunk(new EncodedVideoChunk({
                  type: chunk.type,
                  timestamp,
                  duration: chunk.duration ?? undefined,
                  data
                }), { decoderConfig: currentConfig });

                clipMaxTime = Math.max(clipMaxTime, timestamp - accumulatedTimeMicros + (chunk.duration ?? 0));
                
                chunkCount++;
                if (chunkCount % 100 === 0) {
                  const now = performance.now();
                  console.log(`[Clip ${i+1}] Video: 100 chunks in ${Math.round(now - batchStartTime)}ms`);
                  batchStartTime = now;
                  const currentVideoProgress = videoDuration > 0 ? Math.min(chunk.timestamp / (videoDuration * 1_000_000), 1) : 0;
                  setProgress(Math.round(((i + currentVideoProgress) / videos.length) * 90));
                  // YIELD to UI
                  await new Promise(r => setTimeout(r, 0));
                }
              }
            } finally {
              reader.releaseLock();
            }
          };

          const processAudio = async () => {
            if (targetAudioConfig && currentAudioConfig && 
                currentAudioConfig.codec === targetAudioConfig.codec &&
                currentAudioConfig.sampleRate === targetAudioConfig.sampleRate &&
                currentAudioConfig.numberOfChannels === targetAudioConfig.numberOfChannels) {
              const stream = demuxer.read('audio');
              const reader = stream.getReader();
              let audioChunkCount = 0;
              try {
                while (true) {
                  if (error) throw new Error(error);
                  const { done, value: chunk } = await reader.read();
                  if (done) break;

                  if (clipAudioOffset === null) clipAudioOffset = chunk.timestamp;
                  let timestamp = (chunk.timestamp - clipAudioOffset!) + accumulatedTimeMicros;
                  if (timestamp <= lastAudioDts) timestamp = lastAudioDts + 1;
                  lastAudioDts = timestamp;
                  
                  const data = new Uint8Array(chunk.byteLength);
                  chunk.copyTo(data);
                  
                  muxer!.addAudioChunk(new EncodedAudioChunk({
                    type: chunk.type,
                    timestamp,
                    duration: chunk.duration ?? undefined,
                    data
                  }), { decoderConfig: currentAudioConfig });
                  
                  audioChunkCount++;
                  if (audioChunkCount % 100 === 0) {
                    await new Promise(r => setTimeout(r, 0));
                  }
                }
              } finally {
                reader.releaseLock();
              }
            }
          };

          await Promise.all([processVideo(), processAudio()]);
          accumulatedTimeMicros += Math.max(clipMaxTime, Math.round(videoDuration * 1_000_000));
        } finally {
          await demuxer.destroy();
        }
      }

      setStatus('Finalizing...');
      muxer.finalize();
      const { buffer } = muxer.target as ArrayBufferTarget;
      const downloadUrl = URL.createObjectURL(new Blob([buffer], { type: 'video/mp4' }));
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = 'stitched_video.mp4';
      a.click();
      
      setProgress(100);
      setIsDone(true);
      setStatus('Finished!');
    } catch (err: any) {
      console.error('[Engine] FATAL ERROR:', err);
      setError(err.message || 'An unexpected error occurred.');
    } finally {
      setProcessing(false);
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
          <span style={{ whiteSpace: 'pre-wrap' }}>{error}</span>
          <button onClick={() => setError(null)} className={styles.closeError}>
            <X size={16} />
          </button>
          <button 
            onClick={() => window.location.reload()} 
            style={{ 
              marginLeft: '0.5rem', 
              background: '#991b1b', 
              color: 'white', 
              border: 'none', 
              padding: '0.25rem 0.5rem', 
              borderRadius: '0.25rem', 
              fontSize: '0.75rem', 
              cursor: 'pointer' 
            }}
          >
            Reload Page
          </button>
        </div>
      )}

      {(processing || error || debugLogs.length > 0) && (
        <div style={{ marginBottom: '1.5rem' }}>
          <button 
            onClick={() => setShowDebug(!showDebug)}
            style={{ 
              background: 'none', 
              border: 'none', 
              color: '#64748b', 
              fontSize: '0.75rem', 
              textDecoration: 'underline', 
              cursor: 'pointer',
              marginBottom: '0.5rem'
            }}
          >
            {showDebug ? 'Hide Debug Logs' : 'Show Debug Logs'}
          </button>
          
          {showDebug && (
            <div style={{ 
              background: '#1e293b', 
              color: '#38bdf8', 
              padding: '1rem', 
              borderRadius: '0.5rem', 
              fontSize: '0.75rem', 
              fontFamily: 'monospace',
              maxHeight: '250px',
              overflowY: 'auto'
            }}>
              <div style={{ fontWeight: 'bold', marginBottom: '0.5rem', borderBottom: '1px solid #334155' }}>Debug Logs:</div>
              {debugLogs.map((log, i) => <div key={i}>{log}</div>)}
            </div>
          )}
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
