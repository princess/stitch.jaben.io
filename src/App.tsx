import React, { useState, useRef, useEffect } from 'react';
// Mediabunny and WebDemuxer are now handled in the WebWorker for flawless UI performance.
import { WebDemuxer as DefaultWebDemuxer } from 'web-demuxer';
import { WASM_BASE64 } from './wasm_data';

const WebDemuxer = (typeof window !== 'undefined' && (window as any).WebDemuxer) || DefaultWebDemuxer;

let cachedAppWasmUrl: string | null = null;
const getAppWasmUrl = () => {
  if (cachedAppWasmUrl) return cachedAppWasmUrl;
  const binaryString = atob(WASM_BASE64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'application/wasm' });
  cachedAppWasmUrl = URL.createObjectURL(blob);
  return cachedAppWasmUrl;
};

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
  const [loaded, setLoaded] = useState(false);
  const [videos, setVideos] = useState<VideoFile[]>([]);

  // ATOMIC PEAK: State Persistence
  useEffect(() => {
    setLoaded(true);
  }, []);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [isStressing, setIsStressing] = useState(false);
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
  const [streamToDisk, setStreamToDisk] = useState(false);
  const [canStreamToDisk] = useState(() => typeof window !== 'undefined' && 'showSaveFilePicker' in window);

  const handleCopyLogs = () => {
    const logText = debugLogs.join('\n');
    navigator.clipboard.writeText(logText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const runStitchStressTest = async () => {
    if (videos.length < 1) {
      setError('Please add at least 1 video to run the stress test.');
      return;
    }
    setIsStressing(true);
    setShowDebug(true);
    addDebugLog('--- STARTING HARDWARE STRESS TEST ---');
    
    // Test 1: Encoder Flood
    addDebugLog('[Stress] Stage 1: Encoder Flooding...');
    try {
      const vConfig: VideoEncoderConfig = {
        codec: 'avc1.4D4034',
        width: 1920, height: 1080, bitrate: 10_000_000, framerate: 60,
        hardwareAcceleration: 'prefer-hardware'
      };
      const encoder = new VideoEncoder({
        output: () => {},
        error: (e) => addDebugLog(`[Stress] Encoder Error: ${e.message}`)
      });
      encoder.configure(vConfig);
      addDebugLog('[Stress] 1080p/60fps/High-Profile Configured.');
      encoder.close();
    } catch (e) {
      addDebugLog(`[Stress] Stage 1 FAILED: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Test 2: Memory Pressure (Simulated)
    addDebugLog('[Stress] Stage 2: Parallel Context Pressure...');
    const ctxs = [];
    try {
      for (let i = 0; i < 5; i++) {
        const canvas = new OffscreenCanvas(2000, 2000);
        const ctx = canvas.getContext('2d');
        ctxs.push({ canvas, ctx });
      }
      addDebugLog('[Stress] Allocated 5x 2K OffscreenCanvases.');
    } catch (e) {
      addDebugLog(`[Stress] Memory Pressure Hit: ${e instanceof Error ? e.message : String(e)}`);
    }

    addDebugLog('--- STRESS TEST COMPLETE ---');
    setIsStressing(false);
  };

  const [isDone, setIsDone] = useState(false);
  const [totalDuration, setTotalDuration] = useState(0);
  const [previewTime, setPreviewTime] = useState(0);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const calculateDuration = async () => {
      const wasmUrl = getAppWasmUrl();
      let duration = 0;
      for (const v of videos) {
        const demuxer = new WebDemuxer({ wasmFilePath: wasmUrl });
        try {
          await demuxer.load(v.file);
          const info = await demuxer.getMediaInfo();
          duration += info.duration || 0;
        } finally {
          await demuxer.destroy();
        }
      }
      setTotalDuration(duration);
    };
    if (videos.length > 0) calculateDuration();
    else setTotalDuration(0);
  }, [videos]);

  useEffect(() => {
    if (!previewCanvasRef.current || videos.length === 0 || processing) return;

    const renderPreview = async () => {
      const wasmUrl = getAppWasmUrl();
      const ctx = previewCanvasRef.current?.getContext('2d');
      if (!ctx) return;

      let accumulated = 0;
      let targetVideo = videos[0];
      let relativeTime = previewTime;

      for (const v of videos) {
        const demuxer = new WebDemuxer({ wasmFilePath: wasmUrl });
        try {
          await demuxer.load(v.file);
          const info = await demuxer.getMediaInfo();
          const d = info.duration || 0;
          if (previewTime >= accumulated && previewTime <= accumulated + d) {
             targetVideo = v;
             relativeTime = previewTime - accumulated;
             break;
          }
          accumulated += d;
        } finally {
          await demuxer.destroy();
        }
      }

      const demuxer = new WebDemuxer({ wasmFilePath: wasmUrl });
      try {
        await demuxer.load(targetVideo.file);
        const config = await demuxer.getDecoderConfig('video');
        const decoder = new VideoDecoder({
          output: (frame) => {
            if (previewCanvasRef.current) {
              const canvas = previewCanvasRef.current;
              canvas.width = frame.displayWidth;
              canvas.height = frame.displayHeight;
              ctx.drawImage(frame, 0, 0);
            }
            frame.close();
          },
          error: (e) => console.error(e)
        });
        decoder.configure(config);
        await demuxer.seek('video', relativeTime);
        const reader = demuxer.read('video').getReader();
        const { value } = await reader.read();
        if (value) {
          decoder.decode(value);
          await decoder.flush();
        }
        decoder.close();
        reader.releaseLock();
      } finally {
        await demuxer.destroy();
      }
    };

    const timer = setTimeout(renderPreview, 100);
    return () => clearTimeout(timer);
  }, [previewTime, videos, processing]);

  const addDebugLog = (msg: string) => {
    setDebugLogs(prev => [...prev.slice(-39), `${new Date().toLocaleTimeString()}: ${msg}`]);
  };

  useEffect(() => {
    const logHardwareCapabilities = async () => {
      console.log('--- DEVICE DIAGNOSTICS ---');
      console.log('User Agent:', navigator.userAgent);
      console.log('Hardware Concurrency:', navigator.hardwareConcurrency);
      // @ts-ignore
      console.log('Device Memory:', navigator.deviceMemory, 'GB');

      const videoConfigs: VideoEncoderConfig[] = [
        { codec: 'avc1.42E028', width: 1920, height: 1080, bitrate: 5_000_000, framerate: 30 }, // Baseline
        { codec: 'avc1.4D4034', width: 1920, height: 1080, bitrate: 5_000_000, framerate: 30 }, // Main
        { codec: 'hev1.1.6.L120.90', width: 1920, height: 1080, bitrate: 5_000_000, framerate: 30 } // HEVC
      ];

      for (const config of videoConfigs) {
        try {
          const support = await VideoEncoder.isConfigSupported(config);
          console.log(`Support [${config.codec}]:`, support.supported ? 'YES' : 'NO', `(HW: ${support.config?.hardwareAcceleration})`);
        } catch (e) {
          console.log(`Support [${config.codec}]: ERROR`, e instanceof Error ? e.message : String(e));
        }
      }
      console.log('--- END DIAGNOSTICS ---');
    };

    logHardwareCapabilities();

    const originalLog = console.log;
    const originalError = console.error;
    
    const stringifyArgs = (args: unknown[]) => {
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
      if ('vibrate' in navigator) navigator.vibrate(10); // Subtle tactile feedback
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

  const workerRef = useRef<Worker | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  const requestWakeLock = async () => {
    if ('wakeLock' in navigator) {
      try {
        wakeLockRef.current = await (navigator as unknown as { wakeLock: { request: (type: string) => Promise<WakeLockSentinel> } }).wakeLock.request('screen');
        console.log('[System] Screen Wake Lock acquired.');
      } catch (err) {
        console.warn('[System] Wake Lock failed:', err instanceof Error ? err.message : String(err));
      }
    }
  };

  const releaseWakeLock = async () => {
    if (wakeLockRef.current) {
      try {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
        console.log('[System] Screen Wake Lock released.');
      } catch (err) {
        console.error('[System] Wake Lock release error:', err instanceof Error ? err.message : String(err));
      }
    }
  };

  useEffect(() => {
    let stayAliveInterval: any = null;
    let audioCtx: AudioContext | null = null;

    const startStayAlive = () => {
      if (stayAliveInterval) return;
      console.log('[System] Activating Background Persistence...');
      
      try {
        audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const oscillator = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        gain.gain.value = 0.001;
        oscillator.connect(gain);
        gain.connect(audioCtx.destination);
        oscillator.start();
        console.log('[System] Audio Heartbeat Active.');
      } catch (e) {
        console.warn('[System] Audio Heartbeat failed:', e);
      }

      stayAliveInterval = setInterval(() => {
        if (processing) {
          document.title = document.title;
        }
      }, 1000);
    };

    const stopStayAlive = () => {
      if (stayAliveInterval) clearInterval(stayAliveInterval);
      if (audioCtx) audioCtx.close();
      stayAliveInterval = null;
      audioCtx = null;
      console.log('[System] Background Persistence deactivated.');
    };

    const handleVisibility = async () => {
      if (document.visibilityState === 'visible' && processing && !wakeLockRef.current) {
        await requestWakeLock();
      }
    };

    if (processing) startStayAlive();
    else stopStayAlive();

    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      stopStayAlive();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [processing]);

  const handleConcatenate = async () => {
    if (videos.length < 2) { setError('Please add at least 2 videos.'); return; }
    
    let diskWritable: any = null;
    if (streamToDisk) {
      try {
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: 'stitched_video.mp4',
          types: [{
            description: 'Video File',
            accept: { 'video/mp4': ['.mp4'] }
          }]
        });
        diskWritable = await handle.createWritable();
      } catch (err: any) {
        if (err.name === 'AbortError') return;
        setError(`Failed to start disk stream: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
    }

    setProcessing(true);
    setError(null);
    setIsDone(false);
    setProgress(0);
    await requestWakeLock();

    const startPass = async (isSafe: boolean) => {
      currentPassId.current++;
      const passId = currentPassId.current;
      
      if (workerRef.current) {
        workerRef.current.postMessage({ type: 'ABORT' });
        workerRef.current.terminate();
      }

      updateUI(passId, 'Initializing engine...', 0);

      const worker = new Worker(new URL('./stitch.worker.ts', import.meta.url), { type: 'module' });
      workerRef.current = worker;

      worker.onerror = (err) => {
        if (passId !== currentPassId.current) return;
        console.error('[Worker] Fatal Thread Crash:', err);
        setError('The processing thread crashed. Retrying in Compatibility Mode...');
        worker.terminate();
        startPass(true);
      };

      worker.onmessage = async (e) => {
        const { type, payload } = e.data;

        if (type === 'UPDATE_UI') {
          if (payload.passId !== currentPassId.current) return;
          updateUI(payload.passId, payload.newStatus, payload.newProgress);
        } else if (type === 'LOG') {
          console.log(payload);
        } else if (type === 'DISK_WRITE') {
          if (diskWritable) {
            await diskWritable.write(payload);
          }
        } else if (type === 'COMPLETE') {
          if (passId !== currentPassId.current) return;
          
          if (diskWritable) {
            await diskWritable.close();
            diskWritable = null;
          }

          if (payload) {
             const downloadUrl = URL.createObjectURL(new Blob([payload], { type: 'video/mp4' }));
             const a = document.createElement('a'); a.href = downloadUrl; a.download = 'stitched_video.mp4'; a.click();
          }
          
          updateUI(passId, 'Finished!', 100);
          setIsDone(true);
          setProcessing(false);
          await releaseWakeLock();
          if ('vibrate' in navigator) navigator.vibrate([50, 30, 50]);
          worker.terminate();
        } else if (type === 'ERROR') {
          if (passId !== currentPassId.current) return;
          
          console.error(`[Pass ${passId}] Error:`, payload);
          if (!isSafe) {
            updateUI(passId, 'Hardware rejection detected. Retrying in Compatibility Mode...', 0);
            await new Promise(r => setTimeout(r, 1500));
            worker.terminate();
            return startPass(true);
          }
          
          if (diskWritable) {
            try { await diskWritable.close(); } catch {}
            diskWritable = null;
          }

          setError(`Fatal Error: ${payload}`);
          setProcessing(false);
          await releaseWakeLock();
          worker.terminate();
        }
      };

      worker.postMessage({
        type: 'START',
        payload: {
          videos: videos.map(v => ({ file: v.file, id: v.id })),
          isSafeMode: isSafe,
          isMobile,
          passId,
          useDiskStream: !!diskWritable
        }
      });
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

      {videos.length > 0 && !processing && !isDone && (
        <div style={{ background: '#000', borderRadius: '0.5rem', overflow: 'hidden', marginBottom: '1.5rem', border: '1px solid #334155' }}>
          <canvas 
            ref={previewCanvasRef} 
            style={{ width: '100%', height: 'auto', display: 'block', maxHeight: '300px', objectFit: 'contain' }} 
          />
          <div style={{ padding: '1rem', background: '#1e293b' }}>
            <input 
              type="range" 
              min="0" 
              max={totalDuration} 
              step="0.01"
              value={previewTime}
              onChange={(e) => setPreviewTime(parseFloat(e.target.value))}
              style={{ width: '100%', accentColor: '#38bdf8', cursor: 'pointer' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem', color: '#94a3b8', fontSize: '0.75rem', fontFamily: 'monospace' }}>
              <span>{(previewTime / 1000000).toFixed(2)}s</span>
              <span>{(totalDuration / 1000000).toFixed(2)}s</span>
            </div>
          </div>
        </div>
      )}

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
                    }}
                    style={{ background: '#991b1b', color: 'white', border: 'none', borderRadius: '4px', padding: '2px 6px', fontSize: '10px' }}
                  >
                    Simulate Crash
                  </button>
                )}
                <button 
                  onClick={runStitchStressTest}
                  disabled={isStressing || videos.length === 0}
                  style={{ 
                    background: isStressing ? '#475569' : '#0f172a', 
                    color: 'white', 
                    border: '1px solid #334155', 
                    borderRadius: '4px', 
                    padding: '2px 8px', 
                    fontSize: '10px',
                    cursor: isStressing ? 'not-allowed' : 'pointer',
                    marginLeft: '4px'
                  }}
                >
                  {isStressing ? 'Stressing...' : 'Run Hardware Stress Test'}
                </button>
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
          {!processing && canStreamToDisk && (
            <label style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '0.5rem', 
              fontSize: '0.875rem', 
              color: '#64748b', 
              cursor: 'pointer',
              marginBottom: '0.5rem'
            }}>
              <input 
                type="checkbox" 
                checked={streamToDisk} 
                onChange={(e) => setStreamToDisk(e.target.checked)} 
              />
              <span>Stream to Disk (Recommended for large files)</span>
            </label>
          )}
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
