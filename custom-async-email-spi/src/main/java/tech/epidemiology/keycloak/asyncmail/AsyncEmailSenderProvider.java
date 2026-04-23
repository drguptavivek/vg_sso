package tech.epidemiology.keycloak.asyncmail;

import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.CopyOnWriteArrayList;

import org.keycloak.email.EmailException;
import org.keycloak.email.EmailSenderProvider;
import org.keycloak.models.UserModel;

public class AsyncEmailSenderProvider implements EmailSenderProvider {

    @FunctionalInterface
    public interface QueueSink {
        void queue(Map<String, String> config, RequestContext context, String address,
            String subject, String textBody, String htmlBody, UserModel user) throws EmailException;
    }

    public static final class QueuedEmail {
        private final AsyncEmailQueueRecord.Category category;
        private final String address;
        private final String subject;
        private final String textBody;
        private final String htmlBody;

        public QueuedEmail(AsyncEmailQueueRecord.Category category, String address, String subject, String textBody, String htmlBody) {
            this.category = category;
            this.address = address;
            this.subject = subject;
            this.textBody = textBody;
            this.htmlBody = htmlBody;
        }

        public AsyncEmailQueueRecord.Category getCategory() {
            return category;
        }

        public String getAddress() {
            return address;
        }

        public String getSubject() {
            return subject;
        }

        public String getTextBody() {
            return textBody;
        }

        public String getHtmlBody() {
            return htmlBody;
        }
    }

    public static final class InMemoryQueueSink implements QueueSink {
        private final List<QueuedEmail> queue = new CopyOnWriteArrayList<>();

        @Override
        public void queue(Map<String, String> config, RequestContext context, String address,
            String subject, String textBody, String htmlBody, UserModel user) {
            queue.add(new QueuedEmail(context.category(), address, subject, textBody, htmlBody));
        }

        public List<QueuedEmail> snapshot() {
            return List.copyOf(queue);
        }
    }

    @FunctionalInterface
    public interface ThrowingRunnable {
        void run() throws Exception;
    }

    private static final ThreadLocal<RequestContext> CURRENT_CONTEXT = new ThreadLocal<>();

    private final EmailSenderProvider directSmtpSender;
    private final QueueSink queueSink;

    public AsyncEmailSenderProvider(EmailSenderProvider directSmtpSender, QueueSink queueSink) {
        this.directSmtpSender = Objects.requireNonNull(directSmtpSender, "directSmtpSender");
        this.queueSink = Objects.requireNonNull(queueSink, "queueSink");
    }

    public static void withContext(AsyncEmailQueueRecord.Category category, String templateName, String eventType, ThrowingRunnable action)
        throws EmailException {
        RequestContext previous = CURRENT_CONTEXT.get();
        CURRENT_CONTEXT.set(new RequestContext(
            category == null ? AsyncEmailQueueRecord.Category.UNKNOWN : category,
            templateName == null ? "" : templateName,
            eventType == null ? "" : eventType));
        try {
            action.run();
        } catch (EmailException e) {
            throw e;
        } catch (Exception e) {
            throw new EmailException("Failed while queueing async email", e);
        } finally {
            if (previous == null) {
                CURRENT_CONTEXT.remove();
            } else {
                CURRENT_CONTEXT.set(previous);
            }
        }
    }

    public static void withCategory(AsyncEmailQueueRecord.Category category, ThrowingRunnable action) throws EmailException {
        withContext(category, "", "", action);
    }

    @Override
    public void send(Map<String, String> config, UserModel user, String subject, String textBody, String htmlBody) throws EmailException {
        String recipient = user == null ? null : user.getEmail();
        queueSink.queue(config, currentContext(), recipient, subject, textBody, htmlBody, user);
    }

    @Override
    public void send(Map<String, String> config, String address, String subject, String textBody, String htmlBody) throws EmailException {
        queueSink.queue(config, currentContext(), address, subject, textBody, htmlBody, null);
    }

    @Override
    public void validate(Map<String, String> config) throws EmailException {
        directSmtpSender.validate(config);
    }

    @Override
    public void close() {
        directSmtpSender.close();
    }

    public void sendDirect(Map<String, String> config, String address, String subject, String textBody, String htmlBody) throws EmailException {
        directSmtpSender.send(config, address, subject, textBody, htmlBody);
    }

    public void sendDirect(Map<String, String> config, UserModel user, String subject, String textBody, String htmlBody) throws EmailException {
        directSmtpSender.send(config, user, subject, textBody, htmlBody);
    }

    public boolean isDirectSenderConfigured() {
        return directSmtpSender != null;
    }

    private RequestContext currentContext() {
        RequestContext context = CURRENT_CONTEXT.get();
        return context == null ? new RequestContext(AsyncEmailQueueRecord.Category.UNKNOWN, "", "") : context;
    }

    public record RequestContext(AsyncEmailQueueRecord.Category category, String templateName, String eventType) {
    }
}
