# DocuMind AI

![Python 3.11](https://img.shields.io/badge/Python-3.11-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=0B0F19)
![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)

An AI-powered document intelligence platform that helps users upload, summarize, analyze, and interact with documents through a modern chat-based interface. Built with a React + Vite frontend and a FastAPI backend, DocuMind AI makes working with PDFs and text documents faster, smarter, and more efficient.

--------------------------------------------------

## Features

- Upload PDF and text documents
- AI-generated structured summaries (Quick / Standard / Deep / Executive / Student modes)
- Chat with your documents using RAG-powered Q&A
- Extract key insights, metrics, and takeaways
- Smart link rendering for emails, phones, URLs, GitHub, LinkedIn
- Resume-aware contact extraction
- Fast and responsive dark-themed UI
- Fully responsive design with mobile support

--------------------------------------------------

## Tech Stack

**Frontend:**
- React 19 + Vite 8
- Lucide React icons
- React Markdown
- Recharts (analytics)

**Backend:**
- FastAPI + Uvicorn
- Groq API (LLM for summaries & vision)
- ChromaDB (vector store, ONNX all-MiniLM-L6-v2 embeddings)
- PyMuPDF (PDF extraction)

--------------------------------------------------

## Project Structure

```
DocuMind/
├── frontend/        React + Vite client
├── backend/         FastAPI server
├── docker-compose.yml
└── README.md
```

--------------------------------------------------

## Installation

### 1. Clone Repository

```bash
git clone https://github.com/khizarq313/DocuMind.git
cd DocuMind
```

### 2. Backend Setup

```bash
cd backend
python -m venv venv
venv\Scripts\activate   # Windows
# source venv/bin/activate  # macOS/Linux

pip install -r requirements.txt
cp .env.example .env     # Fill in your API keys
python -m uvicorn app.main:app --reload --port 8080
```

Backend runs on: `http://localhost:8080`

### 3. Frontend Setup

```bash
cd frontend
npm install
cp .env.example .env     # Set VITE_API_URL if needed
npm run dev
```

Frontend runs on: `http://localhost:5173`

### 4. Docker (optional)

```bash
docker compose up --build
```

--------------------------------------------------

## Environment Variables

### Backend (`backend/.env`)

| Variable | Required | Description |
|---|---|---|
| `GROQ_API_KEY` | Yes | Groq API key for LLM and vision |
| `FRONTEND_URL` | No | CORS origin (default: `http://localhost:5173`) |
| `BACKEND_PORT` | No | Server port (default: `8080`) |
| `GROQ_MODEL` | No | Groq model (default: `llama-3.1-8b-instant`) |

### Frontend (`frontend/.env`)

| Variable | Required | Description |
|---|---|---|
| `VITE_API_URL` | No | Backend URL (default: `http://localhost:8080`) |

--------------------------------------------------

## Deployment (Vercel)

Both frontend and backend include `vercel.json` for one-click deployment.

**Backend:** Set `GROQ_API_KEY` in Vercel environment variables.

**Frontend:** Set `VITE_API_URL` to your deployed backend URL.

--------------------------------------------------

## Use Cases

- Students summarizing study material
- Professionals reviewing reports
- Researchers extracting insights
- Quick Q&A from PDFs
- Resume analysis and parsing

--------------------------------------------------

## Author

Khizar Qureshi
- GitHub: https://github.com/khizarq313
- LinkedIn: https://www.linkedin.com/in/khizarq7/

--------------------------------------------------

## License

MIT License
