<#macro requirements>
<aside class="vg-password-requirements" aria-labelledby="vg-password-requirements-title">
  <h2 id="vg-password-requirements-title">Password requirements</h2>
  <ul>
    <#if passwordPolicies.length??><li>Between ${passwordPolicies.length} and ${passwordPolicies.maxLength!32} characters</li></#if>
    <#if passwordPolicies.upperCase??><li>At least ${passwordPolicies.upperCase} uppercase letter</li></#if>
    <#if passwordPolicies.lowerCase??><li>At least ${passwordPolicies.lowerCase} lowercase letter</li></#if>
    <#if passwordPolicies.digits??><li>At least ${passwordPolicies.digits} number</li></#if>
    <#if passwordPolicies.specialChars??><li>At least ${passwordPolicies.specialChars} special character</li></#if>
    <li>Must not contain your username or email address</li>
    <li>Must not contain common terms such as password, admin, welcome, aiims, or 123</li>
    <#if passwordPolicies.passwordHistory??><li>Must not match any of your previous ${passwordPolicies.passwordHistory} passwords</li></#if>
  </ul>
</aside>
</#macro>
