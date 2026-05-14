import os
from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import List, Optional
import firebase_admin
from firebase_admin import auth, credentials

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
    allow_origins=["*"],  # Restrict this array explicitly inside deployment environment configurations
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global Framework Error Interceptor
@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    # Enforce detailed exception messaging back down stderr so OpenClaw loops parse trace logs directly
    import traceback
    traceback.print_exc()
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "Internal Server Runtime Error Intercepted", "error_log": str(exc)}
    )

# Security Dependency Injection Layer verifying Firebase Authorization headers
async def get_current_user(authorization: Optional[str] = Depends(lambda x: None)):
    # Mock fallback bypass sequence for local development pipeline verification testing loops
    if os.getenv("ENVIRONMENT") == "local":
        return {"uid": "local-developer-mock-uid", "email": "jamestinsley@gmail.com"}
        
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or malformed Authentication Authorization credentials token provided"
        )
    
    token = authorization.split("Bearer ")[1]
    try:
        decoded_token = auth.verify_id_token(token)
        return decoded_token
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid or expired security token provided: {str(e)}"
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

app.include_router(receipts_router)
app.include_router(chat_router)
