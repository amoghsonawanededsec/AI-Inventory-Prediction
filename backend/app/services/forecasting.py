from datetime import date, timedelta
import math
from sqlalchemy import func
from sqlalchemy.orm import Session
from ..models import Forecast, Product, Sale


def average_daily_sales(db: Session, product_id: int, lookback: int = 28) -> float:
    start = date.today() - timedelta(days=lookback)
    total = db.query(func.coalesce(func.sum(Sale.quantity_sold), 0)).filter(Sale.product_id == product_id, Sale.date >= start).scalar()
    return float(total or 0) / lookback


def forecast_product(db: Session, product: Product, horizon_days: int = 7, persist: bool = True) -> list[Forecast]:
    velocity = average_daily_sales(db, product.id)
    # Deterministic seasonal baseline: last 28-day velocity with a mild weekly pattern.
    generated: list[Forecast] = []
    for offset in range(1, horizon_days + 1):
        target = date.today() + timedelta(days=offset)
        weekend_factor = 1.12 if target.weekday() in (5, 6) else .96
        predicted = max(0.0, round(velocity * weekend_factor, 2))
        row = db.query(Forecast).filter_by(product_id=product.id, forecast_date=target, model_name="seasonal_baseline").first()
        if not row:
            row = Forecast(product_id=product.id, forecast_date=target, predicted_quantity=predicted, model_name="seasonal_baseline", model_version="v1", horizon_days=horizon_days)
            if persist:
                db.add(row)
        else:
            row.predicted_quantity = predicted
            row.horizon_days = horizon_days
        generated.append(row)
    if persist:
        db.commit()
        for row in generated:
            db.refresh(row)
    return generated


def forecast_sum(db: Session, product: Product, days: int) -> int:
    rows = forecast_product(db, product, max(days, 1))
    return int(math.ceil(sum(row.predicted_quantity for row in rows[:days])))
