from datetime import date, datetime, timedelta
from io import StringIO
import csv
from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, or_, text
from sqlalchemy.orm import Session
from ..db import engine, get_db
from ..dependencies import get_current_user, require_roles
from ..models import (AuditLog, Business, Category, ChatbotConversation, ChatbotMessage, ExpiryAlert, Forecast, InventoryBatch, InventoryTransaction,
                      KnowledgeChunk, KnowledgeDocument, ModelRun, Product, PurchaseOrder, PurchaseOrderItem, ReorderRecommendation,
                      Sale, Supplier, User, WastePrediction)
from ..schemas import (AdminUserUpdate, BatchInput, BulkBatchInput, BusinessCreate, BusinessStatusUpdate, CategoryInput, ChatRequest, ConvertReordersInput, ForecastRequest, LoginRequest, SignupRequest, POItemInput, ProductInput, PurchaseOrderInput,
                       ReorderAction, SaleInput, StatusUpdate, StockAdjustment, SupplierInput, TokenResponse, UserCreate, UserRead,
                       WhatIfRequest)
from ..security import create_token, hash_password, verify_password
from ..services.chatbot import answer as chatbot_answer
from ..services.forecasting import forecast_product, forecast_sum
from ..services.operations import build_reorder, refresh_operational_insights
from ..rate_limit import limiter

api = APIRouter(prefix="/api")


def audit(db: Session, user: User | None, action: str, entity: str, entity_id: int | str, payload: dict | None = None) -> None:
    db.add(AuditLog(user_id=user.id if user else None, action=action, entity=entity, entity_id=str(entity_id), payload=payload or {}))


def product_data(product: Product) -> dict:
    return {"id": product.id, "sku": product.sku, "name": product.name, "category_id": product.category_id, "category_name": product.category.name if product.category else None,
            "unit": product.unit, "price": float(product.price), "supplier_id": product.supplier_id, "supplier_name": product.supplier.name if product.supplier else None,
            "manufacturing_date": product.manufacturing_date, "expiry_date": product.expiry_date, "current_stock": product.current_stock, "minimum_stock": product.minimum_stock,
            "maximum_stock": product.maximum_stock, "reorder_point": product.reorder_point, "safety_stock": product.safety_stock, "lead_time_days": product.lead_time_days,
            "status": product.status, "created_at": product.created_at, "updated_at": product.updated_at}


def sale_data(sale: Sale) -> dict:
    return {"id": sale.id, "date": sale.date, "product_id": sale.product_id, "quantity_sold": sale.quantity_sold, "unit_price": float(sale.unit_price), "discount": sale.discount,
            "promotion": sale.promotion, "holiday": sale.holiday, "channel": sale.channel, "location": sale.location, "revenue": float(sale.revenue)}


@api.post("/auth/login", response_model=TokenResponse, tags=["auth"])
@limiter.limit("5/minute")
def login(request: Request, body: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == body.email).first()
    if not user or not user.is_active or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect email or password")
    return {"access_token": create_token(user.email, user.role), "refresh_token": create_token(user.email, user.role, "refresh"), "user": user}


@api.post("/auth/signup", response_model=TokenResponse, status_code=201, tags=["auth"])
@limiter.limit("3/hour")
def signup(request: Request, body: SignupRequest, db: Session = Depends(get_db)):
    if db.query(User).filter_by(email=body.email).first():
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    business = Business(name=body.business_name.strip(), owner_email=body.email, is_active=True)
    db.add(business)
    db.flush()
    db.info["business_id"] = business.id
    user = User(email=body.email, full_name=body.full_name.strip(), password_hash=hash_password(body.password), role="business_owner", business_id=business.id, is_active=True)
    db.add(Category(name="General", business_id=business.id))
    db.add(Supplier(name="Default Supplier", email=body.email, business_id=business.id))
    db.add(user)
    db.flush()
    audit(db, user, "self_registration", "user", user.id)
    db.commit()
    db.refresh(user)
    return {"access_token": create_token(user.email, user.role), "refresh_token": create_token(user.email, user.role, "refresh"), "user": user}


@api.post("/auth/refresh", tags=["auth"])
def refresh_token(refresh_token: str, db: Session = Depends(get_db)):
    from jose import JWTError, jwt
    from ..config import get_settings
    from ..security import ALGORITHM
    try:
        payload = jwt.decode(refresh_token, get_settings().secret_key, algorithms=[ALGORITHM])
        if payload.get("type") != "refresh":
            raise ValueError
        user = db.query(User).filter_by(email=payload.get("sub"), is_active=True).first()
        if not user:
            raise ValueError
    except (JWTError, ValueError):
        raise HTTPException(401, "Invalid refresh token")
    return {"access_token": create_token(user.email, user.role), "refresh_token": create_token(user.email, user.role, "refresh"), "token_type": "bearer"}


@api.get("/auth/me", response_model=UserRead, tags=["auth"])
def me(user: User = Depends(get_current_user)):
    return user


@api.get("/users", tags=["users"])
def list_users(db: Session = Depends(get_db), actor: User = Depends(get_current_user)):
    if actor.role not in {"admin", "business_owner", "manager"}:
        raise HTTPException(403, "Insufficient permissions")
    return [{"id": u.id, "email": u.email, "full_name": u.full_name, "role": u.role, "is_active": u.is_active, "business_id": u.business_id, "business_name": u.business_name} for u in db.query(User).order_by(User.full_name).all()]


@api.post("/users", status_code=201, tags=["users"])
def create_user(body: UserCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role == "admin":
        if body.role == "business_owner":
            raise HTTPException(422, "Create a business and its owner through the business workspace")
        business_id = body.business_id
        business = db.get(Business, business_id) if business_id else None
        if body.role != "admin" and (not business or not business.is_active):
            raise HTTPException(422, "Choose an active business for this account")
        if body.role == "admin" and business_id is not None:
            raise HTTPException(422, "Super administrator accounts are not assigned to a business")
    elif user.role == "business_owner" and body.role in {"manager", "staff"}:
        business_id = user.business_id
    elif user.role == "manager" and body.role == "staff":
        business_id = user.business_id
    else:
        raise HTTPException(403, "You cannot create an account with that role")
    if db.query(User).filter_by(email=body.email).first():
        raise HTTPException(409, "Email already exists")
    created = User(email=body.email, full_name=body.full_name, password_hash=hash_password(body.password), role=body.role, business_id=business_id)
    db.add(created); db.flush(); audit(db, user, "create", "user", created.id); db.commit()
    return {"id": created.id, "email": created.email, "full_name": created.full_name, "role": created.role, "is_active": created.is_active, "business_id": created.business_id, "business_name": created.business_name}


@api.put("/admin/users/{user_id}", tags=["administrator"])
def update_admin_user(user_id: int, body: AdminUserUpdate, db: Session = Depends(get_db), actor: User = Depends(require_roles("admin"))):
    target = db.get(User, user_id)
    if not target:
        raise HTTPException(404, "User not found")
    if target.id == actor.id and (body.role != "admin" or not body.is_active):
        raise HTTPException(409, "You cannot remove your own administrator access")
    next_business_id = None if body.role == "admin" else (body.business_id if body.business_id is not None else target.business_id)
    next_business = db.get(Business, next_business_id) if next_business_id else None
    if body.role != "admin" and (not next_business or not next_business.is_active):
        raise HTTPException(422, "Choose an active business for this account")
    if target.role == "admin" and target.is_active and (body.role != "admin" or not body.is_active):
        active_admins = db.query(User).filter_by(role="admin", is_active=True).count()
        if active_admins <= 1:
            raise HTTPException(409, "The last active administrator cannot be disabled or demoted")
    if target.role == "business_owner" and target.is_active and (body.role != "business_owner" or not body.is_active or next_business_id != target.business_id):
        other_owners = db.query(User).filter(User.business_id == target.business_id, User.role == "business_owner", User.is_active.is_(True), User.id != target.id).count()
        if other_owners == 0:
            raise HTTPException(409, "The last active business owner cannot be disabled or reassigned")
    previous = {"role": target.role, "is_active": target.is_active, "business_id": target.business_id}
    target.role = body.role
    target.is_active = body.is_active
    target.business_id = next_business_id
    audit(db, actor, "admin_update", "user", target.id, {"before": previous, "after": {"role": body.role, "is_active": body.is_active, "business_id": next_business_id}})
    db.commit()
    return {"id": target.id, "email": target.email, "full_name": target.full_name, "role": target.role, "is_active": target.is_active, "business_id": target.business_id, "business_name": target.business_name}


@api.get("/admin/overview", tags=["administrator"])
def admin_overview(db: Session = Depends(get_db), _: User = Depends(require_roles("admin"))):
    counts = {
        "businesses": db.query(Business).count(),
        "accounts": db.query(User).count(),
        "products": db.query(Product).count(),
        "sales": db.query(Sale).count(),
        "inventory_movements": db.query(InventoryTransaction).count(),
        "batches": db.query(InventoryBatch).count(),
        "suppliers": db.query(Supplier).count(),
        "categories": db.query(Category).count(),
        "purchase_orders": db.query(PurchaseOrder).count(),
        "purchase_order_items": db.query(PurchaseOrderItem).count(),
        "forecasts": db.query(Forecast).count(),
        "reorder_recommendations": db.query(ReorderRecommendation).count(),
        "waste_predictions": db.query(WastePrediction).count(),
        "expiry_alerts": db.query(ExpiryAlert).count(),
        "knowledge_documents": db.query(KnowledgeDocument).count(),
        "knowledge_chunks": db.query(KnowledgeChunk).count(),
        "chat_conversations": db.query(ChatbotConversation).count(),
        "chat_messages": db.query(ChatbotMessage).count(),
        "audit_events": db.query(AuditLog).count(),
        "model_runs": db.query(ModelRun).count(),
    }
    active_accounts = db.query(User).filter_by(is_active=True).count()
    revenue = db.query(func.coalesce(func.sum(Sale.revenue), 0)).scalar() or 0
    dialect = engine.dialect.name
    if dialect == "sqlite":
        storage_bytes = (db.execute(text("PRAGMA page_count")).scalar() or 0) * (db.execute(text("PRAGMA page_size")).scalar() or 0)
    elif dialect == "postgresql":
        storage_bytes = db.execute(text("SELECT pg_database_size(current_database())")).scalar() or 0
    else:
        storage_bytes = None
    return {"counts": counts, "active_accounts": active_accounts, "sales_revenue": float(revenue), "database_engine": dialect, "database_bytes": storage_bytes}


@api.get("/admin/dashboard", tags=["administrator"])
def admin_dashboard(
    start: date | None = None,
    end: date | None = None,
    business_id: int | None = None,
    category: str | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin")),
):
    end = end or date.today()
    start = start or (end - timedelta(days=30))
    if start > end:
        raise HTTPException(422, "Start date must be before end date")
    if business_id is not None and not db.get(Business, business_id):
        raise HTTPException(404, "Business workspace not found")

    products_query = db.query(Product).filter(Product.status == "active")
    if business_id is not None:
        products_query = products_query.filter(Product.business_id == business_id)
    if category:
        products_query = products_query.join(Category).filter(Category.name == category)
    products = products_query.all()
    product_ids = [product.id for product in products]

    sales_query = db.query(Sale).join(Product, Sale.product_id == Product.id).filter(Sale.date >= start, Sale.date <= end)
    if business_id is not None:
        sales_query = sales_query.filter(Product.business_id == business_id)
    if category:
        sales_query = sales_query.join(Category, Product.category_id == Category.id).filter(Category.name == category)
    revenue = float(sales_query.with_entities(func.coalesce(func.sum(Sale.revenue), 0)).scalar() or 0)
    trend_rows = sales_query.with_entities(Sale.date, func.sum(Sale.revenue), func.sum(Sale.quantity_sold)).group_by(Sale.date).order_by(Sale.date).all()
    category_rows = db.query(Category.name, func.sum(Sale.revenue)).join(Product, Product.category_id == Category.id).join(Sale, Sale.product_id == Product.id).filter(Sale.date >= start, Sale.date <= end)
    if business_id is not None:
        category_rows = category_rows.filter(Product.business_id == business_id)
    if category:
        category_rows = category_rows.filter(Category.name == category)
    category_rows = category_rows.group_by(Category.name).order_by(func.sum(Sale.revenue).desc()).all()

    product_scope = Product.id.in_(product_ids) if product_ids else False
    low_stock = sum(product.current_stock <= product.reorder_point for product in products)
    expected_demand = db.query(func.coalesce(func.sum(Sale.quantity_sold), 0)).join(Product, Sale.product_id == Product.id).filter(
        Sale.date >= end - timedelta(days=27), Sale.date <= end, product_scope
    ).scalar() or 0
    expected_demand = round(float(expected_demand) / 4)
    waste_query = db.query(func.coalesce(func.sum(WastePrediction.estimated_value), 0)).filter(WastePrediction.calculated_for == date.today(), WastePrediction.product_id.in_(product_ids) if product_ids else False)
    inventory_value = sum(product.current_stock * float(product.price) for product in products)
    reorder_query = db.query(func.count(ReorderRecommendation.id)).join(Product, ReorderRecommendation.product_id == Product.id).filter(ReorderRecommendation.status == "draft", product_scope)
    accounts_query = db.query(User).filter(User.is_active.is_(True))
    if business_id is not None:
        accounts_query = accounts_query.filter(User.business_id == business_id)

    business_rows = db.query(Business).order_by(Business.name).all()
    business_performance = []
    for business in business_rows:
        branch_products = db.query(Product).filter(Product.business_id == business.id, Product.status == "active").all()
        branch_sales = db.query(func.coalesce(func.sum(Sale.revenue), 0), func.count(Sale.id)).join(Product, Sale.product_id == Product.id).filter(Product.business_id == business.id, Sale.date >= start, Sale.date <= end)
        if category:
            branch_sales = branch_sales.join(Category, Product.category_id == Category.id).filter(Category.name == category)
        branch_revenue, branch_transactions = branch_sales.one()
        business_performance.append({
            "id": business.id, "name": business.name, "owner_email": business.owner_email,
            "is_active": business.is_active,
            "accounts": db.query(User).filter(User.business_id == business.id).count(),
            "products": len(branch_products),
            "low_stock": sum(p.current_stock <= p.reorder_point for p in branch_products),
            "transactions": branch_transactions,
            "revenue": float(branch_revenue or 0),
        })

    return {
        "last_updated": datetime.utcnow(), "range": {"start": start, "end": end},
        "selected_business_id": business_id, "selected_category": category,
        "businesses": [{"id": b.id, "name": b.name, "is_active": b.is_active} for b in business_rows],
        "categories": [row[0] for row in db.query(Category.name).distinct().order_by(Category.name).all()],
        "business_performance": business_performance,
        "kpis": {
            "businesses": sum(1 for b in business_rows if b.is_active),
            "accounts": accounts_query.count(),
            "products": len(products), "low_stock": low_stock, "revenue": revenue,
            "recommended_orders": reorder_query.scalar() or 0, "expected_demand": expected_demand,
            "predicted_waste_value": float(waste_query.scalar() or 0), "inventory_value": inventory_value,
        },
        "sales_trend": [{"date": day, "revenue": float(amount or 0), "units": int(units or 0)} for day, amount, units in trend_rows],
        "category_sales": [{"name": name, "value": float(amount or 0)} for name, amount in category_rows],
    }


@api.get("/admin/businesses", tags=["administrator"])
def admin_businesses(db: Session = Depends(get_db), _: User = Depends(require_roles("admin"))):
    rows = db.query(Business).order_by(Business.created_at.desc()).all()
    return [{
        "id": business.id, "name": business.name, "owner_email": business.owner_email,
        "is_active": business.is_active, "created_at": business.created_at,
        "accounts": db.query(User).filter_by(business_id=business.id).count(),
        "products": db.query(Product).filter_by(business_id=business.id).count(),
        "sales": db.query(Sale).filter_by(business_id=business.id).count(),
    } for business in rows]


@api.post("/admin/businesses", status_code=201, tags=["administrator"])
def create_business(body: BusinessCreate, db: Session = Depends(get_db), actor: User = Depends(require_roles("admin"))):
    if db.query(User).filter_by(email=body.owner_email).first():
        raise HTTPException(409, "An account with this owner email already exists")
    business = Business(name=body.name.strip(), owner_email=body.owner_email, is_active=True)
    db.add(business)
    db.flush()
    owner = User(email=body.owner_email, full_name=body.owner_name.strip(), password_hash=hash_password(body.owner_password), role="business_owner", business_id=business.id)
    db.add(owner)
    db.add(Category(name="General", business_id=business.id))
    db.add(Supplier(name="Default Supplier", email=body.owner_email, business_id=business.id))
    db.flush()
    audit(db, actor, "create", "business", business.id, {"name": business.name, "owner_email": business.owner_email})
    db.commit()
    return {"id": business.id, "name": business.name, "owner_email": business.owner_email, "is_active": business.is_active, "created_at": business.created_at, "accounts": 1, "products": 0, "sales": 0}


@api.put("/admin/businesses/{business_id}", tags=["administrator"])
def update_business_status(business_id: int, body: BusinessStatusUpdate, db: Session = Depends(get_db), actor: User = Depends(require_roles("admin"))):
    business = db.get(Business, business_id)
    if not business:
        raise HTTPException(404, "Business not found")
    business.is_active = body.is_active
    audit(db, actor, "business_status", "business", business.id, {"is_active": body.is_active})
    db.commit()
    return {"id": business.id, "name": business.name, "owner_email": business.owner_email, "is_active": business.is_active}


@api.get("/admin/notifications", tags=["administrator"])
def admin_notifications(db: Session = Depends(get_db), _: User = Depends(require_roles("admin"))):
    alerts = []
    cutoff = date.today() + timedelta(days=7)
    for business in db.query(Business).order_by(Business.name).all():
        low_stock = db.query(Product).filter(Product.business_id == business.id, Product.status == "active", Product.current_stock <= Product.reorder_point).count()
        expiring = db.query(Product).filter(Product.business_id == business.id, Product.expiry_date.is_not(None), Product.expiry_date <= cutoff).count()
        open_orders = db.query(PurchaseOrder).filter(PurchaseOrder.business_id == business.id, PurchaseOrder.status.in_(["draft", "approved", "ordered"])).count()
        if not business.is_active:
            alerts.append({"id": f"business-{business.id}", "severity": "critical", "business_id": business.id, "business_name": business.name, "kind": "Workspace disabled", "count": 1})
        if low_stock:
            alerts.append({"id": f"stock-{business.id}", "severity": "warning", "business_id": business.id, "business_name": business.name, "kind": "Low-stock products", "count": low_stock})
        if expiring:
            alerts.append({"id": f"expiry-{business.id}", "severity": "warning", "business_id": business.id, "business_name": business.name, "kind": "Products expiring within 7 days", "count": expiring})
        if open_orders:
            alerts.append({"id": f"orders-{business.id}", "severity": "info", "business_id": business.id, "business_name": business.name, "kind": "Open purchase orders", "count": open_orders})
    return alerts


@api.get("/admin/accounts", tags=["administrator"])
def admin_accounts(db: Session = Depends(get_db), _: User = Depends(require_roles("admin"))):
    def grouped_counts(column):
        return dict(db.query(column, func.count()).group_by(column).all())
    audit_counts = grouped_counts(AuditLog.user_id)
    movement_counts = grouped_counts(InventoryTransaction.user_id)
    conversation_counts = grouped_counts(ChatbotConversation.user_id)
    order_counts = grouped_counts(PurchaseOrder.created_by)
    users = db.query(User).order_by(User.created_at.desc()).all()
    return [{
        "id": user.id, "email": user.email, "full_name": user.full_name, "role": user.role,
        "business_id": user.business_id, "business_name": user.business_name,
        "is_active": user.is_active, "created_at": user.created_at,
        "audit_events": audit_counts.get(user.id, 0),
        "inventory_movements": movement_counts.get(user.id, 0),
        "chat_conversations": conversation_counts.get(user.id, 0),
        "purchase_orders": order_counts.get(user.id, 0),
    } for user in users]


@api.get("/admin/activity", tags=["administrator"])
def admin_activity(limit: int = Query(100, ge=1, le=500), db: Session = Depends(get_db), _: User = Depends(require_roles("admin"))):
    rows = db.query(AuditLog, User.full_name, User.email).outerjoin(User, AuditLog.user_id == User.id).order_by(AuditLog.created_at.desc()).limit(limit).all()
    return [{
        "id": event.id, "actor": full_name or "System", "actor_email": email or "",
        "action": event.action, "entity": event.entity, "entity_id": event.entity_id,
        "details": event.payload or {}, "created_at": event.created_at,
    } for event, full_name, email in rows]


@api.get("/admin/records", tags=["administrator"])
def admin_records(
    resource: str = Query(...), offset: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db), _: User = Depends(require_roles("admin")),
):
    models = {
        "accounts": User, "products": Product, "sales": Sale, "inventory_movements": InventoryTransaction,
        "batches": InventoryBatch, "categories": Category, "suppliers": Supplier, "purchase_orders": PurchaseOrder,
        "purchase_order_items": PurchaseOrderItem, "forecasts": Forecast, "reorder_recommendations": ReorderRecommendation,
        "waste_predictions": WastePrediction, "expiry_alerts": ExpiryAlert, "knowledge_documents": KnowledgeDocument,
        "knowledge_chunks": KnowledgeChunk, "chat_conversations": ChatbotConversation, "chat_messages": ChatbotMessage,
        "audit_events": AuditLog, "model_runs": ModelRun,
    }
    model = models.get(resource)
    if not model:
        raise HTTPException(422, "Unknown administrator data resource")
    query = db.query(model)
    total = query.count()
    order_column = model.date if resource == "sales" else model.id
    rows = query.order_by(order_column.desc()).offset(offset).limit(limit).all()
    columns = [column for column in model.__table__.columns if not (resource == "accounts" and column.key == "password_hash")]
    return {
        "resource": resource, "total": total, "offset": offset, "limit": limit,
        "items": [{column.key: getattr(row, column.key) for column in columns} for row in rows],
    }


@api.get("/categories", tags=["catalog"])
def list_categories(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return [{"id": c.id, "name": c.name} for c in db.query(Category).order_by(Category.name)]


@api.post("/categories", status_code=201, tags=["catalog"])
def create_category(body: CategoryInput, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "manager"))):
    if db.query(Category).filter(func.lower(Category.name) == body.name.lower()).first():
        raise HTTPException(409, "Category already exists")
    category = Category(name=body.name); db.add(category); db.flush(); audit(db, user, "create", "category", category.id); db.commit()
    return {"id": category.id, "name": category.name}


@api.get("/suppliers", tags=["suppliers"])
def list_suppliers(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return [{"id": s.id, "name": s.name, "email": s.email, "phone": s.phone, "lead_time_days": s.lead_time_days, "minimum_order_quantity": s.minimum_order_quantity, "reliability_score": s.reliability_score,
             "product_count": len(s.products)} for s in db.query(Supplier).order_by(Supplier.name)]


@api.post("/suppliers", status_code=201, tags=["suppliers"])
def create_supplier(body: SupplierInput, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "manager"))):
    supplier = Supplier(**body.model_dump()); db.add(supplier); db.flush(); audit(db, user, "create", "supplier", supplier.id); db.commit()
    return {"id": supplier.id, **body.model_dump()}


@api.put("/suppliers/{supplier_id}", tags=["suppliers"])
def update_supplier(supplier_id: int, body: SupplierInput, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "manager"))):
    supplier = db.get(Supplier, supplier_id)
    if not supplier: raise HTTPException(404, "Supplier not found")
    for field, value in body.model_dump().items(): setattr(supplier, field, value)
    audit(db, user, "update", "supplier", supplier.id); db.commit(); return {"id": supplier.id, **body.model_dump()}


@api.get("/products", tags=["products"])
def list_products(q: str | None = None, category_id: int | None = None, low_stock: bool = False, page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100), db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    query = db.query(Product)
    if q: query = query.filter(or_(Product.name.ilike(f"%{q}%"), Product.sku.ilike(f"%{q}%")))
    if category_id: query = query.filter(Product.category_id == category_id)
    if low_stock: query = query.filter(Product.current_stock <= Product.reorder_point)
    total = query.count(); rows = query.order_by(Product.name).offset((page-1)*page_size).limit(page_size).all()
    return {"items": [product_data(p) for p in rows], "total": total, "page": page, "page_size": page_size}


@api.post("/products", status_code=201, tags=["products"])
def create_product(body: ProductInput, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "manager"))):
    if db.query(Product).filter_by(sku=body.sku).first(): raise HTTPException(409, "SKU already exists")
    if not db.get(Category, body.category_id) or not db.get(Supplier, body.supplier_id): raise HTTPException(422, "Category or supplier does not exist")
    item = Product(**body.model_dump()); db.add(item); db.flush(); audit(db, user, "create", "product", item.id); db.commit(); db.refresh(item); return product_data(item)


@api.get("/products/{product_id}", tags=["products"])
def get_product(product_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    product = db.get(Product, product_id)
    if not product: raise HTTPException(404, "Product not found")
    payload = product_data(product)
    payload["batches"] = [{"id": b.id, "lot_number": b.lot_number, "quantity": b.quantity, "received_date": b.received_date, "expiry_date": b.expiry_date} for b in product.batches]
    return payload


@api.put("/products/{product_id}", tags=["products"])
def update_product(product_id: int, body: ProductInput, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "manager"))):
    product = db.get(Product, product_id)
    if not product: raise HTTPException(404, "Product not found")
    for field, value in body.model_dump().items(): setattr(product, field, value)
    audit(db, user, "update", "product", product.id); db.commit(); db.refresh(product); return product_data(product)


@api.delete("/products/{product_id}", status_code=204, tags=["products"])
def archive_product(product_id: int, db: Session = Depends(get_db), user: User = Depends(require_roles("admin"))):
    product = db.get(Product, product_id)
    if not product: raise HTTPException(404, "Product not found")
    product.status = "archived"; audit(db, user, "archive", "product", product.id); db.commit()


@api.post("/inventory/{product_id}/adjust", tags=["inventory"])
def adjust_stock(product_id: int, body: StockAdjustment, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    product = db.get(Product, product_id)
    if not product: raise HTTPException(404, "Product not found")
    if product.current_stock + body.quantity_delta < 0: raise HTTPException(422, "Adjustment would produce negative stock")
    product.current_stock += body.quantity_delta
    tx = InventoryTransaction(product_id=product_id, quantity_delta=body.quantity_delta, transaction_type=body.transaction_type, note=body.note, user_id=user.id)
    db.add(tx); audit(db, user, "stock_adjustment", "product", product.id, {"delta": body.quantity_delta, "type": body.transaction_type}); db.commit()
    return {"product_id": product_id, "current_stock": product.current_stock, "transaction_id": tx.id}


@api.get("/inventory/transactions", tags=["inventory"])
def list_transactions(product_id: int | None = None, limit: int = Query(100, ge=1, le=500), db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    query = db.query(InventoryTransaction)
    if product_id: query = query.filter_by(product_id=product_id)
    return [{"id": t.id, "product_id": t.product_id, "quantity_delta": t.quantity_delta, "transaction_type": t.transaction_type, "note": t.note, "created_at": t.created_at} for t in query.order_by(InventoryTransaction.created_at.desc()).limit(limit)]


@api.post("/inventory/batches", status_code=201, tags=["inventory"])
def receive_batches(body: BulkBatchInput | BatchInput, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    items = body.batches if isinstance(body, BulkBatchInput) else [body]
    results = []
    for b in items:
        product = db.get(Product, b.product_id)
        if not product:
            raise HTTPException(404, f"Product {b.product_id} not found")
        batch = InventoryBatch(
            product_id=product.id,
            lot_number=b.lot_number,
            quantity=b.quantity,
            received_date=b.received_date,
            expiry_date=b.expiry_date
        )
        db.add(batch)
        product.current_stock += b.quantity
        if b.expiry_date and (not product.expiry_date or b.expiry_date < product.expiry_date):
            product.expiry_date = b.expiry_date
        tx = InventoryTransaction(
            product_id=product.id,
            quantity_delta=b.quantity,
            transaction_type="receipt",
            note=f"Batch receipt lot {b.lot_number}",
            user_id=user.id
        )
        db.add(tx)
        db.flush()
        audit(db, user, "batch_received", "product", product.id, {"lot": b.lot_number, "quantity": b.quantity, "batch_id": batch.id})
        results.append({
            "id": batch.id,
            "product_id": product.id,
            "product_name": product.name,
            "lot_number": batch.lot_number,
            "quantity": batch.quantity,
            "received_date": batch.received_date,
            "expiry_date": batch.expiry_date,
            "current_stock": product.current_stock
        })
    db.commit()
    return results if isinstance(body, BulkBatchInput) else results[0]


@api.get("/inventory/batches", tags=["inventory"])
def list_batches(product_id: int | None = None, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    query = db.query(InventoryBatch)
    if product_id:
        query = query.filter_by(product_id=product_id)
    batches = query.order_by(InventoryBatch.expiry_date.asc().nullslast()).all()
    today = date.today()
    return [{
        "id": b.id,
        "product_id": b.product_id,
        "product_name": db.get(Product, b.product_id).name if db.get(Product, b.product_id) else "Unknown",
        "lot_number": b.lot_number,
        "quantity": b.quantity,
        "received_date": b.received_date,
        "expiry_date": b.expiry_date,
        "days_remaining": (b.expiry_date - today).days if b.expiry_date else None,
        "status": "expired" if (b.expiry_date and b.expiry_date < today) else ("expiring" if (b.expiry_date and (b.expiry_date - today).days <= 7) else "good")
    } for b in batches]


@api.get("/sales", tags=["sales"])
def list_sales(product_id: int | None = None, start: date | None = None, end: date | None = None, page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=200), db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    query = db.query(Sale)
    if product_id: query = query.filter_by(product_id=product_id)
    if start: query = query.filter(Sale.date >= start)
    if end: query = query.filter(Sale.date <= end)
    total = query.count(); rows = query.order_by(Sale.date.desc()).offset((page-1)*page_size).limit(page_size).all()
    return {"items": [sale_data(s) for s in rows], "total": total, "page": page, "page_size": page_size}


@api.post("/sales", status_code=201, tags=["sales"])
def create_sale(body: SaleInput, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    product = db.get(Product, body.product_id)
    if not product: raise HTTPException(422, "Product does not exist")
    if product.current_stock < body.quantity_sold: raise HTTPException(422, "Insufficient stock")
    sale = Sale(**body.model_dump(), revenue=round(body.quantity_sold * body.unit_price * (1-body.discount), 2)); product.current_stock -= body.quantity_sold
    db.add(sale); db.add(InventoryTransaction(product_id=product.id, quantity_delta=-body.quantity_sold, transaction_type="sale", note=f"Sale {body.date}", user_id=user.id)); audit(db, user, "create", "sale", "new")
    db.commit(); db.refresh(sale); return sale_data(sale)


@api.get("/sales/export", tags=["sales"])
def export_sales(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    output = StringIO(); writer = csv.DictWriter(output, fieldnames=["date", "product_id", "quantity_sold", "unit_price", "discount", "promotion", "holiday", "channel", "location", "revenue"]); writer.writeheader()
    for sale in db.query(Sale).order_by(Sale.date): writer.writerow({k: v.isoformat() if hasattr(v, "isoformat") else v for k, v in sale_data(sale).items() if k != "id"})
    return StreamingResponse(iter([output.getvalue()]), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=sales.csv"})


@api.post("/sales/import", tags=["sales"])
async def import_sales(file: UploadFile = File(...), db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "manager"))):
    if not file.filename or not file.filename.endswith(".csv"): raise HTTPException(422, "Upload a CSV file")
    reader = csv.DictReader((await file.read()).decode("utf-8").splitlines()); inserted = 0; errors = []
    for line, row in enumerate(reader, start=2):
        try:
            product = db.get(Product, int(row["product_id"])); quantity = int(row["quantity_sold"])
            if not product: raise ValueError("Unknown product_id")
            sale = Sale(date=date.fromisoformat(row["date"]), product_id=product.id, quantity_sold=quantity, unit_price=float(row["unit_price"]), discount=float(row.get("discount", 0)), promotion=row.get("promotion", "false").lower() == "true", holiday=row.get("holiday", "false").lower() == "true", channel=row.get("channel", "store"), location=row.get("location", "Main Store"), revenue=round(quantity * float(row["unit_price"]) * (1-float(row.get("discount", 0))), 2))
            db.add(sale); inserted += 1
        except (KeyError, ValueError) as exc: errors.append({"line": line, "error": str(exc)})
    audit(db, user, "import", "sales", "csv", {"inserted": inserted, "errors": len(errors)}); db.commit(); return {"inserted": inserted, "errors": errors[:20]}


@api.post("/forecasts/generate", tags=["forecasts"])
def generate_forecasts(body: ForecastRequest, db: Session = Depends(get_db), _: User = Depends(require_roles("admin", "manager"))):
    products = [db.get(Product, body.product_id)] if body.product_id else db.query(Product).filter_by(status="active").all()
    if not products or not products[0]: raise HTTPException(404, "Product not found")
    generated = []
    for product in products:
        generated.extend(forecast_product(db, product, body.horizon_days))
    return {"generated": len(generated), "horizon_days": body.horizon_days, "model": "seasonal_baseline"}


@api.get("/forecasts", tags=["forecasts"])
def list_forecasts(product_id: int | None = None, horizon_days: int = Query(7, ge=1, le=30), db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    products = [db.get(Product, product_id)] if product_id else db.query(Product).filter_by(status="active").all()
    if not products or not products[0]: raise HTTPException(404, "Product not found")
    end = date.today() + timedelta(days=horizon_days)
    rows = db.query(Forecast).filter(Forecast.forecast_date > date.today(), Forecast.forecast_date <= end)
    if product_id: rows = rows.filter(Forecast.product_id == product_id)
    return [{"id": f.id, "product_id": f.product_id, "product_name": db.get(Product, f.product_id).name, "forecast_date": f.forecast_date, "predicted_quantity": f.predicted_quantity, "model_name": f.model_name, "model_version": f.model_version, "horizon_days": f.horizon_days} for f in rows.order_by(Forecast.forecast_date).all()]


@api.get("/forecasts/{product_id}/series", tags=["forecasts"])
def forecast_series(product_id: int, history_days: int = Query(30, ge=7, le=365), db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    product = db.get(Product, product_id)
    if not product: raise HTTPException(404, "Product not found")
    start = date.today() - timedelta(days=history_days)
    actual = db.query(Sale.date, func.sum(Sale.quantity_sold)).filter(Sale.product_id == product_id, Sale.date >= start).group_by(Sale.date).order_by(Sale.date).all()
    forecast = db.query(Forecast).filter(Forecast.product_id == product_id, Forecast.forecast_date > date.today()).order_by(Forecast.forecast_date).all()
    return {"product": product.name, "actual": [{"date": d, "quantity": q} for d, q in actual], "forecast": [{"date": f.forecast_date, "quantity": f.predicted_quantity} for f in forecast]}


@api.post("/insights/refresh", tags=["insights"])
def refresh_insights(db: Session = Depends(get_db), _: User = Depends(require_roles("admin", "manager"))):
    refresh_operational_insights(db); return {"status": "refreshed", "as_of": datetime.utcnow()}


@api.get("/dashboard", tags=["analytics"])
def dashboard(start: date | None = None, end: date | None = None, category_id: int | None = None, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    end = end or date.today(); start = start or (end - timedelta(days=30))
    product_query = db.query(Product).filter(Product.status == "active")
    if category_id: product_query = product_query.filter(Product.category_id == category_id)
    products = product_query.all(); ids = [p.id for p in products]
    sales_query = db.query(Sale).filter(Sale.date >= start, Sale.date <= end)
    if ids: sales_query = sales_query.filter(Sale.product_id.in_(ids))
    revenue = float(sales_query.with_entities(func.coalesce(func.sum(Sale.revenue), 0)).scalar())
    expected = sum(forecast_sum(db, p, 7) for p in products)
    wastes = db.query(WastePrediction).filter(WastePrediction.calculated_for == date.today(), WastePrediction.product_id.in_(ids) if ids else False).all()
    reorders = db.query(ReorderRecommendation).filter(ReorderRecommendation.status == "draft", ReorderRecommendation.product_id.in_(ids) if ids else False).count()
    trend = db.query(Sale.date, func.sum(Sale.revenue).label("revenue"), func.sum(Sale.quantity_sold).label("units")).filter(Sale.date >= start, Sale.date <= end).group_by(Sale.date).order_by(Sale.date).all()
    by_category = db.query(Category.name, func.sum(Sale.revenue)).join(Product, Product.category_id == Category.id).join(Sale, Sale.product_id == Product.id).filter(Sale.date >= start, Sale.date <= end).group_by(Category.name).all()
    return {"last_updated": datetime.utcnow(), "range": {"start": start, "end": end}, "kpis": {"total_products": len(products), "low_stock_products": sum(p.current_stock <= p.reorder_point for p in products), "expiring_soon_products": sum(bool(p.expiry_date and p.expiry_date <= date.today()+timedelta(days=7)) for p in products), "predicted_waste_value": round(sum(float(w.estimated_value) for w in wastes), 2), "expected_demand": expected, "recommended_orders": reorders, "revenue": round(revenue, 2), "inventory_value": round(sum(p.current_stock * float(p.price) for p in products), 2)}, "sales_trend": [{"date": d, "revenue": float(r), "units": int(u)} for d, r, u in trend], "category_sales": [{"name": n, "value": float(v)} for n, v in by_category]}


@api.get("/analytics/suppliers", tags=["analytics"])
def supplier_analytics(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return [{"supplier": s.name, "lead_time_days": s.lead_time_days, "reliability_score": s.reliability_score, "products": len(s.products), "open_orders": db.query(PurchaseOrder).filter(PurchaseOrder.supplier_id == s.id, PurchaseOrder.status.in_(["draft", "approved", "ordered"])).count()} for s in db.query(Supplier).all()]


@api.get("/waste", tags=["waste"])
def list_waste(risk: str | None = None, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    query = db.query(WastePrediction).filter(WastePrediction.calculated_for == date.today())
    if risk: query = query.filter(WastePrediction.risk_level == risk.upper())
    return [{"id": w.id, "product_id": w.product_id, "product_name": db.get(Product, w.product_id).name, "risk_level": w.risk_level, "units_at_risk": w.units_at_risk, "estimated_value": float(w.estimated_value), "recommendation": w.recommendation} for w in query.order_by(WastePrediction.estimated_value.desc())]


@api.get("/expiry", tags=["expiry"])
def list_expiry(days: int = Query(7, ge=0, le=365), db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    cutoff = date.today() + timedelta(days=days)
    rows = db.query(Product).filter(Product.expiry_date.is_not(None), Product.expiry_date <= cutoff).order_by(Product.expiry_date).all()
    return [{"product_id": p.id, "product_name": p.name, "expiry_date": p.expiry_date, "days_remaining": (p.expiry_date-date.today()).days, "status": "expired" if p.expiry_date < date.today() else "expiring", "current_stock": p.current_stock} for p in rows]


@api.get("/reorders", tags=["reorders"])
def list_reorders(status_filter: str = "draft", db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    rows = db.query(ReorderRecommendation).filter_by(status=status_filter).order_by(ReorderRecommendation.created_at.desc()).all()
    return [{"id": r.id, "product_id": r.product_id, "product_name": db.get(Product, r.product_id).name, "current_stock": db.get(Product, r.product_id).current_stock, "reorder_point": db.get(Product, r.product_id).reorder_point, "safety_stock": db.get(Product, r.product_id).safety_stock, "lead_time_days": db.get(Product, r.product_id).lead_time_days, "forecast_demand": r.forecast_demand, "recommended_quantity": r.recommended_quantity, "explanation": r.explanation, "status": r.status} for r in rows]


@api.post("/reorders/{recommendation_id}/action", tags=["reorders"])
def act_reorder(recommendation_id: int, body: ReorderAction, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "manager"))):
    row = db.get(ReorderRecommendation, recommendation_id)
    if not row: raise HTTPException(404, "Recommendation not found")
    if row.status != "draft": raise HTTPException(409, "Only draft recommendations can be actioned")
    row.status = body.status; audit(db, user, body.status, "reorder_recommendation", row.id); db.commit(); return {"id": row.id, "status": row.status}


@api.post("/what-if", tags=["analytics"])
def what_if(body: WhatIfRequest, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    product = db.get(Product, body.product_id)
    if not product: raise HTTPException(404, "Product not found")
    lead_time = body.lead_time_days if body.lead_time_days is not None else product.lead_time_days
    normal_demand = forecast_sum(db, product, max(1, lead_time))
    demand = round(normal_demand * (1 + body.demand_change_pct/100) * (1.15 if body.promotion else 1))
    order = max(0, demand + product.safety_stock - product.current_stock)
    shelf = max(0, (product.expiry_date-date.today()).days) if product.expiry_date else 365
    shelf_demand = round(forecast_sum(db, product, min(30, shelf)) * (1 + body.demand_change_pct/100))
    waste_units = max(0, product.current_stock - shelf_demand)
    return {"product": product.name, "scenario": body.model_dump(), "forecast_demand_during_lead_time": demand, "stockout_risk": "HIGH" if product.current_stock < demand else "LOW", "waste_risk": "HIGH" if product.current_stock and waste_units/product.current_stock > .5 else ("MEDIUM" if waste_units else "LOW"), "recommended_order": order, "projected_price": round(float(product.price) * (1+body.price_change_pct/100), 2)}


@api.get("/purchase-orders", tags=["purchase orders"])
def list_pos(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    rows = db.query(PurchaseOrder).order_by(PurchaseOrder.created_at.desc()).all()
    return [{"id": po.id, "supplier_id": po.supplier_id, "supplier_name": db.get(Supplier, po.supplier_id).name, "status": po.status, "expected_delivery": po.expected_delivery, "created_at": po.created_at, "items": [{"product_id": i.product_id, "product_name": db.get(Product, i.product_id).name, "quantity": i.quantity, "unit_price": float(i.unit_price)} for i in po.items]} for po in rows]


@api.post("/purchase-orders", status_code=201, tags=["purchase orders"])
def create_po(body: PurchaseOrderInput, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "manager"))):
    supplier = db.get(Supplier, body.supplier_id)
    if not supplier: raise HTTPException(422, "Supplier does not exist")
    po = PurchaseOrder(supplier_id=supplier.id, expected_delivery=body.expected_delivery or date.today()+timedelta(days=supplier.lead_time_days), created_by=user.id)
    db.add(po); db.flush()
    for item in body.items:
        product = db.get(Product, item.product_id)
        if not product or product.supplier_id != supplier.id: raise HTTPException(422, "Every item must belong to the selected supplier")
        db.add(PurchaseOrderItem(purchase_order_id=po.id, **item.model_dump()))
    audit(db, user, "create", "purchase_order", po.id); db.commit(); return {"id": po.id, "status": po.status}


@api.post("/purchase-orders/from-reorders", status_code=201, tags=["purchase orders"])
def convert_reorders_to_pos(body: ConvertReordersInput, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "manager"))):
    recommendations = db.query(ReorderRecommendation).filter(ReorderRecommendation.id.in_(body.recommendation_ids)).all()
    if not recommendations:
        raise HTTPException(404, "No recommendations found")
    
    by_supplier: dict[int, list[tuple[ReorderRecommendation, Product]]] = {}
    for r in recommendations:
        product = db.get(Product, r.product_id)
        if not product:
            continue
        by_supplier.setdefault(product.supplier_id, []).append((r, product))
    
    created_pos = []
    for supplier_id, rec_pairs in by_supplier.items():
        supplier = db.get(Supplier, supplier_id)
        delivery = date.today() + timedelta(days=supplier.lead_time_days if supplier else 3)
        po = PurchaseOrder(supplier_id=supplier_id, expected_delivery=delivery, created_by=user.id, status="draft")
        db.add(po)
        db.flush()
        
        for r, product in rec_pairs:
            qty = max(1, r.recommended_quantity)
            db.add(PurchaseOrderItem(purchase_order_id=po.id, product_id=product.id, quantity=qty, unit_price=float(product.price)))
            r.status = "approved"  # marked as approved / converted
        
        audit(db, user, "convert_from_reorder", "purchase_order", po.id, {"items_count": len(rec_pairs)})
        created_pos.append(po.id)
    
    db.commit()
    return {"created_pos": created_pos, "message": f"Successfully created {len(created_pos)} purchase order(s)"}


@api.post("/purchase-orders/{po_id}/receive", tags=["purchase orders"])
def receive_po(po_id: int, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "manager"))):
    po = db.get(PurchaseOrder, po_id)
    if not po:
        raise HTTPException(404, "Purchase order not found")
    if po.status == "received":
        raise HTTPException(400, "Purchase order is already received")
    
    po.status = "received"
    received_items = []
    for item in po.items:
        product = db.get(Product, item.product_id)
        if product:
            lot = f"PO{po.id}-LOT{item.id}"
            product.current_stock += item.quantity
            expiry = date.today() + timedelta(days=90)
            batch = InventoryBatch(product_id=product.id, lot_number=lot, quantity=item.quantity, received_date=date.today(), expiry_date=expiry)
            db.add(batch)
            db.add(InventoryTransaction(product_id=product.id, quantity_delta=item.quantity, transaction_type="receipt", note=f"PO #{po.id} receipt", user_id=user.id))
            received_items.append({"product_id": product.id, "product_name": product.name, "quantity": item.quantity, "lot_number": lot})
    
    audit(db, user, "received", "purchase_order", po.id, {"items": len(received_items)})
    db.commit()
    return {"id": po.id, "status": "received", "items_received": received_items}


@api.post("/purchase-orders/{po_id}/status", tags=["purchase orders"])
def update_po_status(po_id: int, body: StatusUpdate, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "manager"))):
    po = db.get(PurchaseOrder, po_id)
    if not po: raise HTTPException(404, "Purchase order not found")
    if body.status in {"approved", "ordered", "received"} and user.role not in {"admin", "manager"}: raise HTTPException(403, "Manager approval required")
    if body.status == "received" and po.status != "received":
        return receive_po(po_id, db, user)
    po.status = body.status; audit(db, user, "status_change", "purchase_order", po.id, {"status": body.status}); db.commit(); return {"id": po.id, "status": po.status}


@api.get("/knowledge", tags=["knowledge"])
def list_knowledge(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return [{"id": d.id, "title": d.title, "body": d.body, "created_at": d.created_at} for d in db.query(KnowledgeDocument).order_by(KnowledgeDocument.title)]


@api.post("/knowledge", status_code=201, tags=["knowledge"])
def create_knowledge(title: str, body: str, db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "manager"))):
    document = KnowledgeDocument(title=title, body=body); db.add(document); db.flush(); db.add(KnowledgeChunk(document_id=document.id, content=body, metadata_json={"section": title})); audit(db, user, "create", "knowledge_document", document.id); db.commit(); return {"id": document.id, "title": document.title}


@api.get("/models/runs", tags=["model evaluation"])
def model_runs(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return [{"id": r.id, "model_name": r.model_name, "version": r.version, "train_start": r.train_start, "train_end": r.train_end, "mae": r.mae, "rmse": r.rmse, "mape": r.mape, "r2": r.r2, "horizon_days": r.horizon_days, "trained_at": r.created_at} for r in db.query(ModelRun).order_by(ModelRun.created_at.desc())]


@api.post("/models/train", tags=["model evaluation"])
def trigger_model_training(db: Session = Depends(get_db), user: User = Depends(require_roles("admin", "manager"))):
    import importlib.util
    from pathlib import Path
    root = Path(__file__).resolve().parents[3]
    train_script = root / "ml" / "train_forecasts.py"
    spec = importlib.util.spec_from_file_location("train_forecasts", str(train_script))
    if not spec or not spec.loader:
        raise HTTPException(500, "Could not load ML training module")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    results = module.train()
    audit(db, user, "train_models", "model_runs", "batch", {"models_count": len(results)})
    return {"message": "Models trained and evaluated successfully", "results": results}


@api.get("/system/info", tags=["system"])
def system_info(user: User = Depends(get_current_user)):
    from ..config import get_settings
    settings = get_settings()
    return {
        "app_name": settings.app_name,
        "environment": settings.environment,
        "database_engine": "SQLite" if "sqlite" in settings.database_url else "PostgreSQL",
        "llm_configured": bool(settings.llm_api_key),
        "llm_model": settings.llm_model,
        "llm_base_url": settings.llm_base_url,
        "rate_limiting": "20 requests/minute (SlowAPI)",
        "auth_security": "JWT RBAC with PBKDF2-SHA256 password hashing",
        "version": "1.0.0"
    }


@api.post("/chat", tags=["chatbot"])
@limiter.limit("20/minute")
async def chat(request: Request, body: ChatRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    conversation = db.get(ChatbotConversation, body.conversation_id) if body.conversation_id else None
    if conversation and conversation.user_id != user.id: raise HTTPException(403, "Conversation belongs to another user")
    if not conversation:
        conversation = ChatbotConversation(user_id=user.id, title=body.message[:80]); db.add(conversation); db.flush()
    response, intent, tool_data, citations = await chatbot_answer(db, body.message)
    db.add(ChatbotMessage(conversation_id=conversation.id, role="user", content=body.message, intent=intent))
    db.add(ChatbotMessage(conversation_id=conversation.id, role="assistant", content=response, intent=intent, citations=[{"title": c["title"], "section": c["section"]} for c in citations]))
    db.commit()
    return {"conversation_id": conversation.id, "intent": intent, "response": response, "tool_data": tool_data, "citations": [{"title": c["title"], "section": c["section"]} for c in citations]}


@api.get("/chat/conversations", tags=["chatbot"])
def conversations(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return [{"id": c.id, "title": c.title, "created_at": c.created_at} for c in db.query(ChatbotConversation).filter_by(user_id=user.id).order_by(ChatbotConversation.updated_at.desc())]


@api.get("/chat/conversations/{conversation_id}", tags=["chatbot"])
def conversation_messages(conversation_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    conversation = db.get(ChatbotConversation, conversation_id)
    if not conversation: raise HTTPException(404, "Conversation not found")
    if conversation.user_id != user.id: raise HTTPException(403, "Conversation belongs to another user")
    return [{"id": m.id, "role": m.role, "content": m.content, "intent": m.intent, "citations": m.citations, "created_at": m.created_at} for m in db.query(ChatbotMessage).filter_by(conversation_id=conversation_id).order_by(ChatbotMessage.created_at)]
