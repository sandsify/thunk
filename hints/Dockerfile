# The hint service: Python's standard library only.
FROM python:3.12-slim
WORKDIR /app
COPY server.py prompt.md ./
RUN useradd --system hints && mkdir -p /var/log/hints && chown hints /var/log/hints
USER hints
EXPOSE 8124
CMD ["python3", "server.py"]
