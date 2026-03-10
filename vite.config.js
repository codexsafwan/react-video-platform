import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

// Custom Vite plugin to handle local video uploads during development
const videoUploadPlugin = () => ({
  name: 'video-upload-plugin',
  configureServer(server) {
    server.middlewares.use('/api/upload-local', (req, res, next) => {
      if (req.method !== 'POST') {
        return next();
      }

      const filename = req.headers['x-file-name'] || `video-${Date.now()}.webm`;
      const isFirst = req.headers['x-is-first'] === 'true';

      const __dirname = path.dirname(new URL(import.meta.url).pathname);
      // Ensure uploads directory exists
      const uploadDir = path.resolve(__dirname, 'uploads');
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      const filepath = path.resolve(uploadDir, filename);

      // If it's the first chunk, overwrite any existing file. Otherwise, append.
      const flags = isFirst ? 'w' : 'a';
      const fileStream = fs.createWriteStream(filepath, { flags });

      req.pipe(fileStream);

      req.on('end', () => {
        res.statusCode = 200;
        res.end(JSON.stringify({ success: true, message: `Chunk appended to ${filename}` }));
      });

      req.on('error', (err) => {
        console.error('File stream error:', err);
        res.statusCode = 500;
        res.end(JSON.stringify({ error: 'Failed to write chunk' }));
      });
    });
  }
});

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), videoUploadPlugin()],
})
