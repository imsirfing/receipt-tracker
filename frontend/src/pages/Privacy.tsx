export default function Privacy() {
  return (
    <div style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', maxWidth: 720, margin: "48px auto", padding: "0 24px 64px", color: "#1a1a1a", lineHeight: 1.7 }}>
      <h1 style={{ fontSize: "1.75rem", marginBottom: 4 }}>Privacy Policy</h1>
      <p style={{ color: "#6b7280", fontSize: "0.875rem", marginBottom: "2rem" }}>Last updated: June 18, 2026</p>

      <p style={{ fontSize: "0.95rem" }}>
        Receipt Tracker ("the App") is a personal productivity tool operated by James Tinsley
        for the purpose of tracking, categorizing, and analyzing personal and business expense receipts.
      </p>

      <h2 style={{ fontSize: "1.1rem", marginTop: "2rem" }}>1. Information We Collect</h2>
      <p style={{ fontSize: "0.95rem" }}>The App accesses the following data solely to provide its core functionality:</p>
      <ul style={{ paddingLeft: "1.25rem", fontSize: "0.95rem" }}>
        <li><strong>Gmail data:</strong> The App reads email messages to identify and import receipt-related emails. It uses the <code>gmail.modify</code> scope to read message content and apply labels.</li>
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

      <h2 style={{ fontSize: "1.1rem", marginTop: "2rem" }}>4. Google API Services</h2>
      <p style={{ fontSize: "0.95rem" }}>
        The App's use of information received from Google APIs adheres to the{" "}
        <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer" style={{ color: "#2563eb" }}>
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements.
      </p>

      <h2 style={{ fontSize: "1.1rem", marginTop: "2rem" }}>5. Your Rights</h2>
      <p style={{ fontSize: "0.95rem" }}>
        As this is a personal tool, you may request deletion of all stored data at any time by
        contacting the owner. You may also revoke the App's Gmail access at any time via{" "}
        <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer" style={{ color: "#2563eb" }}>
          Google Account permissions
        </a>.
      </p>

      <h2 style={{ fontSize: "1.1rem", marginTop: "2rem" }}>6. Contact</h2>
      <p style={{ fontSize: "0.95rem" }}>
        For any questions about this privacy policy, contact:{" "}
        <a href="mailto:jamestinsley@gmail.com" style={{ color: "#2563eb" }}>jamestinsley@gmail.com</a>
      </p>
    </div>
  );
}
