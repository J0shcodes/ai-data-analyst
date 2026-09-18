from io import BytesIO
from fastapi import FastAPI, File, UploadFile, HTTPException
import pandas as pd

app = FastAPI()


@app.get("/health")
def health_check():
    return {"status": "healthy"}


@app.post("/datasets")
async def upload_dataset(file: UploadFile = File(...)):
    # check if file is csv
    if file.content_type != "text/csv":
        HTTPException(404, detail="Only CSV files are supported")

    # read file
    content = await file.read

    # convert file to pandas dataframe
    df = pd.read_csv(BytesIO(content))

    # perform pandas operations on file
    return ""


@app.get("/datasets/{id}")
def get_dataset(id: int):
    return ""
