package tech.epidemiology.keycloak.auth;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.Collections;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class SmsHttpSenderTest {

    @Mock
    private HttpClient httpClient;

    @Mock
    private HttpResponse<String> response;

    private SmsHttpSender smsSender;
    private Map<String, Object> payload;

    @BeforeEach
    void setUp() {
        smsSender = new SmsHttpSender(httpClient);
        payload = Collections.singletonMap("msg", "test");
    }

    @Test
    void testSendWithRetry_PrimarySuccess() throws Exception {
        when(response.statusCode()).thenReturn(200);
        when(httpClient.send(any(HttpRequest.class), any(HttpResponse.BodyHandler.class))).thenReturn(response);

        boolean result = smsSender.sendWithRetry(
                "http://primary", "http://backup", "bearer", "X-Token", "token",
                payload, 2, 0, "user", "id"
        );

        assertThat(result).isTrue();
        verify(httpClient, times(1)).send(any(HttpRequest.class), any(HttpResponse.BodyHandler.class));
    }

    @Test
    void testSendWithRetry_PrimaryFail_BackupSuccess() throws Exception {
        HttpResponse<String> failResponse = mock(HttpResponse.class);
        when(failResponse.statusCode()).thenReturn(500);
        
        HttpResponse<String> successResponse = mock(HttpResponse.class);
        when(successResponse.statusCode()).thenReturn(200);

        // First 3 calls (0, 1, 2 retries) fail on primary, then success on backup
        when(httpClient.send(any(HttpRequest.class), any(HttpResponse.BodyHandler.class)))
                .thenReturn(failResponse) // Primary try 1
                .thenReturn(failResponse) // Primary try 2
                .thenReturn(failResponse) // Primary try 3
                .thenReturn(successResponse); // Backup try 1

        boolean result = smsSender.sendWithRetry(
                "http://primary", "http://backup", "bearer", "X-Token", "token",
                payload, 2, 0, "user", "id"
        );

        assertThat(result).isTrue();
        // 3 calls to primary + 1 call to backup
        verify(httpClient, times(4)).send(any(HttpRequest.class), any(HttpResponse.BodyHandler.class));
    }

    @Test
    void testSendWithRetry_AllFail() throws Exception {
        when(response.statusCode()).thenReturn(500);
        when(httpClient.send(any(HttpRequest.class), any(HttpResponse.BodyHandler.class))).thenReturn(response);

        boolean result = smsSender.sendWithRetry(
                "http://primary", "http://backup", "bearer", "X-Token", "token",
                payload, 1, 0, "user", "id"
        );

        assertThat(result).isFalse();
        // 2 calls to primary + 2 calls to backup
        verify(httpClient, times(4)).send(any(HttpRequest.class), any(HttpResponse.BodyHandler.class));
    }
}
