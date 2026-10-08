FROM python:3.12-slim
WORKDIR /app
# OpenCV 與 PaddleOCR 需要的系統函式庫，依實際需求增減
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*
COPY pyproject.toml ./
COPY src ./src
RUN pip install --no-cache-dir ".[vision,llm,analytics,server]"
EXPOSE 50051
CMD ["python", "-m", "dietai.server"]
