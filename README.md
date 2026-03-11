# React Video Platform

A video recording web application that securely uploads chunk-buffered webm videos straight from the browser to an AWS S3 Bucket using server-generated Pre-Signed URLs.

## Tech Stack & Packages Used

### Frontend (React / Vite)

- **Vite & React**: Fast build tool and UI library for building the video recording interface.
- **MediaRecorder API**: Native browser API used to capture webcam video and audio streams into webm chunks.

### Backend (Python / FastAPI)

- **FastAPI**: Extremely fast, modern Python web framework used to create the API endpoints. It automatically handles async requests and provides easy integration for CORS.
- **Uvicorn**: An ASGI web server implementation for Python used to run the FastAPI application.
- **Boto3**: The official AWS SDK for Python. Used to securely generate short-lived, presigned URLs (for both uploading and viewing the private video) without exposing AWS API keys to the frontend.
- **python-dotenv**: Loads environment variables securely from the `.env` file.
- **uv**: An extremely fast Python package and project manager written in Rust, replacing traditional pip and venv to significantly speed up backend dependencies.

---

## 🚀 How to Run the App

Before running the app using either method below, make sure you configure your environment variables.

### 1. Configure the `.env` file

Duplicate the `.env.example` file to create a `.env` file in the root directory and fill out your AWS credentials:

```env
# Frontend
VITE_UPLOAD_DESTINATION=s3

# Backend S3 Info
VITE_AWS_REGION=us-east-1
VITE_AWS_S3_BUCKET=your-bucket-name
VITE_AWS_ACCESS_KEY_ID=your-access-key
VITE_AWS_SECRET_ACCESS_KEY=your-secret-key
```

### Method A: With Docker (Easiest)

You can run both the Frontend and Backend simultaneously with a single command using Docker.

1. Ensure [Docker](https://docs.docker.com/get-docker/) is installed and running.
2. Run the following command in the root directory:

```bash
docker-compose up --build
```

3. The app is ready! Open [http://localhost:5173](http://localhost:5173) in your browser.

_Note: Docker automatically passes your `.env` variables to the backend container during startup._

---

### Method B: Without Docker (Manual)

To run the app locally without Docker, you will need to start the backend and frontend in two separate terminal windows.

#### 1. Start the Python Backend

The backend utilizes `uv` for lightning-fast dependency management.

```bash
cd backend
uv sync # To install dependencies
uv run main.py # Runs the FastAPI server on port 8000
```

#### 2. Start the React Frontend

Open a new terminal window in the root directory:

```bash
npm install
npm run dev
```

3. Open [http://localhost:5173](http://localhost:5173) in your browser.
