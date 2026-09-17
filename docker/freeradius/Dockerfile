# Airlink v3.0 — FreeRADIUS with the real production policy baked in
# (replicated from the sibling VPS via scripts/radius-replica, adapted for
# this stack's Docker networking). Config is baked, not bind-mounted, to
# avoid FreeRADIUS refusing to start on world-writable config files.
FROM freeradius/freeradius-server:3.2.10

# Shared GID with the app image's `radiusweb` group (see
# docker/backend/Dockerfile.prod) so www-data (app) and freerad (this
# container) can both read/write the clients.conf / restart-trigger / logs
# that live on volumes shared between the two containers.
RUN groupadd -g 5555 radiusweb && usermod -aG radiusweb freerad

# ---- Custom policy (from the replicated bundle) -----------------------
COPY sites-enabled/default /etc/freeradius/sites-enabled/default
COPY sites-enabled/inner-tunnel /etc/freeradius/sites-enabled/inner-tunnel
COPY mods-enabled/sql /etc/freeradius/mods-enabled/sql
COPY clients.conf.seed /etc/freeradius/clients.conf.seed
COPY clients-annapurna.conf.seed /etc/freeradius/clients-annapurna.conf.seed

# ---- Second tenant: Annapurna ----------------------------------------
# One shared FreeRADIUS serves both tenants. Annapurna gets its own SQL
# instance (its own MariaDB container and schema) plus its own virtual
# server, generated from the Mera policy above so the two cannot drift.
# Routing is per-NAS: Annapurna's client{} stanzas carry
# `virtual_server = annapurna`, which is what selects the DB connection.
COPY mods-enabled/sql_annapurna /etc/freeradius/mods-enabled/sql_annapurna
COPY gen-tenant-site.sh /usr/local/bin/gen-tenant-site.sh
RUN chmod +x /usr/local/bin/gen-tenant-site.sh \
    && /usr/local/bin/gen-tenant-site.sh annapurna sql_annapurna \
         /etc/freeradius/sites-enabled/default \
         /etc/freeradius/sites-enabled/annapurna

# The real, admin-editable client list lives on the shared volume (seeded
# from clients.conf.seed at first boot — see entrypoint.sh) so the app's
# ClientsConfService can edit it live. Stock clients.conf keeps only the
# base loopback entries and pulls the rest in via $INCLUDE.
RUN echo '$INCLUDE /var/lib/airlink-radius/clients.conf' >> /etc/freeradius/clients.conf \
    && echo '$INCLUDE /var/lib/airlink-radius/clients-annapurna.conf' >> /etc/freeradius/clients.conf

# Custom dictionary attribute used by the voucher lifecycle policy.
RUN echo '' >> /etc/freeradius/dictionary \
    && echo 'ATTRIBUTE Expire-After      16     integer' >> /etc/freeradius/dictionary

# Extra usage counters (Total-Volume-Limit / Daily-Quota-Limit), appended
# to the stock sqlcounter module.
RUN printf '\nsqlcounter total_volume {\n\tsql_module_instance = "sql"\n\tkey = User-Name\n\tquery = "SELECT ((SUM(AcctInputOctets)+SUM(AcctOutputOctets))) FROM radacct WHERE UserName=%%{${key}}"\n\treset = "never"\n\tcounter_name = "Total-Volume"\n\tcheck_name = "Total-Volume-Limit"\n}\n\nsqlcounter daily_quota {\n\tsql_module_instance = "sql"\n\tkey = User-Name\n\treset = "daily"\n\tquery = "SELECT COALESCE(SUM(AcctInputOctets + AcctOutputOctets), 0) FROM radacct WHERE UserName = %%{${key}} AND DATE(AcctStartTime) = DATE(NOW())"\n\tcounter_name = "Daily-Quota"\n\tcheck_name = "Daily-Quota-Limit"\n}\n' >> /etc/freeradius/mods-available/sqlcounter

# detail: 0640 + radiusweb group, so the app can read radacct detail logs
# for the RADIUS Log tab (matches the /var/log/freeradius volume below).
RUN sed -i -E 's/^(\s*)permissions = 0600/\1permissions = 0640/' /etc/freeradius/mods-available/detail \
    && sed -i -E 's|^#(\s*)group = \$\{security.group\}|\1group = radiusweb|' /etc/freeradius/mods-available/detail

# queries.conf: timestamp fix carried over from the replicated bundle.
RUN sed -i "s/'%S\\.%M' \\\\/FROM_UNIXTIME(%l) \\\\/" /etc/freeradius/mods-config/sql/main/mysql/queries.conf

# radiusd.conf: production-critical tuning.
#  - reject_delay MUST stay 0: RouterOS's hotspot gives up on a RADIUS
#    server after 300ms by default, so any delay here means the router
#    never sees the Access-Reject/Reply-Message and shows "RADIUS server
#    is not responding" instead of our real reason.
#  - auth/auth_badpass/auth_goodpass on for visibility into accept/reject
#    decisions in the container logs.
#  - require_message_authenticator = auto globally; individual clients in
#    clients.conf override this where needed (e.g. docker_networks = yes).
RUN sed -i -E 's/^(\s*)reject_delay = 1/\1reject_delay = 0/' /etc/freeradius/radiusd.conf \
    && sed -i -E 's/^(\s*)auth = no/\1auth = yes/' /etc/freeradius/radiusd.conf \
    && sed -i -E 's/^(\s*)auth_badpass = no/\1auth_badpass = yes/' /etc/freeradius/radiusd.conf \
    && sed -i -E 's/^(\s*)auth_goodpass = no/\1auth_goodpass = yes/' /etc/freeradius/radiusd.conf \
    && sed -i -E 's/^(\s*)require_message_authenticator = yes/\1require_message_authenticator = auto/' /etc/freeradius/radiusd.conf

# Shared volumes: clients.conf/.restart-trigger (rw with the app) and
# radacct detail logs (ro from the app, for the RADIUS Log tab).
RUN mkdir -p /var/lib/airlink-radius /var/log/freeradius/radacct \
    && chown -R freerad:radiusweb /var/lib/airlink-radius /var/log/freeradius \
    && chmod 750 /var/log/freeradius/radacct

RUN chown -R freerad:freerad /etc/freeradius && chmod -R o-w /etc/freeradius

COPY entrypoint.sh /usr/local/bin/airlink-entrypoint.sh
RUN chmod +x /usr/local/bin/airlink-entrypoint.sh

EXPOSE 1812/udp 1813/udp
ENTRYPOINT ["airlink-entrypoint.sh"]
