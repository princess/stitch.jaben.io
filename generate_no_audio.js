
import fs from 'fs';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: {
        codec: 'avc',
        width: 640,
        height: 480
    },
    fastStart: 'in-memory'
});

// Add a single dummy video chunk
muxer.addVideoChunk({
    type: 'key',
    timestamp: 0,
    duration: 1000000,
    data: new Uint8Array([0, 0, 0, 1, 0x67, 0x42, 0, 0x1e, 0x96, 0x54, 0x05, 0xa1, 0xed, 0x00, 0xf3, 0x9f, 0x28, 0x08, 0, 0, 0, 1, 0x68, 0xce, 0x3c, 0x80, 0, 0, 0, 1, 0x65, 0xff])
}, {
    decoderConfig: {
        codec: 'avc1.42E01E',
        codedWidth: 640,
        codedHeight: 480,
        description: new Uint8Array([1, 0x42, 0, 0x1e, 0xff, 0xe1, 0, 0x10, 0x67, 0x42, 0, 0x1e, 0x96, 0x54, 0x05, 0xa1, 0xed, 0x00, 0xf3, 0x9f, 0x28, 0x08, 1, 0, 0x05, 0x68, 0xce, 0x3c, 0x80])
    }
});

muxer.finalize();

const { buffer } = muxer.target;
fs.writeFileSync('tests/fixtures/no_audio.mp4', Buffer.from(buffer));
console.log('Generated tests/fixtures/no_audio.mp4');
