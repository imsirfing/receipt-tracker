#!/usr/bin/env bash
# Provision the GCS bucket and folder prefixes used by the receipt tracker.
#
# Requires: gcloud + gsutil authenticated against the kelton project.
# Usage:    ./scripts/setup_gcs.sh

set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:-kelton}"
BUCKET_NAME="${GCS_BUCKET_NAME:-kelton-receipts}"
LOCATION="${GCS_LOCATION:-US}"
CORS_FILE="$(dirname "$0")/cors.json"

echo "==> Project:  ${PROJECT_ID}"
echo "==> Bucket:   gs://${BUCKET_NAME}"
echo "==> Location: ${LOCATION}"

gcloud config set project "${PROJECT_ID}" >/dev/null

if gsutil ls -b "gs://${BUCKET_NAME}" >/dev/null 2>&1; then
  echo "==> Bucket already exists, skipping create."
else
  gsutil mb -p "${PROJECT_ID}" -l "${LOCATION}" -b on "gs://${BUCKET_NAME}"
fi

# Uniform bucket-level access (idempotent)
gsutil uniformbucketlevelaccess set on "gs://${BUCKET_NAME}"

# Folder-prefix placeholders so the GCS UI shows them.
for prefix in personal realestate traverse edgehill reports; do
  echo "==> Ensuring prefix ${prefix}/"
  echo "" | gsutil -q cp - "gs://${BUCKET_NAME}/${prefix}/.keep"
done

# CORS config (write inline if scripts/cors.json missing)
if [ ! -f "${CORS_FILE}" ]; then
  cat > "${CORS_FILE}" <<'JSON'
[
  {
    "origin": ["http://localhost:5173", "http://localhost:8080"],
    "method": ["GET", "HEAD", "OPTIONS"],
    "responseHeader": ["Content-Type", "Authorization"],
    "maxAgeSeconds": 3600
  }
]
JSON
fi

echo "==> Applying CORS config from ${CORS_FILE}"
gsutil cors set "${CORS_FILE}" "gs://${BUCKET_NAME}"

echo "Done."
