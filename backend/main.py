import os
import uuid
import boto3
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

# Load the .env from the parent directory (React root)
load_dotenv(dotenv_path="../.env")

app = FastAPI()

# Enable CORS for the React app on localhost:5173
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# S3 Configuration from environment variables
AWS_REGION = os.getenv("VITE_AWS_REGION", "us-east-1")
S3_BUCKET = os.getenv("VITE_AWS_S3_BUCKET", "")
AWS_ACCESS_KEY_ID = os.getenv("VITE_AWS_ACCESS_KEY_ID", "")
AWS_SECRET_ACCESS_KEY = os.getenv("VITE_AWS_SECRET_ACCESS_KEY", "")

# Initialize boto3 S3 Client
s3_client = boto3.client(
    "s3",
    region_name=AWS_REGION,
    aws_access_key_id=AWS_ACCESS_KEY_ID,
    aws_secret_access_key=AWS_SECRET_ACCESS_KEY
)

class UploadUrlRequest(BaseModel):
    asset_type: str
    mime_type: str
    filename: str

@app.post("/api/v2/interviews/{interview_id}/assets/upload-url")
def create_upload_url(interview_id: str, payload: UploadUrlRequest):
    if not S3_BUCKET:
        raise HTTPException(status_code=500, detail="S3_BUCKET not configured")

    # Generate a unique asset ID
    asset_id = str(uuid.uuid4())
    
    # We can use the filename from the payload, or generate one
    object_key = payload.filename

    try:
        # Generate the presigned URL for PUT object
        presigned_url = s3_client.generate_presigned_url(
            'put_object',
            Params={
                'Bucket': S3_BUCKET,
                'Key': object_key,
                'ContentType': payload.mime_type
            },
            ExpiresIn=3600 # 1 hour
        )
        
        # Generate the presigned URL for GET object (Playback)
        presigned_get_url = s3_client.generate_presigned_url(
            'get_object',
            Params={
                'Bucket': S3_BUCKET,
                'Key': object_key
            },
            ExpiresIn=3600 # 1 hour
        )
        
        return {
            "upload_url": presigned_url,
            "playback_url": presigned_get_url,
            "asset_id": asset_id
        }
    except Exception as e:
        print(f"Error generating presigned URL: {e}")
        raise HTTPException(status_code=500, detail="Could not generate presigned URL")


@app.post("/api/v2/interviews/assets/{asset_id}/confirm")
def confirm_upload(asset_id: str):
    # In a real app, you would verify the file exists in S3 or update your database
    # indicating that the asset with asset_id has been successfully uploaded.
    print(f"Upload confirmed for asset_id: {asset_id}")
    return {"message": "Upload confirmed successfully", "asset_id": asset_id}

@app.get("/")
def read_root():
    return {"status": "ok", "message": "Video Platform API is running"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
