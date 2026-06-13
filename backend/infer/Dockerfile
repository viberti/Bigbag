# Serviço de inferência de embeddings (match-por-imagem). CPU, isolado.
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY server.py .
# o modelo baixa no 1.º arranque para /root/.cache (montar como volume p/ persistir)
EXPOSE 8900
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8900"]
