"""Chronological demand-model evaluation and model-run persistence.

From repository root:
  python ml/train_forecasts.py --database-url sqlite:///./backend/inventory.db
"""
import argparse
from datetime import date
from pathlib import Path
import sys
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, mean_absolute_percentage_error, mean_squared_error, r2_score
try:
    from xgboost import XGBRegressor
except ImportError:  # Allows API-only development installs; Docker requirements include xgboost.
    XGBRegressor = None

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app.db import SessionLocal  # noqa: E402
from app.models import ModelRun, Sale  # noqa: E402


def feature_frame(sales: list[Sale]) -> pd.DataFrame:
    frame = pd.DataFrame([{"date": row.date, "product_id": row.product_id, "quantity": row.quantity_sold, "price": float(row.unit_price), "promotion": int(row.promotion), "holiday": int(row.holiday)} for row in sales])
    frame["date"] = pd.to_datetime(frame["date"])
    frame = frame.sort_values(["product_id", "date"])
    frame["dow"] = frame.date.dt.dayofweek
    frame["month"] = frame.date.dt.month
    for lag in (1, 7, 14): frame[f"lag_{lag}"] = frame.groupby("product_id").quantity.shift(lag)
    frame["rolling_7"] = frame.groupby("product_id").quantity.transform(lambda x: x.shift(1).rolling(7).mean())
    return frame.dropna()


def metrics(y_true: np.ndarray, y_pred: np.ndarray) -> dict:
    return {"mae": float(mean_absolute_error(y_true, y_pred)), "rmse": float(mean_squared_error(y_true, y_pred) ** .5), "mape": float(mean_absolute_percentage_error(y_true, y_pred) * 100), "r2": float(r2_score(y_true, y_pred))}


def train() -> list[dict]:
    db = SessionLocal()
    try:
        rows = db.query(Sale).order_by(Sale.date).all()
        frame = feature_frame(rows)
        if len(frame) < 100: raise RuntimeError("Insufficient sales history. Seed data or import at least 100 daily records.")
        # Chronological 80/20 holdout: never randomly split a time series.
        boundary = frame.date.quantile(.80)
        train_df, test_df = frame[frame.date <= boundary], frame[frame.date > boundary]
        features = ["product_id", "price", "promotion", "holiday", "dow", "month", "lag_1", "lag_7", "lag_14", "rolling_7"]
        forest = RandomForestRegressor(n_estimators=150, random_state=20260907, min_samples_leaf=2, n_jobs=-1)
        forest.fit(train_df[features], train_df.quantity)
        forest_predictions = forest.predict(test_df[features])
        # The rolling-seven-day model is the lightweight time-series baseline.
        outputs = [("seasonal_baseline", test_df.rolling_7.to_numpy(), metrics(test_df.quantity.to_numpy(), test_df.rolling_7.to_numpy())), ("random_forest", forest_predictions, metrics(test_df.quantity.to_numpy(), forest_predictions))]
        if XGBRegressor:
            xgb = XGBRegressor(n_estimators=180, max_depth=6, learning_rate=.05, subsample=.85, colsample_bytree=.9, objective="reg:squarederror", random_state=20260907, n_jobs=-1)
            xgb.fit(train_df[features], train_df.quantity)
            xgb_predictions = xgb.predict(test_df[features])
            outputs.append(("xgboost", xgb_predictions, metrics(test_df.quantity.to_numpy(), xgb_predictions)))
        saved = []
        for name, _, result in outputs:
            run = ModelRun(model_name=name, version="v1", train_start=train_df.date.min().date(), train_end=train_df.date.max().date(), horizon_days=7, **result)
            db.add(run); saved.append({"model": name, **result})
        db.commit()
        return saved
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(); parser.add_argument("--database-url", help="Set DATABASE_URL before running if not using default")
    args = parser.parse_args()
    if args.database_url:
        # Configuration loads before this script can create a session, so document env var usage instead of mutating global state.
        print("Use DATABASE_URL=<value> python ml/train_forecasts.py; --database-url is informational.")
    for row in train(): print(row)
