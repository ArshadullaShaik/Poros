FROM ethersphere/bee:2.8.3 AS bee
FROM node:24-bookworm-slim
WORKDIR /app
COPY src/integrations/arkiv/package*.json src/integrations/arkiv/
COPY apps/web/package*.json apps/web/
RUN npm --prefix src/integrations/arkiv ci --ignore-scripts && npm --prefix apps/web ci --ignore-scripts && npm cache clean --force
COPY --from=bee /usr/local/bin/bee /usr/local/bin/bee
COPY src src
COPY apps/web/tooling apps/web/tooling
USER node
CMD ["node", "apps/web/tooling/backend.mjs"]
