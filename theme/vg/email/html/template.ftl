<#macro emailLayout>
<html lang="${locale.language}" dir="${(ltr)?then('ltr','rtl')}">
<body style="margin:0;padding:0;background:#f4f1ea;font-family:Georgia,'Times New Roman',serif;color:#163027;">
  <div style="max-width:640px;margin:0 auto;padding:32px 20px;">
    <div style="background:#163027;color:#f7f2e7;padding:24px 28px;border-radius:16px 16px 0 0;">
      <div style="font-size:12px;letter-spacing:0.18em;text-transform:uppercase;opacity:0.8;">AIIMS SSO</div>
      <div style="font-size:28px;line-height:1.2;font-weight:700;margin-top:8px;">Account Action Required</div>
    </div>
    <div style="background:#ffffff;padding:28px;border:1px solid #d8d0c1;border-top:0;border-radius:0 0 16px 16px;line-height:1.65;font-size:16px;">
      <#nested>
      <hr style="border:none;border-top:1px solid #e6dfd2;margin:28px 0;">
      <p style="margin:0;font-size:13px;color:#5b6a62;">
        This message was sent by AIIMS Single Sign-On. If you did not expect this email, you can ignore it.
      </p>
    </div>
  </div>
</body>
</html>
</#macro>
