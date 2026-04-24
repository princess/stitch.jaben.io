# 🧵 Stitch: Client-Side Video Concatenator

**Stitch** is a completely serverless, browser-based video concatenation service. It allows users to merge multiple video files of any type into a single video file, with full control over the sequence—all without uploading a single byte to a server.

## 🚀 Key Features

-   **Privacy First**: All video processing happens locally in your browser using WebAssembly. Your videos never leave your computer.
-   **Universal Support**: Concatenate various video formats (MP4, WebM, MOV, etc.) into a standardized MP4 output.
-   **Drag & Drop**: Easily reorder your video clips using an intuitive, sortable interface.
-   **High Performance**: Powered by **FFmpeg.wasm**, bringing the power of the industry-standard FFmpeg tool directly to the web.
-   **Free & Open**: Hosted for free on GitHub Pages.

## 🛠️ Technology Stack

-   **Frontend**: React 18+ with TypeScript
-   **Build Tool**: Vite
-   **Video Processing**: [FFmpeg.wasm](https://ffmpegwasm.netlify.app/)
-   **Drag & Drop**: [@dnd-kit](https://dndkit.com/)
-   **Icons**: [Lucide React](https://lucide.dev/)
-   **Styling**: Vanilla CSS (CSS Modules)
-   **Deployment**: GitHub Pages (via GitHub Actions)

## 🏗️ Architecture & Technical Challenges

### WebAssembly & SharedArrayBuffer
FFmpeg.wasm relies on `SharedArrayBuffer` for multi-threaded performance. Modern browsers require **Cross-Origin Isolation** (COOP/COEP headers) to enable this feature.

### GitHub Pages Workaround
Since GitHub Pages doesn't allow custom HTTP headers, this project uses `coi-serviceworker`. This service worker intercepts network requests and injects the required headers, allowing FFmpeg.wasm to function correctly on static hosting platforms.

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

4.  **Build for production**:
    ```bash
    npm run build
    ```

## 🚀 Deployment

### Automated Deployment (CI/CD)
This project includes a GitHub Action (`.github/workflows/deploy.yml`) that automatically builds and deploys the site to GitHub Pages whenever you push to the `main` branch.

### Manual Deployment
If you prefer to deploy manually:
1. Update the `homepage` field in `package.json`.
2. Run: `npm run deploy`

## 📄 License

MIT

---
*Created with ❤️ by Jaben*
