<#import "template.ftl" as layout>
<@layout.registrationLayout displayInfo=true displayMessage=!messagesPerField.existsError('otp'); section>
    <#if section = "header">
        ${msg("loginOtpTitle")}
    <#elseif section = "form">
        <form id="kc-otp-login-form" class="${properties.kcFormClass!}" action="${url.loginAction}" method="post">

            <div class="${properties.kcFormGroupClass!}">
                <div class="${properties.kcLabelWrapperClass!}">
                    <label for="otp" class="${properties.kcLabelClass!}">${msg("loginOtpOneTime")}</label>
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
                <div id="kc-form-options" class="${properties.kcFormOptionsClass!}">
                    <div class="${properties.kcFormOptionsWrapperClass!}">
                    </div>
                </div>

                <div id="kc-form-buttons" class="${properties.kcFormButtonsClass!}">
                    <input class="${properties.kcButtonClass!} ${properties.kcButtonPrimaryClass!} ${properties.kcButtonBlockClass!} ${properties.kcButtonLargeClass!}"
                           name="login" id="kc-login" type="submit" value="${msg("doLogIn")}"/>
                </div>
            </div>
        </form>
    <#elseif section = "info">
        ${msg("loginOtpTitle")}
    </#if>
</@layout.registrationLayout>
