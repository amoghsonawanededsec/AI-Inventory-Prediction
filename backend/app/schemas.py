from datetime import date
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: "UserRead"


class UserRead(ORMModel):
    id: int
    email: EmailStr
    full_name: str
    role: str
    is_active: bool


class UserCreate(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=2, max_length=120)
    password: str = Field(min_length=8, max_length=128)
    role: str = "staff"


class SupplierInput(BaseModel):
    name: str = Field(min_length=2, max_length=150)
    email: str = ""
    phone: str = ""
    lead_time_days: int = Field(default=3, ge=0, le=365)
    minimum_order_quantity: int = Field(default=1, ge=1)
    reliability_score: float = Field(default=.9, ge=0, le=1)


class SupplierRead(SupplierInput, ORMModel):
    id: int


class CategoryInput(BaseModel):
    name: str = Field(min_length=2, max_length=100)


class CategoryRead(CategoryInput, ORMModel):
    id: int


class ProductInput(BaseModel):
    sku: str = Field(min_length=2, max_length=50)
    name: str = Field(min_length=2, max_length=180)
    category_id: int
    unit: str = "unit"
    price: float = Field(gt=0)
    supplier_id: int
    manufacturing_date: date | None = None
    expiry_date: date | None = None
    current_stock: int = Field(ge=0)
    minimum_stock: int = Field(ge=0)
    maximum_stock: int = Field(ge=0)
    reorder_point: int = Field(ge=0)
    safety_stock: int = Field(ge=0)
    lead_time_days: int = Field(default=3, ge=0)
    status: str = "active"


class ProductRead(ProductInput, ORMModel):
    id: int
    category_name: str | None = None
    supplier_name: str | None = None


class StockAdjustment(BaseModel):
    quantity_delta: int = Field(ge=-100000, le=100000)
    transaction_type: str = Field(pattern="^(receipt|sale|adjustment|waste|transfer)$")
    note: str = Field(default="", max_length=500)

    @field_validator("quantity_delta")
    @classmethod
    def delta_must_be_nonzero(cls, value: int) -> int:
        if value == 0:
            raise ValueError("Quantity adjustment must be non-zero")
        return value


class SaleInput(BaseModel):
    date: date
    product_id: int
    quantity_sold: int = Field(gt=0)
    unit_price: float = Field(gt=0)
    discount: float = Field(default=0, ge=0, le=1)
    promotion: bool = False
    holiday: bool = False
    channel: str = "store"
    location: str = "Main Store"


class SaleRead(SaleInput, ORMModel):
    id: int
    revenue: float


class ForecastRequest(BaseModel):
    product_id: int | None = None
    horizon_days: int = Field(default=7, ge=1, le=30)


class ReorderAction(BaseModel):
    status: str = Field(pattern="^(approved|rejected)$")


class POItemInput(BaseModel):
    product_id: int
    quantity: int = Field(gt=0)
    unit_price: float = Field(gt=0)


class PurchaseOrderInput(BaseModel):
    supplier_id: int
    expected_delivery: date | None = None
    items: list[POItemInput] = Field(min_length=1)


class StatusUpdate(BaseModel):
    status: str = Field(pattern="^(draft|approved|ordered|received|cancelled)$")


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=1000)
    conversation_id: int | None = None


class WhatIfRequest(BaseModel):
    product_id: int
    demand_change_pct: float = Field(default=0, ge=-50, le=100)
    price_change_pct: float = Field(default=0, ge=-50, le=100)
    promotion: bool = False
    lead_time_days: int | None = Field(default=None, ge=0, le=365)
