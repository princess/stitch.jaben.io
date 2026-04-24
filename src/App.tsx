import React, { useState, useRef } from 'react';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
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
      const mediaInfo = await demuxer.getMediaInfo();
      const videoStream = mediaInfo.streams.find(s => s.codec_type_string === 'video');
      
      if (!videoStream) {
        throw new Error('No video stream found in the first video.');
      }

      // H.264 requires even dimensions
      const targetWidth = videoStream.width & ~1;
      const targetHeight = videoStream.height & ~1;

      if (targetWidth === 0 || targetHeight === 0) {
        throw new Error('Invalid video dimensions detected.');
      }

      const muxer = new Muxer({
        target: new ArrayBufferTarget(),
        video: {
          codec: 'avc',
          width: targetWidth,
          height: targetHeight
        },
        fastStart: 'in-memory'
      });

      encoder = new VideoEncoder({
        output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
        error: (e) => {
          console.error('VideoEncoder error:', e);
          setError('Encoder error: ' + e.message);
        }
      });

      // avc1.4d002a = Main Profile, Level 4.2 (supports 1080p @ 60fps)
      const config: VideoEncoderConfig = {
        codec: 'avc1.4d002a',
        width: targetWidth,
        height: targetHeight,
        bitrate: 5_000_000, 
        framerate: 30,
      };

      const support = await VideoEncoder.isConfigSupported(config);
      if (!support.supported) {
        throw new Error(`Video configuration not supported by this browser: ${targetWidth}x${targetHeight}`);
      }

      encoder.configure(config);

      let accumulatedTimeMicros = 0;
      const canvas = new OffscreenCanvas(targetWidth, targetHeight);
      const ctx = canvas.getContext('2d', { alpha: false })!;

      for (let i = 0; i < videos.length; i++) {
        const videoFile = videos[i].file;
        await demuxer.load(videoFile);
        const currentMediaInfo = await demuxer.getMediaInfo();
        const videoDuration = currentMediaInfo.duration;
        const decoderConfig = await demuxer.getDecoderConfig('video');
        
        let frameCount = 0;
        const decoder = new VideoDecoder({
          output: (frame) => {
            ctx.drawImage(frame, 0, 0, targetWidth, targetHeight);
            const timestampMicros = frame.timestamp + accumulatedTimeMicros;
            
            const newFrame = new VideoFrame(canvas, {
              timestamp: timestampMicros,
              duration: frame.duration || undefined
            });
            
            encoder!.encode(newFrame, { keyFrame: frameCount % 60 === 0 });
            newFrame.close();
            frame.close();
            frameCount++;
          },
          error: (e) => {
            console.error('VideoDecoder error:', e);
            setError('Decoder error: ' + e.message);
          }
        });

        decoder.configure(decoderConfig);

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
        
        accumulatedTimeMicros += Math.round(videoDuration * 1_000_000);
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
