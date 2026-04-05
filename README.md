# Google Meet Transcriber

A Chrome extension and Python backend system for capturing audio from Google Meet sessions and generating AI-powered candidate analysis summaries using Google's Gemini API.

## Features

- **Chrome Extension**: Seamlessly connects to active Google Meet tabs and captures audio streams
- **Audio Capture**: Uses Chrome's tabCapture API with offscreen document fallback for reliable audio recording
- **AI Analysis**: Leverages Google's Gemini 2.5 Flash model to analyze recorded conversations
- **Candidate Insights**: Generates structured candidate snapshots, follow-up questions, and exploration signals specifically for leadership school recruitment
- **FastAPI Backend**: RESTful API for handling file uploads and AI processing
- **Real-time Status**: Extension provides live updates on connection and capture status

## Architecture

- **Extension** (`/extension`): Chrome MV3 extension with service worker, content scripts, and offscreen documents
- **Backend** (`/backend`): FastAPI server that processes uploaded recordings and generates AI summaries

## Requirements

### Backend
- Python 3.8+
- Google Gemini API key
- FastAPI, Google GenAI, python-dotenv, uvicorn

### Extension
- Google Chrome browser
- Access to Google Meet tabs

## Setup

### Backend Setup

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```

2. Create a virtual environment:
   ```bash
   python -m venv .venv
   source .venv/bin/activate  # On Windows: .venv\Scripts\activate
   ```

3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

4. Set up environment variables:
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and add your Google Gemini API key:
   ```
   GEMINI_API_KEY=your_api_key_here
   GEMINI_MODEL=gemini-2.5-flash
   ```

5. Start the server:
   ```bash
   uvicorn main:app --reload
   ```
   The API will be available at `http://localhost:8000`

### Extension Setup

1. Open Chrome and navigate to `chrome://extensions/`

2. Enable "Developer mode" in the top right

3. Click "Load unpacked" and select the `/extension` directory

4. The extension should now appear in your extensions list

## Usage

1. **Start the Backend**: Ensure the FastAPI server is running on port 8000

2. **Join a Google Meet**: Open or join a Google Meet session

3. **Activate Extension**: Click the extension icon in Chrome toolbar

4. **Connect to Meet**: Click "Connect to Meet" in the popup to establish connection

5. **Start Recording**: The extension will begin capturing audio from the Meet tab

6. **View Analysis**: Recorded audio is automatically uploaded to the backend and processed by Gemini for candidate analysis

## API Endpoints

- `GET /health` - Health check
- `POST /api/recordings` - Upload audio/video file for analysis

## Configuration

### Environment Variables (Backend)
- `GEMINI_API_KEY` - Your Google Gemini API key (required)
- `GEMINI_MODEL` - Gemini model to use (default: gemini-2.5-flash)

### Extension Permissions
- `tabs` - Access to browser tabs
- `activeTab` - Access to currently active tab
- `scripting` - Inject scripts into pages
- `tabCapture` - Capture tab audio
- `desktopCapture` - Fallback capture method
- `offscreen` - Use offscreen documents for capture

## Development

### Extension Debugging
- Open `chrome://extensions/`
- Click "Inspect views: background page" for service worker logs
- Use the popup's developer tools for UI debugging

### Backend Development
- The server runs with auto-reload enabled
- Check logs in the terminal for API requests and Gemini responses

## Security Notes

- The extension only works on `meet.google.com` domains
- Audio capture requires user permission
- API keys should be kept secure and not committed to version control

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test both extension and backend
5. Submit a pull request

## License

This project is licensed under the MIT License - see the LICENSE file for details.