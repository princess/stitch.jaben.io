# 🧵 Stitch: Client-Side Video Concatenator

**Stitch** is a completely serverless, browser-based video concatenation service. It allows users to merge multiple video files into a single video file, with full control over the sequence—all without uploading a single byte to a server.

## 🚀 Key Features

-   **Privacy First**: All video processing happens locally in your browser. Your videos never leave your computer.
-   **Universal Support**: Concatenate various video formats (MP4, WebM, MOV, etc.) into a standardized MP4 output using native browser capabilities.
-   **Drag & Drop**: Easily reorder your video clips using an intuitive, sortable interface.
-   **High Performance**: Powered by **WebCodecs**, utilizing your computer's hardware acceleration for fast encoding.
-   **No Special Headers**: Unlike FFmpeg.wasm based solutions, Stitch doesn't require Cross-Origin Isolation (COOP/COEP), making it compatible with any static hosting platform.
-   **Free & Open**: Hosted for free on GitHub Pages.

## 🛠️ Technology Stack

-   **Frontend**: React 19+ with TypeScript
-   **Build Tool**: Vite
-   **Video Processing**: [WebCodecs API](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API)
-   **Muxing**: [mp4-muxer](https://github.com/Vanilagy/mp4-muxer)
-   **Drag & Drop**: [@dnd-kit](https://dndkit.com/)
-   **Icons**: [Lucide React](https://lucide.dev/)
-   **Styling**: Vanilla CSS (CSS Modules)
-   **Testing**: Playwright
-   **Deployment**: GitHub Pages (via GitHub Actions)

## 🏗️ Architecture

### WebCodecs
The project uses the native `VideoEncoder` and `VideoFrame` APIs to process video frames. Each uploaded video is decoded using a hidden `HTMLVideoElement`, and frames are extracted via `OffscreenCanvas` before being sent to the hardware-accelerated encoder.

### mp4-muxer
Encoded video chunks are packaged into a standard MP4 container using the `mp4-muxer` library, which provides a lightweight and efficient way to create video files in the browser without the overhead of FFmpeg.

## 💻 Local Development

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/jaben/stitch.jaben.io.git
    cd stitch.jaben.io
    ```

2.  **Install dependencies**:
    ```bash
    npm install
    ```

3.  **Start the development server**:
    ```bash
    npm run dev
    ```

4.  **Run tests**:
    ```bash
    npx playwright test
    ```

5.  **Build for production**:
    ```bash
    npm run build
    ```

## 🚀 Deployment

### Automated Deployment (CI/CD)
This project includes a GitHub Action (`.github/workflows/deploy.yml`) that automatically builds and deploys the site to GitHub Pages whenever you push to the `main` branch.

## 📄 License

MIT

---
*Created with ❤️ by Jaben*
