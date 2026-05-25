import os
from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional
import firebase_admin
from firebase_admin import auth, credentials
from app.auth import get_current_user  # noqa: F401 – re-exported for convenience
from app.db import get_session as get_db_session

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


class DetailedHealthSchema(BaseModel):
    status: str
    environment: str
    database: str        # "ok" | "error: <msg>"
    gmail_token: str     # "ok" | "error: <msg>" | "skipped"


@app.get("/api/health", response_model=SystemHealthSchema, status_code=status.HTTP_200_OK)
async def health_check():
    """Lightweight liveness probe used by Cloud Run."""
    return {
        "status": "operational",
        "environment": os.getenv("ENVIRONMENT", "local"),
    }


@app.get("/api/health/detailed", response_model=DetailedHealthSchema)
async def health_check_detailed(
    session: AsyncSession = Depends(get_db_session),
):
    """
    Deep health check: verifies DB connectivity and Gmail token validity.
    Call this from monitoring / alerting (not the Cloud Run liveness probe).
    """
    from sqlalchemy import text

    # ── DB check ──
    db_status = "ok"
    try:
        await session.execute(text("SELECT 1"))
    except Exception as exc:
        db_status = f"error: {exc}"

    # ── Gmail token check ──
    gmail_status = "skipped"
    refresh_token = os.getenv("GMAIL_REFRESH_TOKEN")
    client_id = os.getenv("GMAIL_CLIENT_ID")
    client_secret = os.getenv("GMAIL_CLIENT_SECRET")
    if refresh_token and client_id and client_secret:
        try:
            import google.auth.transport.requests as gtr
            import google.oauth2.credentials as gcreds
            creds = gcreds.Credentials(
                token=None,
                refresh_token=refresh_token,
                token_uri="https://oauth2.googleapis.com/token",
                client_id=client_id,
                client_secret=client_secret,
            )
            creds.refresh(gtr.Request())
            gmail_status = "ok"
        except Exception as exc:
            gmail_status = f"error: {exc}"

    overall = "ok" if (db_status == "ok" and gmail_status in ("ok", "skipped")) else "degraded"
    return {
        "status": overall,
        "environment": os.getenv("ENVIRONMENT", "local"),
        "database": db_status,
        "gmail_token": gmail_status,
    }


from app.routes.chat import router as chat_router  # noqa: E402
from app.routes.receipts import router as receipts_router  # noqa: E402
from app.routes.ingest import router as ingest_router  # noqa: E402
from app.routes.pending import router as pending_router  # noqa: E402
from app.routes.admin import router as admin_router  # noqa: E402
from app.routes.reports import router as reports_router  # noqa: E402
from app.routes.report_pdf import router as report_pdf_router  # noqa: E402
from app.routes.payees import router as payees_router  # noqa: E402

app.include_router(receipts_router)
app.include_router(chat_router)
app.include_router(ingest_router)
app.include_router(pending_router)
app.include_router(admin_router)
app.include_router(reports_router)
app.include_router(report_pdf_router)
app.include_router(payees_router)
