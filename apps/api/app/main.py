import asyncio
import uuid
from contextlib import asynccontextmanager

from datetime import datetime, timezone
from io import BytesIO
from fastapi import FastAPI, File, UploadFile, HTTPException
import pandas as pd
from models.dataset import DatasetProfile, DatasetPreview, DatasetSummary
from services.profiling import build_dataset_profile
from services.validation import validate_dataset
from services.store import dataset_store, run_eviction_loop


@asynccontextmanager
async def lifespan(app: FastAPI):
    eviction_task = asyncio.create_task(run_eviction_loop(dataset_store))
    yield
    eviction_task.cancel()
    try:
        await eviction_task
    except asyncio.CancelledError:
        pass


app = FastAPI(lifespan=lifespan)

MAX_FILE_SIZE = 15 * 1024 * 1024  # 15 MB


@app.get("/health")
def health_check():
    return {"status": "healthy"}


@app.post("/datasets", response_model=DatasetProfile)
async def upload_dataset(file: UploadFile = File(...)):

    df = await validate_dataset(file, MAX_FILE_SIZE=MAX_FILE_SIZE)
    dataset_id = str(uuid.uuid4())
    profile = build_dataset_profile(
        df=df, dataset_id=dataset_id, filename=file.filename or "unknown.csv"
    )

    dataset_store.create(dataset_id=dataset_id, df=df, profile=profile)

    return profile


@app.get("/datasets", response_model=list[DatasetSummary])
async def list_datasets():
    return [
        DatasetSummary(
            dataset_id=dataset_id,
            filename=entry.profile.filename,
            row_count=entry.profile.row_count,
            column_count=entry.profile.column_count,
            created_at=entry.created_at,
            last_accessed_at=entry.last_accessed_at,
        )
        for dataset_id, entry in dataset_store.list_all()
    ]


@app.get("/datasets/{dataset_id}", response_model=DatasetProfile)
def get_dataset_profile(dataset_id: str):
    entry = dataset_store.get(dataset_id=dataset_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return entry.profile


@app.get("/datasets/{dataset_id}/preview", response_model=DatasetPreview)
def get_dataset_preview(dataset_id: str):
    entry = dataset_store.get(dataset_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Dataset not found")

    return DatasetPreview(
        dataset_id=dataset_id,
        columns=list(entry.df.columns),
        rows=entry.df.head(10).to_dict(orient="records"),
    )


@app.delete("/datasets/{dataset_id}", status_code=204)
def delete_dataset(dataset_id: str):
    if not dataset_store.delete(dataset_id):
        raise HTTPException(status_code=404, detail="Dataset not found")
