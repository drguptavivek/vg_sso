<#import "template.ftl" as layout>
<@layout.registrationLayout displayInfo=true displayMessage=!messagesPerField.existsError('otp'); section>
    <#if section = "header">
        ${msg("phoneOtpTitle")}
    <#elseif section = "form">
        <form id="kc-phone-otp-login-form" class="${properties.kcFormClass!}" action="${url.loginAction}" method="post">
            <div class="${properties.kcFormGroupClass!}">
                <p class="${properties.kcFormHelperTextClass!}">
                    ${msg("phoneOtpDescription")}
                    <#if phoneOtpMaskedPhone?? && phoneOtpMaskedPhone?has_content>
                        <br/>
                        ${msg("phoneOtpMaskedPhoneLabel")}: <strong>${phoneOtpMaskedPhone}</strong>
                    </#if>
                </p>
            </div>

            <div class="${properties.kcFormGroupClass!}">
                <div class="${properties.kcLabelWrapperClass!}">
                    <label for="otp" class="${properties.kcLabelClass!}">${msg("phoneOtpCodeLabel")}</label>
                </div>

                <div class="${properties.kcInputWrapperClass!}">
                    <input id="otp" name="otp" autocomplete="one-time-code" type="text"
                           class="${properties.kcInputClass!}"
                           autofocus
                           aria-invalid="<#if messagesPerField.existsError('otp')>true</#if>"
                    />

                    <#if messagesPerField.existsError('otp')>
                        <span id="input-error-otp" class="${properties.kcInputErrorMessageClass!}" aria-live="polite">
                            ${kcSanitize(messagesPerField.get('otp'))?no_esc}
                        </span>
                    </#if>
                </div>
            </div>

            <div class="${properties.kcFormGroupClass!}">
                <div id="kc-form-buttons" class="${properties.kcFormButtonsClass!}">
                    <input class="${properties.kcButtonClass!} ${properties.kcButtonPrimaryClass!} ${properties.kcButtonBlockClass!} ${properties.kcButtonLargeClass!}"
                           name="login" id="kc-login" type="submit" value="${msg("phoneOtpVerifyButton")}"/>
                </div>
            </div>

            <div class="${properties.kcFormGroupClass!}">
                <div id="kc-form-options" class="${properties.kcFormOptionsClass!}">
                    <div class="${properties.kcFormOptionsWrapperClass!}">
                        <button class="${properties.kcButtonClass!} ${properties.kcButtonDefaultClass!} ${properties.kcButtonBlockClass!}"
                                name="resend" id="kc-resend-otp" type="submit" value="true">
                            ${msg("phoneOtpResendButton")}
                        </button>
                    </div>
                </div>
            </div>
        </form>
    <#elseif section = "info">
        ${msg("phoneOtpInfo")}
    </#if>
</@layout.registrationLayout>
