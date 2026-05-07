import { EncodedPacket } from 'mediabunny';

class EncodedAudioChunk {
  constructor(init) {
    this.type = init.type;
    this.timestamp = init.timestamp;
    this.duration = init.duration;
    this.byteLength = 4;
    this.data = init.data;
  }
  copyTo(buf) { buf.set([1,2,3,4]); }
}
globalThis.EncodedAudioChunk = EncodedAudioChunk;

class EncodedVideoChunk {
  constructor(init) {
    this.type = init.type;
    this.timestamp = init.timestamp;
    this.duration = init.duration;
    this.byteLength = 4;
    this.data = init.data;
  }
  copyTo(buf) { buf.set([1,2,3,4]); }
}
globalThis.EncodedVideoChunk = EncodedVideoChunk;

const chunk = new EncodedAudioChunk({
  type: 'key',
  timestamp: 1000000,
  duration: 500000,
  data: new Uint8Array([1,2,3,4])
});

try {
  const packet = EncodedPacket.fromEncodedChunk(chunk);
  console.log("Packet timestamp:", packet.timestamp, typeof packet.timestamp);
  console.log("Packet duration:", packet.duration, typeof packet.duration);
} catch (e) {
  console.error("Error:", e.message);
}
