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
  const chunkBufferSizeRef = useRef(0);
  const MIN_CHUNK_SIZE = 5 * 1024 * 1024; // 5MB

  // S3 Presigned Upload State
  const uploadIdRef = useRef(null);
  const assetIdRef = useRef(null);
  const filenameRef = useRef(null);
  const partNumberRef = useRef(1);
  const completedPartsRef = useRef([]);

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
      chunkBufferSizeRef.current = 0;
      partNumberRef.current = 1;
      completedPartsRef.current = [];
      uploadIdRef.current = null;
      assetIdRef.current = null;
      setUploadedUrl(null);

      const filename = `${interviewId}-video-${Date.now()}.webm`;
      filenameRef.current = filename;

      if (UPLOAD_DESTINATION === "s3") {
        console.log("Starting multipart upload with backend...");
        const startResponse = await fetch(`http://localhost:8000/api/v2/interviews/${interviewId}/assets/upload-url/start`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                asset_type: "video_recording",
                mime_type: "video/webm",
                filename: filename
            })
        });

        if (!startResponse.ok) throw new Error("Failed to start upload");
        const data = await startResponse.json();
        uploadIdRef.current = data.upload_id;
        assetIdRef.current = data.asset_id;
      }

      // Pick the best supported codec
      const mimeType = [
        "video/webm; codecs=vp9",
        "video/webm; codecs=vp8",
        "video/webm",
        "video/mp4",
      ].find((m) => MediaRecorder.isTypeSupported(m)) || "";

      const recorder = new MediaRecorder(stream, { mimeType });

      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = async (event) => {
        if (event.data.size > 0) {
            if (UPLOAD_DESTINATION === "s3") {
                chunkBufferRef.current.push(event.data);
                chunkBufferSizeRef.current += event.data.size;

                if (chunkBufferSizeRef.current >= MIN_CHUNK_SIZE && uploadIdRef.current) {
                    const combinedBlob = new Blob(chunkBufferRef.current, { type: "video/webm" });
                    chunkBufferRef.current = [];
                    chunkBufferSizeRef.current = 0;
                    await uploadChunk(combinedBlob);
                }
            } else {
                // Local Upload can handle smaller frames
                await uploadChunk(event.data);
            }
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
        chunkBufferSizeRef.current = 0;
        await uploadChunk(combinedBlob);
      }
      await finishUpload();
    };
  };

  const uploadChunk = async (blob) => {
    try {
        setUploading(true);
        const currentPartNumber = partNumberRef.current;
        partNumberRef.current += 1;

        if (UPLOAD_DESTINATION === "s3") {
            console.log(`Getting presigned URL for Part ${currentPartNumber}...`);
            const partResponse = await fetch(`http://localhost:8000/api/v2/interviews/${interviewId}/assets/upload-url/part`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    upload_id: uploadIdRef.current,
                    key: filenameRef.current,
                    part_number: currentPartNumber
                })
            });

            if (!partResponse.ok) throw new Error("Failed to get part URL");
            const { upload_url } = await partResponse.json();

            console.log(`Uploading Part ${currentPartNumber} to S3...`);
            // Convert to ArrayBuffer so the browser doesn't auto-add Content-Type,
            // which would cause a SignatureDoesNotMatch error with presigned upload_part URLs.
            const buffer = await blob.arrayBuffer();
            const putResponse = await fetch(upload_url, {
                method: "PUT",
                body: buffer
            });

            if (!putResponse.ok) throw new Error(`Failed to upload chunk: ${putResponse.statusText}`);
            
            // AWS S3 returns the ETag header for the uploaded part
            const etag = putResponse.headers.get("ETag");
            if (!etag) console.warn("ETag not found in S3 response! Check CORS ExposeHeaders config.");
            
            completedPartsRef.current.push({
                ETag: etag || 'mock-etag-if-cors-failed', // Fallback just so React doesn't crash, S3 will reject if invalid
                PartNumber: currentPartNumber
            });

        } else {
            console.log(`Starting local upload chunk ${currentPartNumber}...`);
            await fetch("/api/upload-local", {
                method: "POST",
                headers: {
                    "x-file-name": filenameRef.current,
                    "x-is-first": (currentPartNumber === 1).toString()
                },
                body: blob
            });
            console.log(`Local upload chunk ${currentPartNumber} finished.`);
        }
    } catch (error) {
        console.error("Upload chunk failed:", error);
    } finally {
        setUploading(false);
    }
  };

  const finishUpload = async () => {
    try {
        setUploading(true);

        if (UPLOAD_DESTINATION === "s3") {
            console.log("Completing multipart upload with backend...");
            const completeResponse = await fetch(`http://localhost:8000/api/v2/interviews/${interviewId}/assets/upload-url/complete`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    upload_id: uploadIdRef.current,
                    key: filenameRef.current,
                    parts: completedPartsRef.current
                })
            });

            if (!completeResponse.ok) throw new Error(`Failed to complete upload: ${completeResponse.statusText}`);
            const { playback_url } = await completeResponse.json();

            // Confirm Upload Flow (Optional tracking in backend DB)
            await fetch(`http://localhost:8000/api/v2/interviews/assets/${assetIdRef.current}/confirm`, {
                method: "POST"
            });

            console.log("Upload complete and confirmed!");
            setUploadedUrl(playback_url);
        } else {
            setUploadedUrl(`/uploads/${filenameRef.current}`);
        }
    } catch (error) {
        console.error("Failed finalization:", error);
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