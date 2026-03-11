import os
import uuid
from typing import List
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
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["ETag"],
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

class StartMultipartUploadRequest(BaseModel):
    asset_type: str
    mime_type: str
    filename: str

@app.post("/api/v2/interviews/{interview_id}/assets/upload-url/start")
def start_multipart_upload(interview_id: str, payload: StartMultipartUploadRequest):
    if not S3_BUCKET:
        raise HTTPException(status_code=500, detail="S3_BUCKET not configured")

    asset_id = str(uuid.uuid4())
    object_key = payload.filename

    try:
        response = s3_client.create_multipart_upload(
            Bucket=S3_BUCKET,
            Key=object_key,
            ContentType=payload.mime_type
        )
        
        return {
            "upload_id": response["UploadId"],
            "asset_id": asset_id,
            "key": object_key
        }
    except Exception as e:
        print(f"Error starting multipart upload: {e}")
        raise HTTPException(status_code=500, detail="Could not start multipart upload")

class UploadPartRequest(BaseModel):
    upload_id: str
    key: str
    part_number: int

@app.post("/api/v2/interviews/{interview_id}/assets/upload-url/part")
def get_upload_part_url(interview_id: str, payload: UploadPartRequest):
    try:
        presigned_url = s3_client.generate_presigned_url(
            'upload_part',
            Params={
                'Bucket': S3_BUCKET,
                'Key': payload.key,
                'UploadId': payload.upload_id,
                'PartNumber': payload.part_number
            },
            ExpiresIn=3600
        )
        return {"upload_url": presigned_url}
    except Exception as e:
        print(f"Error generating part URL: {e}")
        raise HTTPException(status_code=500, detail="Could not generate upload part URL")

class CompletedPart(BaseModel):
    ETag: str
    PartNumber: int

class CompleteUploadRequest(BaseModel):
    upload_id: str
    key: str
    parts: List[CompletedPart]

@app.post("/api/v2/interviews/{interview_id}/assets/upload-url/complete")
def complete_multipart_upload(interview_id: str, payload: CompleteUploadRequest):
    try:
        # Sort the parts correctly
        sorted_parts = sorted(payload.parts, key=lambda d: d.PartNumber)
        
        s3_client.complete_multipart_upload(
            Bucket=S3_BUCKET,
            Key=payload.key,
            UploadId=payload.upload_id,
            MultipartUpload={
                'Parts': [{"ETag": part.ETag.replace('"', ''), "PartNumber": part.PartNumber} for part in sorted_parts]
            }
        )
        
        presigned_get_url = s3_client.generate_presigned_url(
            'get_object',
            Params={'Bucket': S3_BUCKET, 'Key': payload.key},
            ExpiresIn=3600
        )
        
        return {
            "playback_url": presigned_get_url
        }
    except Exception as e:
        print(f"Error completing upload: {e}")
        raise HTTPException(status_code=500, detail="Could not complete upload")


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
