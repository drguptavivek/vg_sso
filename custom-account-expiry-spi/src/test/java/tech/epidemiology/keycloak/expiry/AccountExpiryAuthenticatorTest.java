package tech.epidemiology.keycloak.expiry;

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
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.Map;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class AccountExpiryAuthenticatorTest {

    private AccountExpiryAuthenticator authenticator;

    @Mock
    private AuthenticationFlowContext context;

    @Mock
    private UserModel user;

    @Mock
    private RealmModel realm;

    private AuthenticatorConfigModel configModel;

    @Mock
    private LoginFormsProvider formsProvider;

    private Map<String, String> configMap;

    @BeforeEach
    void setUp() {
        authenticator = new AccountExpiryAuthenticator();
        configMap = new HashMap<>();
        configModel = new AuthenticatorConfigModel();
        configModel.setConfig(configMap);
        
        lenient().when(context.getUser()).thenReturn(user);
        lenient().when(context.getRealm()).thenReturn(realm);
        lenient().when(realm.getName()).thenReturn("test-realm");
        lenient().when(context.getAuthenticatorConfig()).thenReturn(configModel);
        lenient().when(context.form()).thenReturn(formsProvider);
        lenient().when(formsProvider.setError(anyString())).thenReturn(formsProvider);
        lenient().when(formsProvider.createErrorPage(any())).thenReturn(mock(Response.class));
    }

    @Test
    void testAuthenticate_NoUser() {
        when(context.getUser()).thenReturn(null);
        authenticator.authenticate(context);
        verify(context).failure(AuthenticationFlowError.UNKNOWN_USER);
    }

    @Test
    void testAuthenticate_NoExpiryDate() {
        when(user.getFirstAttribute(AccountExpiryUtil.ATTR_EXPIRY_DATE)).thenReturn(null);
        authenticator.authenticate(context);
        verify(context).success();
    }

    @Test
    void testAuthenticate_AccountNotExpired() {
        // Set expiry to tomorrow
        String tomorrow = LocalDate.now().plusDays(1).toString();
        when(user.getFirstAttribute(AccountExpiryUtil.ATTR_EXPIRY_DATE)).thenReturn(tomorrow);
        
        authenticator.authenticate(context);
        verify(context).success();
    }

    @Test
    void testAuthenticate_AccountExpired() {
        // Set expiry to yesterday
        String yesterday = LocalDate.now().minusDays(2).toString();
        when(user.getFirstAttribute(AccountExpiryUtil.ATTR_EXPIRY_DATE)).thenReturn(yesterday);
        
        authenticator.authenticate(context);
        verify(context).failureChallenge(eq(AuthenticationFlowError.USER_DISABLED), any());
    }

    @Test
    void testAuthenticate_ParseError_Block() {
        when(user.getFirstAttribute(AccountExpiryUtil.ATTR_EXPIRY_DATE)).thenReturn("invalid-date");
        configMap.put("expiry.block.on.parse.error", "true");
        
        authenticator.authenticate(context);
        verify(context).failureChallenge(eq(AuthenticationFlowError.INTERNAL_ERROR), any());
    }

    @Test
    void testAuthenticate_ParseError_NoBlock() {
        when(user.getFirstAttribute(AccountExpiryUtil.ATTR_EXPIRY_DATE)).thenReturn("invalid-date");
        configMap.put("expiry.block.on.parse.error", "false");
        
        authenticator.authenticate(context);
        verify(context).success();
    }
}
