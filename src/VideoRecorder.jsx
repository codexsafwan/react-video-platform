import React, { useRef, useState } from "react";

// Can be 'local' or 's3'
const UPLOAD_DESTINATION = import.meta.env.VITE_UPLOAD_DESTINATION || "local";

export default function VideoRecorder({ interviewId = "test-interview-id" }) {
  const videoRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);

  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadedUrl, setUploadedUrl] = useState(null);

  // Buffer Ref
  const chunkBufferRef = useRef([]);

  // start camera + recording
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });

      streamRef.current = stream;
      videoRef.current.srcObject = stream;

      // Reset state
      chunkBufferRef.current = [];
      setUploadedUrl(null);

      const recorder = new MediaRecorder(stream, {
        mimeType: "video/webm; codecs=vp9",
      });

      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunkBufferRef.current.push(event.data);
        }
      };

      recorder.start(1000); // 1 second intervals
      setRecording(true);
    } catch (error) {
      console.error("Recording error:", error);
      alert("Error starting recording. Please check console and permissions.");
    }
  };

  // stop recording
  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
       mediaRecorderRef.current.stop();
    }
    
    streamRef.current.getTracks().forEach((track) => track.stop());
    setRecording(false);
    
    mediaRecorderRef.current.onstop = async () => {
      if (chunkBufferRef.current.length > 0) {
        const combinedBlob = new Blob(chunkBufferRef.current, { type: "video/webm" });
        chunkBufferRef.current = [];
        await uploadVideo(combinedBlob);
      }
    };
  };

  const uploadVideo = async (blob) => {
    try {
      setUploading(true);
      const filename = `${interviewId}-video-${Date.now()}.webm`;

      if (UPLOAD_DESTINATION === "s3") {
        console.log("Getting presigned URL from backend...");
        
        // 1. Get presigned URL from Backend
        const uploadUrlResponse = await fetch(`http://localhost:8000/api/v2/interviews/${interviewId}/assets/upload-url`, {
          method: "POST",
          headers: {
            "accept": "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            asset_type: "video_recording",
            mime_type: "video/webm",
            filename: filename,
          }),
        });
        
        if (!uploadUrlResponse.ok) {
           throw new Error(`Failed to get upload URL: ${uploadUrlResponse.statusText}`);
        }

        const { upload_url, playback_url, asset_id } = await uploadUrlResponse.json();

        // 2. Upload Video to Presigned URL
        console.log("Uploading video to S3...");
        const putResponse = await fetch(upload_url, {
          method: "PUT",
          body: blob,
        });

        if (!putResponse.ok) {
          throw new Error(`Failed to upload to S3: ${putResponse.statusText}`);
        }

        // 3. Confirm Upload
        console.log("Confirming upload with backend...");
        const confirmResponse = await fetch(`http://localhost:8000/api/v2/interviews/assets/${asset_id}/confirm`, {
          method: "POST",
          headers: {
            "accept": "application/json",
          },
        });

        if (!confirmResponse.ok) {
           throw new Error(`Failed to confirm upload: ${confirmResponse.statusText}`);
        }
        
        console.log("Upload complete and confirmed!");
        // The backend generates a secure presigned GET URL for playback
        setUploadedUrl(playback_url);

      } else {
        // Local Upload
        console.log("Starting local upload...");
        await fetch("/api/upload-local", {
          method: "POST",
          headers: {
             "x-file-name": filename,
             "x-is-first": "true" // Local middleware might need adjustments since we're sending it all at once now
          },
          body: blob
        });
        console.log("Local upload finished.");
        setUploadedUrl(`/uploads/${filename}`);
      }

    } catch (error) {
      console.error("Upload failed:", error);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div style={{ padding: 20 }}>
      <h2>React Instant Video Upload ({UPLOAD_DESTINATION.toUpperCase()} Mode)</h2>
      
      {UPLOAD_DESTINATION === "s3" && !import.meta.env.VITE_AWS_ACCESS_KEY_ID && (
        <div style={{ color: "red", marginBottom: 10 }}>
          <strong>Warning:</strong> AWS credentials are not set in the .env file. Direct upload will fail.
        </div>
      )}

      <video
        ref={videoRef}
        autoPlay
        muted
        style={{
          width: "500px",
          border: "1px solid #ddd",
          borderRadius: "8px",
          display: "block",
          marginBottom: "10px"
        }}
      />

      <div style={{ display: "flex", gap: "10px", alignItems: "center", marginTop: 20 }}>
        {!recording ? (
          <button 
             onClick={startRecording}
             style={{ padding: "10px 20px", background: "blue", color: "white", border: "none", borderRadius: "4px", cursor: "pointer" }}
           >
            Start Recording
          </button>
        ) : (
          <button 
             onClick={stopRecording}
             style={{ padding: "10px 20px", background: "red", color: "white", border: "none", borderRadius: "4px", cursor: "pointer" }}
          >
            Stop Recording
          </button>
        )}
        
        {uploading && <span style={{ color: "#666" }}>Uploading chunk...</span>}
      </div>

      {uploadedUrl && (
        <div style={{ marginTop: 20, padding: 15, background: "#000", borderRadius: "8px" }}>
          <strong>Upload Successful!</strong>
          <p>Your video is available at (presigned link expires in 1 hour):</p>
          {UPLOAD_DESTINATION === "s3" ? (
             <a href={uploadedUrl} target="_blank" rel="noopener noreferrer" style={{ wordBreak: "break-all", display: "block", marginBottom: "10px" }}>
               {uploadedUrl}
             </a>
          ) : (
             <span style={{ wordBreak: "break-all", display: "block", marginBottom: "10px" }}>{uploadedUrl} (Saved Locally)</span>
          )}
          <video
            src={uploadedUrl}
            controls
            style={{
              width: "100%",
              maxWidth: "500px",
              border: "1px solid #ddd",
              borderRadius: "8px",
              display: "block",
              marginTop: "10px"
            }}
          />
        </div>
      )}
    </div>
  );
}