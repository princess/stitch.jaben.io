import React, { useState, useRef } from 'react';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
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

const SortableVideoItem = ({ id, file, onRemove }: { id: string; file: File; onRemove: (id: string) => void }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} className={styles.videoItem}>
      <div {...attributes} {...listeners} className={styles.dragHandle}>
        <GripVertical size={20} />
      </div>
      <span className={styles.fileName}>{file.name}</span>
      <button onClick={() => onRemove(id)} className={styles.removeBtn}>
        <X size={20} />
      </button>
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
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setVideos((items) => {
        const oldIndex = items.findIndex((i) => i.id === active.id);
        const newIndex = items.findIndex((i) => i.id === over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  const removeVideo = (id: string) => {
    setVideos(prev => prev.filter(v => v.id !== id));
    setIsDone(false);
  };

  const concatenate = async () => {
    if (videos.length < 2) return;
    setProcessing(true);
    setIsDone(false);
    setProgress(0);

    try {
      setStatus('Initializing...');
      
      // Get dimensions from first video to use as target resolution
      const firstVideo = document.createElement('video');
      const firstVideoUrl = URL.createObjectURL(videos[0].file);
      firstVideo.src = firstVideoUrl;
      await new Promise((resolve, reject) => {
        firstVideo.onloadedmetadata = resolve;
        firstVideo.onerror = reject;
      });
      const targetWidth = firstVideo.videoWidth;
      const targetHeight = firstVideo.videoHeight;
      URL.revokeObjectURL(firstVideoUrl);

      const muxer = new Muxer({
        target: new ArrayBufferTarget(),
        video: {
          codec: 'avc',
          width: targetWidth,
          height: targetHeight
        },
        fastStart: 'in-memory'
      });

      const encoder = new VideoEncoder({
        output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
        error: (e) => {
          console.error('VideoEncoder error:', e);
          setStatus('Encoder error: ' + e.message);
        }
      });

      const config: VideoEncoderConfig = {
        codec: 'avc1.42E01E', // Baseline profile for maximum compatibility
        width: targetWidth,
        height: targetHeight,
        bitrate: 5_000_000, // 5 Mbps
        framerate: 30,
      };

      const support = await VideoEncoder.isConfigSupported(config);
      if (!support.supported) {
        throw new Error('Video configuration not supported by this browser.');
      }

      encoder.configure(config);

      let accumulatedTime = 0;
      const fps = 30;
      const interval = 1 / fps;

      for (let i = 0; i < videos.length; i++) {
        const videoFile = videos[i].file;
        const url = URL.createObjectURL(videoFile);
        const video = document.createElement('video');
        video.src = url;
        video.muted = true;
        video.playsInline = true;
        
        await new Promise((resolve, reject) => {
          video.onloadedmetadata = resolve;
          video.onerror = reject;
        });
        
        const duration = video.duration;
        let currentTime = 0;
        
        const canvas = new OffscreenCanvas(targetWidth, targetHeight);
        const ctx = canvas.getContext('2d', { alpha: false })!;

        while (currentTime < duration) {
          video.currentTime = currentTime;
          await new Promise((resolve) => {
            video.onseeked = resolve;
          });
          
          ctx.drawImage(video, 0, 0, targetWidth, targetHeight);
          
          const timestampMicros = Math.round(accumulatedTime * 1_000_000);
          const durationMicros = Math.round(interval * 1_000_000);
          
          const frame = new VideoFrame(canvas, {
            timestamp: timestampMicros,
            duration: durationMicros
          });
          
          encoder.encode(frame, { keyFrame: Math.floor(currentTime * fps) % 60 === 0 });
          frame.close();
          
          currentTime += interval;
          accumulatedTime += interval;
          
          // Update progress
          const currentVideoProgress = currentTime / duration;
          const totalProgress = ((i + currentVideoProgress) / videos.length) * 90;
          setProgress(Math.round(totalProgress));
          setStatus(`Stitching video ${i + 1}/${videos.length}: ${Math.round(currentVideoProgress * 100)}%`);
        }
        
        URL.revokeObjectURL(url);
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
    } catch (error) {
      console.error(error);
      const errorMessage = error instanceof Error ? error.message : 'Error processing videos.';
      setStatus(errorMessage);
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

      {!processing && !isDone && (
        <div className={styles.dropzone} onClick={() => fileInputRef.current?.click()}>
          <Upload size={48} color="#2563eb" style={{ marginBottom: '1rem' }} />
          <p>Tap to add videos</p>
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
