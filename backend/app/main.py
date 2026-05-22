import os
from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import List, Optional
import firebase_admin
from firebase_admin import auth, credentials
from app.auth import get_current_user  # noqa: F401 – re-exported for convenience

# Initialize Firebase SDK inside an isolated context environment safely
firebase_project_id = os.getenv("FIREBASE_PROJECT_ID", "mock-receipts-project")
if not firebase_admin._apps:
    if os.getenv("ENVIRONMENT") == "local":
        # Local mock development testing fallback framework configuration
        firebase_admin.initialize_app(options={"projectId": firebase_project_id})
    else:
        cred = credentials.ApplicationDefault()
        firebase_admin.initialize_app(cred, options={"projectId": firebase_project_id})

app = FastAPI(
    title="Receipt Tracking & AI Reimbursement Analytics Ingestion API",
    version="1.0.0",
    docs_url="/api/docs" if os.getenv("ENVIRONMENT") == "local" else None
)

# Enforce secure CORS parameters for Cloud Run to dashboard communication pipelines
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://receipts.nopa.llc",
        "https://receipt-tracker-frontend-goxuldyofq-uc.a.run.app",
        "https://receipt-tracker-frontend-156776765895.us-central1.run.app",
        "http://localhost:5173",
        "http://localhost:8080",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_CORS_ORIGINS = [
    "https://receipts.nopa.llc",
    "https://receipt-tracker-frontend-goxuldyofq-uc.a.run.app",
    "https://receipt-tracker-frontend-156776765895.us-central1.run.app",
    "http://localhost:5173",
    "http://localhost:8080",
]

# Global Framework Error Interceptor
@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    import traceback
    traceback.print_exc()
    origin = request.headers.get("origin", "")
    cors_headers = {}
    if origin in _CORS_ORIGINS:
        cors_headers["Access-Control-Allow-Origin"] = origin
        cors_headers["Access-Control-Allow-Credentials"] = "true"
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "Internal Server Runtime Error Intercepted", "error_log": str(exc)},
        headers=cors_headers,
    )

# Operational Status Health Check Endpoint
class SystemHealthSchema(BaseModel):
    status: str
    environment: str

@app.get("/api/health", response_model=SystemHealthSchema, status_code=status.HTTP_200_OK)
async def health_check():
    return {
        "status": "operational",
        "environment": os.getenv("ENVIRONMENT", "local")
    }


from app.routes.chat import router as chat_router  # noqa: E402
from app.routes.receipts import router as receipts_router  # noqa: E402
from app.routes.ingest import router as ingest_router  # noqa: E402
from app.routes.pending import router as pending_router  # noqa: E402
from app.routes.admin import router as admin_router  # noqa: E402
from app.routes.reports import router as reports_router  # noqa: E402
from app.routes.report_pdf import router as report_pdf_router  # noqa: E402

app.include_router(receipts_router)
app.include_router(chat_router)
app.include_router(ingest_router)
app.include_router(pending_router)
app.include_router(admin_router)
app.include_router(reports_router)
app.include_router(report_pdf_router)
