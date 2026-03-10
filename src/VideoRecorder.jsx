import React, { useRef, useState } from "react";
import {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
} from "@aws-sdk/client-s3";

// Can be 'local' or 's3'
const UPLOAD_DESTINATION = import.meta.env.VITE_UPLOAD_DESTINATION || "local";

const BUCKET = import.meta.env.VITE_AWS_S3_BUCKET;

// Initialize the S3 client conditionally
const s3 = UPLOAD_DESTINATION === "s3" ? new S3Client({
  region: import.meta.env.VITE_AWS_REGION,
  credentials: {
    accessKeyId: import.meta.env.VITE_AWS_ACCESS_KEY_ID,
    secretAccessKey: import.meta.env.VITE_AWS_SECRET_ACCESS_KEY,
  },
}) : null;

export default function VideoRecorder() {
  const videoRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);

  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadedUrl, setUploadedUrl] = useState(null);

  // S3 / Local State Refs
  const uploadIdRef = useRef(null);
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

      // Reset upload state
      partNumberRef.current = 1;
      completedPartsRef.current = [];
      setUploadedUrl(null);

      // Generate a unique filename for this recording
      const filename = `video-${Date.now()}.webm`;
      filenameRef.current = filename;

      if (UPLOAD_DESTINATION === "s3") {
        // 1. Initialize S3 Multipart Upload
        const createCommand = new CreateMultipartUploadCommand({
          Bucket: BUCKET,
          Key: filename,
          ContentType: "video/webm",
        });
        
        const createResponse = await s3.send(createCommand);
        uploadIdRef.current = createResponse.UploadId;
      } else {
        // Local mode doesn't need upload initialization, just reset the ID
        uploadIdRef.current = "local-upload"; 
      }

      const recorder = new MediaRecorder(stream, {
        mimeType: "video/webm; codecs=vp9",
      });

      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = async (event) => {
        if (event.data.size > 0 && uploadIdRef.current) {
          await uploadChunk(event.data);
        }
      };

      recorder.start(3000); 
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
         await finishUpload();
    };
  };

  const uploadChunk = async (blob) => {
    try {
      setUploading(true);
      const currentPartNumber = partNumberRef.current;
      partNumberRef.current += 1; 

      if (UPLOAD_DESTINATION === "s3") {
        const uploadCommand = new UploadPartCommand({
          Bucket: BUCKET,
          Key: filenameRef.current,
          UploadId: uploadIdRef.current,
          PartNumber: currentPartNumber,
          Body: blob,
        });

        const response = await s3.send(uploadCommand);

        completedPartsRef.current.push({
          ETag: response.ETag,
          PartNumber: currentPartNumber,
        });
        console.log(`S3 Chunk ${currentPartNumber} uploaded successfully.`);

      } else {
        // Local Upload
        const isFirstChunk = currentPartNumber === 1;
        await fetch("/api/upload-local", {
          method: "POST",
          headers: {
             "x-file-name": filenameRef.current,
             "x-is-first": isFirstChunk.toString()
          },
          body: blob
        });
        console.log(`Local Chunk ${currentPartNumber} appended successfully.`);
      }

    } catch (error) {
      console.error("Upload failed:", error);
    } finally {
      setUploading(false);
    }
  };

  const finishUpload = async () => {
    try {
      setUploading(true);
      
      if (UPLOAD_DESTINATION === "s3") {
        console.log("Completing multipart upload...");
        const completeCommand = new CompleteMultipartUploadCommand({
          Bucket: BUCKET,
          Key: filenameRef.current,
          UploadId: uploadIdRef.current,
          MultipartUpload: {
            Parts: completedPartsRef.current.sort((a, b) => a.PartNumber - b.PartNumber),
          },
        });

        await s3.send(completeCommand);
        console.log("Upload complete!");
        
        const finalUrl = `https://${BUCKET}.s3.${import.meta.env.VITE_AWS_REGION}.amazonaws.com/${filenameRef.current}`;
        setUploadedUrl(finalUrl);
      } else {
        console.log("Local upload finished.");
        setUploadedUrl(`/uploads/${filenameRef.current} (Saved Locally)`);
      }

      uploadIdRef.current = null;

    } catch (error) {
      console.error("Failed to complete upload:", error);
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
          <p>Your video is available at (if bucket is public):</p>
          {UPLOAD_DESTINATION === "s3" ? (
             <a href={uploadedUrl} target="_blank" rel="noopener noreferrer" style={{ wordBreak: "break-all" }}>
               {uploadedUrl}
             </a>
          ) : (
             <span style={{ wordBreak: "break-all" }}>{uploadedUrl}</span>
          )}
        </div>
      )}
    </div>
  );
}