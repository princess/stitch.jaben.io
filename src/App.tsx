import React, { useState, useRef, useEffect } from 'react';
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
import { GripVertical, X, Play, Loader2, Upload, CheckCircle2, AlertTriangle, Trash2, RefreshCw, Copy } from 'lucide-react';
import styles from './App.module.css';

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
  
  const currentPassId = useRef(0);
  const globalErrorFlag = useRef<Error | null>(null);

  const updateUI = (passId: number, newStatus?: string, newProgress?: number) => {
    if (passId !== currentPassId.current) return;
    if (newStatus !== undefined) {
      console.log(`[Pass ${passId}] Status:`, newStatus);
      setStatus(newStatus);
    }
    if (newProgress !== undefined) setProgress(newProgress);
  };

  const isMobile = typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

  const [error, setError] = useState<string | null>(null);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [showDebug, setShowDebug] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopyLogs = () => {
    const logText = debugLogs.join('\n');
    navigator.clipboard.writeText(logText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  const [isDone, setIsDone] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addDebugLog = (msg: string) => {
    setDebugLogs(prev => [...prev.slice(-39), `${new Date().toLocaleTimeString()}: ${msg}`]);
  };

  useEffect(() => {
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
      console.error('[Watchdog] Global Error:', e.message);
      if (processing) {
        globalErrorFlag.current = new Error(`Browser Hardware Error: ${e.message}`);
      } else {
        setError(`Error: ${e.message}`);
      }
    };
    const handleRejection = (e: PromiseRejectionEvent) => {
      const msg = e.reason?.message || String(e.reason);
      console.error('[Watchdog] Unhandled Rejection:', msg);
      if (processing) {
        globalErrorFlag.current = new Error(`Browser Rejection: ${msg}`);
      } else {
        setError(`Rejection: ${msg}`);
      }
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);

    return () => {
      console.log = originalLog;
      console.error = originalError;
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, [processing]);

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

  /**
   * The core engine.
   */
  const runStitchEngine = async (isSafeMode: boolean, passId: number, signal: AbortSignal) => {
    console.log(`--- STARTING PASS ${passId} (Safe: ${isSafeMode}) ---`);
    const wasmUrl = new URL('/wasm-files/web-demuxer.wasm', window.location.origin).href;
    
    let encoder: VideoEncoder | null = null;
    let audioEncoder: AudioEncoder | null = null;
    let muxer: Muxer<ArrayBufferTarget> | null = null;

    let engineReject: (err: any) => void;
    const enginePromise = new Promise<void>((_, reject) => { engineReject = reject; });

    const checkFatal = () => {
      if (signal.aborted) throw new Error('Pass aborted.');
      if (globalErrorFlag.current) throw globalErrorFlag.current;
      if (passId !== currentPassId.current) throw new Error('Pass replaced.');
    };

    try {
      checkFatal();

      // 1. Initial Metadata Pass
      const initialDemuxer = new WebDemuxer({ wasmFilePath: wasmUrl });
      let targetWidth: number, targetHeight: number, targetCodec: string;
      let targetAudioConfig: AudioDecoderConfig | null = null;

      try {
        await initialDemuxer.load(videos[0].file);
        const targetConfig = await initialDemuxer.getDecoderConfig('video');
        targetWidth = targetConfig.codedWidth!;
        targetHeight = targetConfig.codedHeight!;
        targetCodec = targetConfig.codec;
        try { targetAudioConfig = await initialDemuxer.getDecoderConfig('audio'); } catch { /* no audio */ }
      } finally {
        await initialDemuxer.destroy();
      }

      // 2. Output Muxer
      const finalCodec = isSafeMode ? 'avc' : ((targetCodec.startsWith('hev') || targetCodec.startsWith('hvc')) ? 'hevc' : 'avc');
      muxer = new Muxer({
        target: new ArrayBufferTarget(),
        video: { codec: finalCodec, width: targetWidth, height: targetHeight },
        audio: targetAudioConfig ? { 
          codec: 'aac', 
          sampleRate: targetAudioConfig.sampleRate, 
          numberOfChannels: targetAudioConfig.numberOfChannels 
        } : undefined,
        fastStart: 'in-memory'
      });

      // 3. Setup Encoders
      encoder = new VideoEncoder({
        output: (chunk, meta) => muxer!.addVideoChunk(chunk, meta),
        error: (e) => engineReject(new Error(`Encoder rejection: ${e.message}`))
      });

      const vConfig: VideoEncoderConfig = {
        // Safe mode uses AVC Main profile Level 5.2 (supports 4K)
        codec: finalCodec === 'hevc' ? 'hev1.1.6.L120.90' : 'avc1.4D4034',
        width: targetWidth, height: targetHeight, bitrate: 5_000_000, framerate: 30,
        hardwareAcceleration: (isSafeMode || isMobile) ? 'prefer-software' : 'prefer-hardware'
      };
      
      console.log('[Init] VideoEncoder Config:', vConfig);
      
      try {
        const vSupport = await VideoEncoder.isConfigSupported(vConfig);
        console.log('[Init] VideoEncoder Support:', vSupport);
        
        const finalVConfig = vSupport.supported && !isSafeMode ? vConfig : { ...vConfig, hardwareAcceleration: 'prefer-software' as const };
        encoder.configure(finalVConfig);
        console.log('[Init] VideoEncoder Configured:', finalVConfig.codec, finalVConfig.hardwareAcceleration);
      } catch (e: any) {
        console.error('[Init] Encoder Configuration Failed. Trying ultra-safe Baseline fallback.', e);
        // Ultra-safe fallback: Baseline Level 4.0 (1080p)
        encoder.configure({
          codec: 'avc1.42E028',
          width: targetWidth, height: targetHeight, bitrate: 2_000_000, framerate: 30,
          hardwareAcceleration: 'prefer-software'
        });
      }

      if (targetAudioConfig) {
        audioEncoder = new AudioEncoder({
          output: (chunk, meta) => muxer!.addAudioChunk(chunk, meta),
          error: (e) => engineReject(new Error(`AudioEncoder rejection: ${e.message}`))
        });
        audioEncoder.configure({ 
          codec: 'mp4a.40.2', 
          numberOfChannels: targetAudioConfig.numberOfChannels, 
          sampleRate: targetAudioConfig.sampleRate, 
          bitrate: 128_000 
        });
      }

      // 4. Main Processing Loop
      let accumulatedTimeMicros = 0;
      let accumulatedAudioTimeMicros = 0;
      const canvas = new OffscreenCanvas(targetWidth, targetHeight);
      const ctx = canvas.getContext('2d', { alpha: false })!;

      const loop = async () => {
        for (let i = 0; i < videos.length; i++) {
          checkFatal();
          const demuxer = new WebDemuxer({ wasmFilePath: wasmUrl });
          try {
            updateUI(passId, isSafeMode ? `Compatibility Pass: ${i+1}/${videos.length}` : `Fast Pass: ${i+1}/${videos.length}`);
            await demuxer.load(videos[i].file);
            const currentConfig = await demuxer.getDecoderConfig('video');
            const mediaInfo = await demuxer.getMediaInfo();
            const videoDuration = mediaInfo.duration;
            let currentAudioConfig: AudioDecoderConfig | null = null;
            try { currentAudioConfig = await demuxer.getDecoderConfig('audio'); } catch { /* no audio */ }

            let clipVideoMaxTime = 0, clipAudioMaxTime = 0;

            const processVideo = async () => {
              let offset: number | null = null, frameCount = 0;
              const decoder = new VideoDecoder({
                output: (frame) => {
                  if (passId !== currentPassId.current) { frame.close(); return; }
                  if (offset === null) offset = frame.timestamp;
                  const ts = (frame.timestamp - offset) + accumulatedTimeMicros;
                  
                  ctx.fillStyle = 'black'; ctx.fillRect(0, 0, targetWidth, targetHeight);
                  const ar = frame.displayWidth / frame.displayHeight, tar = targetWidth / targetHeight;
                  let dw = targetWidth, dh = targetHeight, ox = 0, oy = 0;
                  if (ar > tar) { dh = targetWidth / ar; oy = (targetHeight - dh) / 2; }
                  else { dw = targetHeight * ar; ox = (targetWidth - dw) / 2; }
                  ctx.drawImage(frame, ox, oy, dw, dh);
                  
                  const fte = new VideoFrame(canvas, { timestamp: ts, duration: frame.duration || 33333 });
                  if (encoder?.state === 'configured') {
                    encoder.encode(fte, { keyFrame: frameCount % 60 === 0 });
                    frameCount++;
                  }
                  clipVideoMaxTime = Math.max(clipVideoMaxTime, (ts - accumulatedTimeMicros) + (frame.duration || 33333));
                  fte.close(); frame.close();
                },
                error: (e) => engineReject(new Error(`Decoder rejection: ${e.message}`))
              });
              const dConfig: VideoDecoderConfig = {
                ...currentConfig,
                hardwareAcceleration: isSafeMode ? 'prefer-software' : 'prefer-hardware'
              };

              const dSupport = await VideoDecoder.isConfigSupported(dConfig);
              if (dSupport.supported) {
                decoder.configure(dConfig);
              } else {
                console.warn('[Process] VideoDecoder software configuration not supported. Falling back to hardware.', dConfig.codec);
                decoder.configure({ ...dConfig, hardwareAcceleration: 'prefer-hardware' });
              }
              const reader = demuxer.read('video').getReader();
              try {
                while (true) {
                  checkFatal();
                  if (decoder.decodeQueueSize > 16 || (encoder && encoder.encodeQueueSize > 16)) {
                    await new Promise(r => setTimeout(r, 10));
                    continue;
                  }
                  const { done, value: chunk } = await reader.read();
                  if (done) break;
                  decoder.decode(chunk);
                  if (frameCount % 30 === 0) {
                    updateUI(passId, undefined, Math.round(((i + Math.min(1, frameCount / (videoDuration * 30))) / videos.length) * 90));
                    await new Promise(r => setTimeout(r, 0));
                  }
                }
                if (passId === currentPassId.current) { await decoder.flush(); decoder.close(); }
              } finally { reader.releaseLock(); }
            };

            const processAudio = async () => {
              if (!audioEncoder || !currentAudioConfig) return;
              let offset: number | null = null;
              const audioDecoder = new AudioDecoder({
                output: (data) => {
                  if (passId !== currentPassId.current) { data.close(); return; }
                  if (offset === null) offset = data.timestamp;
                  const ts = (data.timestamp - offset) + accumulatedAudioTimeMicros;
                  if (audioEncoder?.state === 'configured') audioEncoder.encode(data);
                  clipAudioMaxTime = Math.max(clipAudioMaxTime, (ts - accumulatedAudioTimeMicros) + (data.duration || 0));
                  data.close();
                },
                error: (e) => engineReject(new Error(`AudioDecoder rejection: ${e.message}`))
              });
              audioDecoder.configure(currentAudioConfig);
              const reader = demuxer.read('audio').getReader();
              try {
                while (true) {
                  checkFatal();
                  if (audioDecoder.decodeQueueSize > 16 || (audioEncoder && audioEncoder.encodeQueueSize > 16)) {
                    await new Promise(r => setTimeout(r, 10));
                    continue;
                  }
                  const { done, value: chunk } = await reader.read();
                  if (done) break;
                  audioDecoder.decode(chunk);
                }
                if (passId === currentPassId.current) { await audioDecoder.flush(); audioDecoder.close(); }
              } finally { reader.releaseLock(); }
            };

            await Promise.all([processVideo(), processAudio()]);
            checkFatal();
            accumulatedTimeMicros += clipVideoMaxTime;
            accumulatedAudioTimeMicros += clipAudioMaxTime;
          } finally { await demuxer.destroy(); }
        }

        checkFatal();
        await encoder!.flush();
        if (audioEncoder) await audioEncoder.flush();
        muxer!.finalize();
        
        const { buffer } = muxer!.target as ArrayBufferTarget;
        const downloadUrl = URL.createObjectURL(new Blob([buffer], { type: 'video/mp4' }));
        const a = document.createElement('a'); a.href = downloadUrl; a.download = 'stitched_video.mp4'; a.click();
        updateUI(passId, 'Finished!', 100); setIsDone(true);
      };

      await Promise.race([loop(), enginePromise]);

    } finally {
      if (encoder && encoder.state !== 'closed') try { encoder.close(); } catch {}
      if (audioEncoder && audioEncoder.state !== 'closed') try { audioEncoder.close(); } catch {}
    }
  };

  /**
   * The UI wrapper.
   */
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleConcatenate = async () => {
    if (videos.length < 2) { setError('Please add at least 2 videos.'); return; }
    
    setProcessing(true);
    setError(null);
    setIsDone(false);
    setProgress(0);

    const startPass = async (isSafe: boolean) => {
      currentPassId.current++;
      const passId = currentPassId.current;
      
      if (abortControllerRef.current) abortControllerRef.current.abort();
      abortControllerRef.current = new AbortController();
      const signal = abortControllerRef.current.signal;

      globalErrorFlag.current = null;
      
      try {
        await runStitchEngine(isSafe, passId, signal);
      } catch (err: any) {
        if (passId !== currentPassId.current) return;

        const realError = globalErrorFlag.current || err;

        if (!isSafe) {
          console.warn(`[Pass ${passId}] Failed. Retrying in Compatibility Mode...`, realError);
          updateUI(passId, 'Hardware rejection detected. Switching to Compatibility Mode...', 0);
          await new Promise(r => setTimeout(r, 1500));
          return startPass(true);
        }
        
        console.error(`[Pass ${passId}] FATAL:`, realError);
        setError(`Fatal Error: ${realError.message || 'The browser hardware rejected the video data twice.'}`);
      } finally {
        if (passId === currentPassId.current) {
          setProcessing(false);
        }
      }
    };

    await startPass(false);
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
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.25rem'
            }}
          >
            <RefreshCw size={12} />
            Hard Reset
          </button>
        </div>
      )}

      {(processing || error || debugLogs.length > 0) && (
        <div style={{ marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '0.5rem' }}>
            <button 
              onClick={() => setShowDebug(!showDebug)}
              style={{ 
                background: 'none', 
                border: 'none', 
                color: '#64748b', 
                fontSize: '0.75rem', 
                textDecoration: 'underline', 
                cursor: 'pointer'
              }}
            >
              {showDebug ? 'Hide Debug Logs' : 'Show Debug Logs'}
            </button>
          </div>
          
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', borderBottom: '1px solid #334155', paddingBottom: '0.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <div style={{ fontWeight: 'bold' }}>Debug Logs:</div>
                  <button
                    onClick={handleCopyLogs}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: copied ? '#4ade80' : '#94a3b8',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.25rem',
                      fontSize: '0.75rem',
                      padding: '2px 4px',
                      borderRadius: '4px',
                      transition: 'color 0.2s'
                    }}
                    title="Copy logs to clipboard"
                  >
                    <Copy size={12} />
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                {processing && (
                  <button 
                    onClick={() => {
                      const err = new Error('SIMULATED HARDWARE CRASH');
                      console.error('[Manual] Triggering simulated crash...');
                      globalErrorFlag.current = err;
                      // We don't have direct access to abortControllerRef here, but globalErrorFlag will be caught in next loop check
                    }}
                    style={{ background: '#991b1b', color: 'white', border: 'none', borderRadius: '4px', padding: '2px 6px', fontSize: '10px' }}
                  >
                    Simulate Crash
                  </button>
                )}
              </div>
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
            onClick={() => handleConcatenate()}
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
              <p className={styles.status} data-testid="engine-status">{status} ({progress}%)</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
