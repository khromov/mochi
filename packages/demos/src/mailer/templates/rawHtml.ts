function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

// Hand-authored HTML with styles inlined directly on each tag — unlike the
// Svelte template, nothing here runs through Mochi's juice CSS-inlining pass.
export function renderRawEmailHtml({ subject, message }: { subject: string; message: string }): string {
  const safeSubject = escapeHtml(subject);
  const safeMessage = escapeHtml(message).replace(/\n/g, '<br />');
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f4f5;font-family:Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e4e4e7;border-radius:8px;">
            <tr>
              <td style="padding:28px 32px;">
                <h1 style="margin:0 0 16px;font-size:20px;color:#18181b;">${safeSubject}</h1>
                <p style="margin:0;font-size:15px;line-height:1.6;color:#3f3f46;">${safeMessage}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
