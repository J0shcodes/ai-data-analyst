import uuid
from io import BytesIO
from fastapi import FastAPI, File, UploadFile, HTTPException
import pandas as pd
from models import dataset
from services.profiling import build_dataset_profile
from services.validation import validate_dataset

app = FastAPI()

MAX_FILE_SIZE = 15 * 1024 * 1024  # 15 MB

dataset_store = {}


@app.get("/health")
def health_check():
    return {"status": "healthy"}


@app.post("/datasets", response_model=dataset.DatasetProfile)
async def upload_dataset(file: UploadFile = File(...)):

    df = await validate_dataset(file, MAX_FILE_SIZE=MAX_FILE_SIZE)

    dataset_id = str(uuid.uuid4())

    profile = build_dataset_profile(
        df=df, dataset_id=dataset_id, filename=file.filename or "unknown.csv"
    )

    return profile

@app.get("/datasets", response_model=[dataset.DatasetProfile])
async def get_datasets():
    return 



@app.get("/datasets/{id}")
def get_dataset(id: str):
    return ""
