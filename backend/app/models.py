from datetime import date, datetime
from typing import List, Optional
from sqlalchemy import event
from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, JSON, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, Session, mapped_column, relationship, with_loader_criteria
from .db import Base


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Business(Base):
    __tablename__ = "businesses"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(180), index=True)
    owner_email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class BusinessScoped:
    business_id: Mapped[Optional[int]] = mapped_column(ForeignKey("businesses.id"), nullable=True, index=True)


class Role(Base):
    __tablename__ = "roles"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    description: Mapped[str] = mapped_column(String(250), default="")


class User(BusinessScoped, Base, TimestampMixin):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(40), default="staff", index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    business: Mapped[Optional[Business]] = relationship()

    @property
    def business_name(self) -> str | None:
        return self.business.name if self.business else None


class Category(BusinessScoped, Base):
    __tablename__ = "categories"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), index=True)
    is_grocery: Mapped[bool] = mapped_column(Boolean, default=False)
    default_weight_unit: Mapped[str] = mapped_column(String(2), default="kg")
    default_weight_g: Mapped[int] = mapped_column(Integer, default=1000)
    weight_increment_g: Mapped[int] = mapped_column(Integer, default=500)
    minimum_weight_g: Mapped[int] = mapped_column(Integer, default=100)
    maximum_weight_g: Mapped[int] = mapped_column(Integer, default=100000)
    __table_args__ = (UniqueConstraint("business_id", "name", name="uq_category_business_name"),)


class Supplier(BusinessScoped, Base, TimestampMixin):
    __tablename__ = "suppliers"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(150), index=True)
    email: Mapped[str] = mapped_column(String(255), default="")
    phone: Mapped[str] = mapped_column(String(40), default="")
    lead_time_days: Mapped[int] = mapped_column(Integer, default=3)
    minimum_order_quantity: Mapped[int] = mapped_column(Integer, default=1)
    reliability_score: Mapped[float] = mapped_column(Float, default=0.9)
    products: Mapped[List["Product"]] = relationship(back_populates="supplier")
    __table_args__ = (UniqueConstraint("business_id", "name", name="uq_supplier_business_name"),)


class Product(BusinessScoped, Base, TimestampMixin):
    __tablename__ = "products"
    id: Mapped[int] = mapped_column(primary_key=True)
    sku: Mapped[str] = mapped_column(String(50), index=True)
    name: Mapped[str] = mapped_column(String(180), index=True)
    category_id: Mapped[int] = mapped_column(ForeignKey("categories.id"))
    unit: Mapped[str] = mapped_column(String(30), default="unit")
    price: Mapped[float] = mapped_column(Numeric(12, 2))
    supplier_id: Mapped[int] = mapped_column(ForeignKey("suppliers.id"))
    manufacturing_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    expiry_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    current_stock: Mapped[int] = mapped_column(Integer, default=0)
    minimum_stock: Mapped[int] = mapped_column(Integer, default=0)
    maximum_stock: Mapped[int] = mapped_column(Integer, default=0)
    reorder_point: Mapped[int] = mapped_column(Integer, default=0)
    safety_stock: Mapped[int] = mapped_column(Integer, default=0)
    lead_time_days: Mapped[int] = mapped_column(Integer, default=3)
    status: Mapped[str] = mapped_column(String(30), default="active")
    is_weight_based: Mapped[bool] = mapped_column(Boolean, default=False)
    weight_unit: Mapped[Optional[str]] = mapped_column(String(2), nullable=True)
    default_weight_g: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    weight_increment_g: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    minimum_weight_g: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    maximum_weight_g: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    weight_stock_g: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    category: Mapped["Category"] = relationship()
    supplier: Mapped["Supplier"] = relationship(back_populates="products")
    batches: Mapped[List["InventoryBatch"]] = relationship(back_populates="product", cascade="all, delete-orphan")
    __table_args__ = (UniqueConstraint("business_id", "sku", name="uq_product_business_sku"),)


class InventoryBatch(BusinessScoped, Base, TimestampMixin):
    __tablename__ = "inventory_batches"
    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    lot_number: Mapped[str] = mapped_column(String(80), index=True)
    quantity: Mapped[int] = mapped_column(Integer)
    received_date: Mapped[date] = mapped_column(Date)
    expiry_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    product: Mapped["Product"] = relationship(back_populates="batches")


class InventoryTransaction(BusinessScoped, Base, TimestampMixin):
    __tablename__ = "inventory_transactions"
    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), index=True)
    quantity_delta: Mapped[int] = mapped_column(Integer)
    weight_delta_g: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    transaction_type: Mapped[str] = mapped_column(String(30))
    note: Mapped[str] = mapped_column(String(500), default="")
    user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)


class Sale(BusinessScoped, Base):
    __tablename__ = "sales"
    id: Mapped[int] = mapped_column(primary_key=True)
    date: Mapped[date] = mapped_column(Date, index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), index=True)
    quantity_sold: Mapped[int] = mapped_column(Integer)
    unit_price: Mapped[float] = mapped_column(Numeric(12, 2))
    discount: Mapped[float] = mapped_column(Float, default=0)
    promotion: Mapped[bool] = mapped_column(Boolean, default=False)
    holiday: Mapped[bool] = mapped_column(Boolean, default=False)
    channel: Mapped[str] = mapped_column(String(40), default="store")
    location: Mapped[str] = mapped_column(String(100), default="Main Store")
    revenue: Mapped[float] = mapped_column(Numeric(12, 2))


class CheckoutTransaction(BusinessScoped, Base):
    __tablename__ = "checkout_transactions"
    id: Mapped[int] = mapped_column(primary_key=True)
    invoice_id: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    customer_name: Mapped[str] = mapped_column(String(180), default="Walk-in Customer")
    customer_phone: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    customer_id: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    subtotal: Mapped[float] = mapped_column(Numeric(12, 2))
    discount: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    tax: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    total: Mapped[float] = mapped_column(Numeric(12, 2))
    payment_method: Mapped[str] = mapped_column(String(20))
    payment_status: Mapped[str] = mapped_column(String(20), default="PAID")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    items: Mapped[List["CheckoutItem"]] = relationship(back_populates="transaction", cascade="all, delete-orphan")


class CheckoutItem(BusinessScoped, Base):
    __tablename__ = "checkout_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    transaction_id: Mapped[int] = mapped_column(ForeignKey("checkout_transactions.id"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    product_name: Mapped[str] = mapped_column(String(180))
    quantity: Mapped[int] = mapped_column(Integer)
    unit_price: Mapped[float] = mapped_column(Numeric(12, 2))
    line_total: Mapped[float] = mapped_column(Numeric(12, 2))
    selected_weight_g: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    weight_unit: Mapped[Optional[str]] = mapped_column(String(2), nullable=True)
    transaction: Mapped["CheckoutTransaction"] = relationship(back_populates="items")


class Forecast(BusinessScoped, Base, TimestampMixin):
    __tablename__ = "forecasts"
    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), index=True)
    forecast_date: Mapped[date] = mapped_column(Date, index=True)
    predicted_quantity: Mapped[float] = mapped_column(Float)
    model_name: Mapped[str] = mapped_column(String(80))
    model_version: Mapped[str] = mapped_column(String(40), default="baseline-v1")
    horizon_days: Mapped[int] = mapped_column(Integer)
    __table_args__ = (UniqueConstraint("product_id", "forecast_date", "model_name", name="uq_forecast"),)


class WastePrediction(BusinessScoped, Base, TimestampMixin):
    __tablename__ = "waste_predictions"
    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), index=True)
    risk_level: Mapped[str] = mapped_column(String(12))
    units_at_risk: Mapped[int] = mapped_column(Integer)
    estimated_value: Mapped[float] = mapped_column(Numeric(12, 2))
    recommendation: Mapped[str] = mapped_column(String(500))
    calculated_for: Mapped[date] = mapped_column(Date, default=date.today)


class ExpiryAlert(BusinessScoped, Base, TimestampMixin):
    __tablename__ = "expiry_alerts"
    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), index=True)
    severity: Mapped[str] = mapped_column(String(20))
    status: Mapped[str] = mapped_column(String(20), default="open")
    expiry_date: Mapped[date] = mapped_column(Date)
    recommendation: Mapped[str] = mapped_column(String(400))


class ReorderRecommendation(BusinessScoped, Base, TimestampMixin):
    __tablename__ = "reorder_recommendations"
    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), index=True)
    forecast_demand: Mapped[int] = mapped_column(Integer)
    recommended_quantity: Mapped[int] = mapped_column(Integer)
    explanation: Mapped[str] = mapped_column(String(600))
    status: Mapped[str] = mapped_column(String(20), default="draft")


class PurchaseOrder(BusinessScoped, Base, TimestampMixin):
    __tablename__ = "purchase_orders"
    id: Mapped[int] = mapped_column(primary_key=True)
    supplier_id: Mapped[int] = mapped_column(ForeignKey("suppliers.id"))
    status: Mapped[str] = mapped_column(String(20), default="draft")
    expected_delivery: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    created_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    items: Mapped[List["PurchaseOrderItem"]] = relationship(back_populates="purchase_order", cascade="all, delete-orphan")


class PurchaseOrderItem(BusinessScoped, Base):
    __tablename__ = "purchase_order_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    purchase_order_id: Mapped[int] = mapped_column(ForeignKey("purchase_orders.id"))
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    quantity: Mapped[int] = mapped_column(Integer)
    unit_price: Mapped[float] = mapped_column(Numeric(12, 2))
    purchase_order: Mapped["PurchaseOrder"] = relationship(back_populates="items")


class KnowledgeDocument(BusinessScoped, Base, TimestampMixin):
    __tablename__ = "knowledge_documents"
    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(180))
    body: Mapped[str] = mapped_column(Text)


class KnowledgeChunk(BusinessScoped, Base):
    __tablename__ = "knowledge_chunks"
    id: Mapped[int] = mapped_column(primary_key=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("knowledge_documents.id"))
    content: Mapped[str] = mapped_column(Text)
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)


class ChatbotConversation(BusinessScoped, Base, TimestampMixin):
    __tablename__ = "chatbot_conversations"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    title: Mapped[str] = mapped_column(String(150), default="New conversation")


class ChatbotMessage(BusinessScoped, Base):
    __tablename__ = "chatbot_messages"
    id: Mapped[int] = mapped_column(primary_key=True)
    conversation_id: Mapped[int] = mapped_column(ForeignKey("chatbot_conversations.id"))
    role: Mapped[str] = mapped_column(String(20))
    content: Mapped[str] = mapped_column(Text)
    intent: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    citations: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ModelRun(BusinessScoped, Base, TimestampMixin):
    __tablename__ = "model_runs"
    id: Mapped[int] = mapped_column(primary_key=True)
    model_name: Mapped[str] = mapped_column(String(100))
    version: Mapped[str] = mapped_column(String(50))
    train_start: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    train_end: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    mae: Mapped[float] = mapped_column(Float)
    rmse: Mapped[float] = mapped_column(Float)
    mape: Mapped[float] = mapped_column(Float)
    r2: Mapped[float] = mapped_column(Float)
    horizon_days: Mapped[int] = mapped_column(Integer)


class AuditLog(BusinessScoped, Base):
    __tablename__ = "audit_logs"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    action: Mapped[str] = mapped_column(String(100))
    entity: Mapped[str] = mapped_column(String(100))
    entity_id: Mapped[str] = mapped_column(String(100))
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


@event.listens_for(Session, "do_orm_execute")
def scope_business_queries(execute_state) -> None:
    session = execute_state.session
    business_id = session.info.get("business_id")
    if execute_state.is_select and business_id is not None and not session.info.get("super_admin"):
        execute_state.statement = execute_state.statement.options(
            with_loader_criteria(BusinessScoped, lambda row: row.business_id == business_id, include_aliases=True)
        )


@event.listens_for(Session, "before_flush")
def assign_business_to_new_records(session: Session, _flush_context, _instances) -> None:
    business_id = session.info.get("business_id")
    if session.info.get("super_admin"):
        for row in session.new:
            if isinstance(row, BusinessScoped) and row.business_id is None and not (isinstance(row, User) and row.role == "admin") and not isinstance(row, AuditLog):
                raise ValueError("Choose a business workspace before creating tenant data")
        return
    if business_id is None:
        return
    for row in session.new:
        if isinstance(row, BusinessScoped):
            if isinstance(row, User) and row.role == "admin":
                continue
            if row.business_id not in (None, business_id):
                raise ValueError("Cannot create a record for another business")
            row.business_id = business_id
