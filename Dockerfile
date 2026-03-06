ARG KEYCLOAK_IMAGE=quay.io/keycloak/keycloak:26.5.4

FROM fedora:35 AS build-tools
RUN dnf install -y jq curl findutils \
    && mkdir -p /export-libs \
    && cp /usr/bin/jq /export-libs/ \
    && cp /usr/bin/curl /export-libs/ \
    && ldd /usr/bin/jq /usr/bin/curl | grep "=> /" | awk '{print $3}' | sort -u | xargs -I '{}' cp -v '{}' /export-libs/

FROM ${KEYCLOAK_IMAGE}
USER root
WORKDIR /opt/keycloak

COPY --from=build-tools /export-libs/* /usr/lib64/
RUN cp /usr/lib64/jq /usr/local/bin/jq && cp /usr/lib64/curl /usr/local/bin/curl && chmod +x /usr/local/bin/jq /usr/local/bin/curl

# Provider jars are built on host before docker compose up/build.
COPY custom-group-attr-mapper/target/*.jar /opt/keycloak/providers/
COPY custom-phone-otp-authenticator/target/*.jar /opt/keycloak/providers/
COPY custom-account-expiry-spi/target/*.jar /opt/keycloak/providers/
COPY custom-delegated-admin-guard-spi/target/*.jar /opt/keycloak/providers/
COPY custom-password-phrase-policy-spi/target/*.jar /opt/keycloak/providers/
COPY custom-failure-logs-event-listener-spi/target/*.jar /opt/keycloak/providers/

# Theme changes are frequent; keep this last before kc build for better cache reuse.
COPY theme /opt/keycloak/themes
COPY older_sso/groups_tree.json /opt/keycloak/import/groups_tree.json
COPY older_sso/groups_expected.tsv /opt/keycloak/import/groups_expected.tsv
COPY scripts/step1_bootstrap_docker.sh /opt/keycloak/scripts/step1_bootstrap_docker.sh
COPY scripts/step2_realm_config_docker.sh /opt/keycloak/scripts/step2_realm_config_docker.sh
COPY scripts/step3_claims_config_docker.sh /opt/keycloak/scripts/step3_claims_config_docker.sh
COPY scripts/step4_otp_config_docker.sh /opt/keycloak/scripts/step4_otp_config_docker.sh
COPY scripts/step5_expiry_config_docker.sh /opt/keycloak/scripts/step5_expiry_config_docker.sh
COPY scripts/step6_client_admin_setup.sh /opt/keycloak/scripts/step6_client_admin_setup.sh
COPY scripts/step7_approles_bootstrap.sh /opt/keycloak/scripts/step7_approles_bootstrap.sh
COPY scripts/step8_auditor_setup.sh /opt/keycloak/scripts/step8_auditor_setup.sh
COPY scripts/step9_audit_archival_setup.sh /opt/keycloak/scripts/step9_audit_archival_setup.sh

RUN find /opt/keycloak/themes -type d -exec chmod 755 {} + \
    && find /opt/keycloak/themes -type f -exec chmod 644 {} + \
    && chmod 644 /opt/keycloak/import/groups_tree.json /opt/keycloak/import/groups_expected.tsv \
    && chmod 755 /opt/keycloak/scripts/step*.sh

USER keycloak
RUN /opt/keycloak/bin/kc.sh build --health-enabled=true

ENTRYPOINT ["/opt/keycloak/bin/kc.sh"]
