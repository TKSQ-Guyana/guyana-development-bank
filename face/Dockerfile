# The face service: InsightFace on CPU, behind a small HTTP API the backend calls.
# Internal only — compose publishes no port for it.
#
# LICENCE: InsightFace's CODE is MIT, but its pretrained models (buffalo_l, used
# here) are for NON-COMMERCIAL research. This image is for building and trialling
# the sign-up face check; production needs InsightFace's commercial licence or a
# permissively licensed model swapped in (FACE_MODEL / app.py).
FROM python:3.11-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential libgl1 libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# The models, fetched once at build so the service starts without the internet.
ENV FACE_MODEL=buffalo_l MODEL_ROOT=/models
RUN python -c "from insightface.app import FaceAnalysis; FaceAnalysis(name='buffalo_l', root='/models', providers=['CPUExecutionProvider']).prepare(ctx_id=-1)"

COPY app.py .
RUN useradd --uid 10001 --no-create-home face && chown -R face /app /models
USER face
EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
