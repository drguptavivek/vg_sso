package tech.epidemiology.keycloak.auth;

import jakarta.ws.rs.core.MultivaluedHashMap;
import jakarta.ws.rs.core.MultivaluedMap;
import jakarta.ws.rs.core.Response;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.keycloak.authentication.AuthenticationFlowContext;
import org.keycloak.authentication.AuthenticationFlowError;
import org.keycloak.forms.login.LoginFormsProvider;
import org.keycloak.models.AuthenticatorConfigModel;
import org.keycloak.models.RealmModel;
import org.keycloak.models.UserModel;
import org.keycloak.sessions.AuthenticationSessionModel;
import org.keycloak.http.HttpRequest;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.HashMap;
import java.util.Map;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class PhoneOtpAuthenticatorTest {

    private PhoneOtpAuthenticator authenticator;

    @Mock
    private SmsHttpSender smsSender;

    @Mock
    private AuthenticationFlowContext context;

    @Mock
    private UserModel user;

    @Mock
    private RealmModel realm;

    @Mock
    private AuthenticationSessionModel authSession;

    @Mock
    private LoginFormsProvider formsProvider;

    @Mock
    private HttpRequest httpRequest;

    private AuthenticatorConfigModel configModel;
    private Map<String, String> configMap;

    @BeforeEach
    void setUp() {
        authenticator = new PhoneOtpAuthenticator(smsSender);
        configMap = new HashMap<>();
        configModel = new AuthenticatorConfigModel();
        configModel.setConfig(configMap);

        lenient().when(context.getUser()).thenReturn(user);
        lenient().when(context.getRealm()).thenReturn(realm);
        lenient().when(realm.getName()).thenReturn("test-realm");
        lenient().when(context.getAuthenticationSession()).thenReturn(authSession);
        lenient().when(context.getAuthenticatorConfig()).thenReturn(configModel);
        lenient().when(context.form()).thenReturn(formsProvider);
        lenient().when(context.getHttpRequest()).thenReturn(httpRequest);
        lenient().when(formsProvider.setError(anyString())).thenReturn(formsProvider);
        lenient().when(formsProvider.createForm(anyString())).thenReturn(mock(Response.class));
        lenient().when(formsProvider.createErrorPage(any())).thenReturn(mock(Response.class));
    }

    @Test
    void testAuthenticate_PhoneAlreadyVerified() {
        when(user.getFirstAttribute("phone_verified")).thenReturn("true");
        authenticator.authenticate(context);
        verify(context).success();
    }

    @Test
    void testAuthenticate_PhoneMissing() {
        when(user.getFirstAttribute("phone_verified")).thenReturn("false");
        when(user.getFirstAttribute("phone_number")).thenReturn(null);
        
        authenticator.authenticate(context);
        verify(context).failureChallenge(eq(AuthenticationFlowError.INVALID_USER), any());
    }

    @Test
    void testAuthenticate_SendOtpSuccess() {
        when(user.getFirstAttribute("phone_verified")).thenReturn("false");
        when(user.getFirstAttribute("phone_number")).thenReturn("+919876543210");
        when(smsSender.sendWithRetry(any(), any(), any(), any(), any(), any(), anyInt(), anyInt(), any(), any()))
                .thenReturn(true);
        
        authenticator.authenticate(context);
        
        verify(context).challenge(any());
        verify(smsSender).sendWithRetry(any(), any(), any(), any(), any(), any(), anyInt(), anyInt(), any(), any());
    }

    @Test
    void testAction_OtpExpired() {
        when(authSession.getAuthNote("phone_otp_hash")).thenReturn("some-hash");
        when(authSession.getAuthNote("phone_otp_expires_at")).thenReturn(String.valueOf(Instant.now().minusSeconds(10).getEpochSecond()));
        
        MultivaluedMap<String, String> formData = new MultivaluedHashMap<>();
        formData.add("otp", "123456");
        when(httpRequest.getDecodedFormParameters()).thenReturn(formData);

        authenticator.action(context);
        verify(context).failureChallenge(eq(AuthenticationFlowError.EXPIRED_CODE), any());
    }
}
