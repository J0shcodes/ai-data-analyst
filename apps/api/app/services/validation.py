import pandas as pd
from io import BytesIO
from fastapi import UploadFile, HTTPException

async def validate_dataset(file: UploadFile, MAX_FILE_SIZE: int) -> pd.DataFrame:
    if file.content_type != "text/csv":
        raise HTTPException(400, detail="Only CSV files are supported")
    
    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are supported")
    
    # read file
    contents = await file.read()
    
    if len(contents) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="File size muist not exceed 15 MB")
    
    if not contents.strip():
        raise HTTPException(status_code=422, detail="The uploaded CSV file is empty")
    
    try:
        df = pd.read_csv(BytesIO(contents))
    
    except pd.errors.EmptyDataError:
        raise HTTPException(status_code=422, detail="The uploaded CSV file is empty")

    except pd.errors.ParserError:
        raise HTTPException(
            status_code=422, detail="The uploaded file is not a valid CSV"
        )

    if df.empty:
        raise HTTPException(
            status_code=422, detail="The uploaded CSV contains no data rows"
        )

    return df