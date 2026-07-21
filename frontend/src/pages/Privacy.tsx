export default function Privacy() {
  return (
    <div style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', maxWidth: 720, margin: "48px auto", padding: "0 24px 64px", color: "#1a1a1a", lineHeight: 1.7 }}>
      <h1 style={{ fontSize: "1.75rem", marginBottom: 4 }}>Privacy Policy</h1>
      <p style={{ color: "#6b7280", fontSize: "0.875rem", marginBottom: "2rem" }}>Last updated: July 21, 2026</p>

      <p style={{ fontSize: "0.95rem" }}>
        Receipt Tracker ("the App") is a personal productivity tool operated by James Tinsley
        for the purpose of tracking, categorizing, and analyzing personal and business expense receipts.
      </p>

      <h2 style={{ fontSize: "1.1rem", marginTop: "2rem" }}>1. Information We Collect</h2>
      <p style={{ fontSize: "0.95rem" }}>The App accesses the following data solely to provide its core functionality:</p>
      <ul style={{ paddingLeft: "1.25rem", fontSize: "0.95rem" }}>
        <li><strong>Gmail data:</strong> The App reads email messages to identify and import receipt-related emails. It uses the <code>gmail.modify</code> scope to read message content, mark processed emails as read, apply labels, and archive them in Gmail.</li>
        <li><strong>Receipt data:</strong> Extracted information such as merchant name, date, amount, and category is stored in a private database accessible only to the account owner.</li>
      </ul>

      <h2 style={{ fontSize: "1.1rem", marginTop: "2rem" }}>2. How We Use Your Information</h2>
      <ul style={{ paddingLeft: "1.25rem", fontSize: "0.95rem" }}>
        <li>To automatically import and categorize receipts from your Gmail inbox.</li>
        <li>To generate spending summaries and reimbursement reports.</li>
        <li>No data is shared with third parties.</li>
        <li>No data is used for advertising or sold to any party.</li>
      </ul>

      <h2 style={{ fontSize: "1.1rem", marginTop: "2rem" }}>3. Data Storage</h2>
      <p style={{ fontSize: "0.95rem" }}>
        All data is stored in a private database on Google Cloud infrastructure. Access is restricted
        to the authenticated account owner only. Data is not retained beyond the owner's use of the App.
      </p>

      <h2 style={{ fontSize: "1.1rem", marginTop: "2rem" }}>4. Data Security</h2>
      <p style={{ fontSize: "0.95rem" }}>We take the security of your data seriously and implement the following protections:</p>
      <ul style={{ paddingLeft: "1.25rem", fontSize: "0.95rem" }}>
        <li><strong>Encryption in transit:</strong> All data transmitted between your browser, the App, and Google APIs is protected using HTTPS/TLS encryption.</li>
        <li><strong>Encryption at rest:</strong> Data stored in the App's database is encrypted at rest using AES-256 encryption provided by Google Cloud infrastructure.</li>
        <li><strong>Access controls:</strong> Only the authenticated account owner can access stored receipt data. No shared or public access is permitted.</li>
        <li><strong>OAuth token security:</strong> Google OAuth credentials are stored securely as encrypted environment secrets and are never logged, exposed in responses, or shared with any third party.</li>
        <li><strong>Minimal data retention:</strong> The App retains only the structured receipt data necessary for its function (merchant, date, amount, category). Raw email content is not stored.</li>
      </ul>

      <h2 style={{ fontSize: "1.1rem", marginTop: "2rem" }}>5. Google API Services</h2>
      <p style={{ fontSize: "0.95rem" }}>
        The App's use of information received from Google APIs adheres to the{" "}
        <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer" style={{ color: "#2563eb" }}>
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements.
      </p>

      <h2 style={{ fontSize: "1.1rem", marginTop: "2rem" }}>6. Your Rights</h2>
      <p style={{ fontSize: "0.95rem" }}>
        As this is a personal tool, you may request deletion of all stored data at any time by
        contacting the owner. You may also revoke the App's Gmail access at any time via{" "}
        <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer" style={{ color: "#2563eb" }}>
          Google Account permissions
        </a>.
      </p>

      <h2 style={{ fontSize: "1.1rem", marginTop: "2rem" }}>7. Contact</h2>
      <p style={{ fontSize: "0.95rem" }}>
        For any questions about this privacy policy, contact:{" "}
        <a href="mailto:jamestinsley@gmail.com" style={{ color: "#2563eb" }}>jamestinsley@gmail.com</a>
      </p>
    </div>
  );
}
