package tech.epidemiology.keycloak.failurelogs;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;

final class FailureLogsLogWriter {
    private final Path filePath;

    FailureLogsLogWriter(Path filePath) {
        this.filePath = filePath;
    }

    synchronized void writeLine(String line) {
        try {
            Path parent = filePath.getParent();
            if (parent != null) {
                Files.createDirectories(parent);
            }
            Files.writeString(
                filePath,
                line + System.lineSeparator(),
                StandardCharsets.UTF_8,
                StandardOpenOption.CREATE,
                StandardOpenOption.APPEND
            );
        } catch (IOException e) {
            throw new RuntimeException("Failed to write failure log line", e);
        }
    }
}
