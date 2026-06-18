from fastapi import APIRouter
from fastapi.responses import HTMLResponse

router = APIRouter()

PRIVACY_POLICY_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Privacy Policy — Receipt Tracker</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      max-width: 720px;
      margin: 48px auto;
      padding: 0 24px 64px;
      color: #1a1a1a;
      line-height: 1.7;
    }
    h1 { font-size: 1.75rem; margin-bottom: 4px; }
    h2 { font-size: 1.1rem; margin-top: 2rem; }
    p, li { font-size: 0.95rem; }
    ul { padding-left: 1.25rem; }
    a { color: #2563eb; }
    .meta { color: #6b7280; font-size: 0.875rem; margin-bottom: 2rem; }
  </style>
</head>
<body>
  <h1>Privacy Policy</h1>
  <p class="meta">Last updated: June 18, 2026</p>

  <p>Receipt Tracker ("the App") is a personal productivity tool operated by James Tinsley
  for the purpose of tracking, categorizing, and analyzing personal and business expense receipts.</p>

  <h2>1. Information We Collect</h2>
  <p>The App accesses the following data solely to provide its core functionality:</p>
  <ul>
    <li><strong>Gmail data:</strong> The App reads email messages to identify and import receipt-related emails.
    It uses the <code>gmail.modify</code> scope to read message content and apply labels.</li>
    <li><strong>Receipt data:</strong> Extracted information such as merchant name, date, amount, and category
    is stored in a private database accessible only to the account owner.</li>
  </ul>

  <h2>2. How We Use Your Information</h2>
  <ul>
    <li>To automatically import and categorize receipts from your Gmail inbox.</li>
    <li>To generate spending summaries and reimbursement reports.</li>
    <li>No data is shared with third parties.</li>
    <li>No data is used for advertising or sold to any party.</li>
  </ul>

  <h2>3. Data Storage</h2>
  <p>All data is stored in a private database on Google Cloud infrastructure. Access is restricted
  to the authenticated account owner only. Data is not retained beyond the owner's use of the App.</p>

  <h2>4. Google API Services</h2>
  <p>The App's use of information received from Google APIs adheres to the
  <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank">
  Google API Services User Data Policy</a>, including the Limited Use requirements.</p>

  <h2>5. Your Rights</h2>
  <p>As this is a personal tool, you may request deletion of all stored data at any time by
  contacting the owner. You may also revoke the App's Gmail access at any time via
  <a href="https://myaccount.google.com/permissions" target="_blank">Google Account permissions</a>.</p>

  <h2>6. Contact</h2>
  <p>For any questions about this privacy policy, contact:
  <a href="mailto:jamestinsley@gmail.com">jamestinsley@gmail.com</a></p>
</body>
</html>
"""


@router.get("/privacy", response_class=HTMLResponse, include_in_schema=False)
async def privacy_policy():
    return HTMLResponse(content=PRIVACY_POLICY_HTML, status_code=200)
