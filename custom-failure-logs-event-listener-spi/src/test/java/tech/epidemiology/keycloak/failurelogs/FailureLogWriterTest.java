package tech.epidemiology.keycloak.failurelogs;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;

import org.junit.jupiter.api.Test;

class FailureLogsLogWriterTest {

    @Test
    void shouldAppendJsonLinesToFile() throws Exception {
        Path temp = Files.createTempFile("failurelogs-auth", ".log");
        FailureLogsLogWriter writer = new FailureLogsLogWriter(temp);

        writer.writeLine("{\"a\":1}");
        writer.writeLine("{\"b\":2}");

        String all = Files.readString(temp);
        assertThat(all).contains("{\"a\":1}\n").contains("{\"b\":2}\n");
    }
}
