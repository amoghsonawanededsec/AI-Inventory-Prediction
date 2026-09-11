"""Grounded conversational router.

Quantitative replies originate from tool functions below.  A production LLM adapter can
turn those validated results into richer prose, but it never receives permission to
invent a number.
"""
from datetime import date, timedelta
import re
import httpx
from sqlalchemy import func
from sqlalchemy.orm import Session
from .forecasting import forecast_sum
from .operations import build_reorder
from ..models import KnowledgeChunk, KnowledgeDocument, Product, Sale, Supplier, WastePrediction

INTENT_KEYWORDS = {
    "low_stock": ("low stock", "below reorder", "run out", "restock", "critical stock", "stockout"),
    "forecast": ("forecast", "demand", "next week", "will sell", "actual versus predicted", "which model"),
    "expiry": ("expire", "expiry", "expiring"),
    "waste_risk": ("waste", "surplus", "at risk"),
    "reorder": ("order", "reorder", "purchase"),
    "sales_analytics": ("revenue", "highest selling", "generated", "sales this month", "sales decrease", "promotions increase"),
    "supplier": ("supplier", "lead time", "vendor", "provide", "deliveries"),
    "what_if": ("what if", "promotion", "increase demand", "price change", "sales increase", "demand increases", "sales decrease"),
    "explanation": ("why", "how does", "explain", "policy", "safety stock"),
    "inventory_status": ("inventory", "stock", "available", "how many products"),
}


def detect_intent(message: str) -> str:
    text = message.lower()
    # Resolve high-value phrasing before loose keyword scoring.  In particular,
    # "below reorder point" is a low-stock query, whereas "should I order" asks
    # for the reorder calculation.
    if re.search(r"\bwhat if\b|\b(?:\d+%|[a-z]+ percent)\s+(?:sales|demand).*(?:increase|decrease)|(?:sales|demand).*(?:increase|decrease).*(?:\d+%|[a-z]+ percent)|lead time increases", text):
        return "what_if"
    if re.search(r"^(?:why|explain)\b", text):
        if "sales" in text or "promotion" in text:
            return "sales_analytics"
        if re.search(r"recommend ordering|reorder point", text):
            return "reorder"
        return "explanation"
    if re.search(r"below (?:their )?reorder point|low[ -]stock|critical stock|run out|stockout", text):
        return "low_stock"
    if "waiting for approval" in text or "recommendations" in text and "approval" in text:
        return "reorder"
    if "approval" in text or "approve a reorder" in text:
        return "general_inventory_help"
    if re.search(r"(?:how much|should i|what should i).{0,80}\border\b|\breorder\b", text):
        return "reorder"
    scores = {intent: sum(keyword in text for keyword in words) for intent, words in INTENT_KEYWORDS.items()}
    winner, score = max(scores.items(), key=lambda item: item[1])
    return winner if score else "general_inventory_help"


def find_product(db: Session, message: str) -> Product | None:
    lower = message.lower()
    candidates = db.query(Product).all()
    matched = [p for p in candidates if p.name.lower() in lower or p.sku.lower() in lower]
    if not matched:
        terms = set(re.findall(r"[a-z0-9]+", lower))
        matched = [p for p in candidates if any(token in terms for token in re.findall(r"[a-z0-9]+", p.name.lower()) if len(token) > 2)]
    return max(matched, key=lambda p: len(p.name), default=None)


def retrieve(db: Session, message: str, limit: int = 2) -> list[dict]:
    query_terms = set(re.findall(r"[a-z]{3,}", message.lower()))
    chunks = db.query(KnowledgeChunk).all()
    scored = []
    for chunk in chunks:
        terms = set(re.findall(r"[a-z]{3,}", chunk.content.lower()))
        score = len(query_terms & terms)
        if score:
            doc = db.get(KnowledgeDocument, chunk.document_id)
            scored.append((score, chunk, doc))
    return [{"title": doc.title, "section": chunk.metadata_json.get("section", "Policy"), "content": chunk.content} for _, chunk, doc in sorted(scored, key=lambda r: r[0], reverse=True)[:limit]]


def tool_inventory(db: Session, message: str) -> tuple[str, dict]:
    product = find_product(db, message)
    if product:
        return f"{product.name} has {product.current_stock} {product.unit}(s) in stock. Its reorder point is {product.reorder_point}.", {"product_id": product.id, "current_stock": product.current_stock}
    totals = db.query(func.count(Product.id), func.coalesce(func.sum(Product.current_stock), 0), func.coalesce(func.sum(Product.current_stock * Product.price), 0)).one()
    return f"There are {totals[0]} active product records with {int(totals[1])} units worth ₹{float(totals[2]):,.2f} in stock.", {"product_count": totals[0], "units": int(totals[1]), "value": float(totals[2])}


def tool_low_stock(db: Session) -> tuple[str, dict]:
    products = db.query(Product).filter(Product.current_stock <= Product.reorder_point, Product.status == "active").order_by(Product.current_stock).all()
    if not products:
        return "No active products are currently at or below their reorder point.", {"products": []}
    labels = [f"{p.name} ({p.current_stock}/{p.reorder_point})" for p in products[:8]]
    return f"{len(products)} product(s) need attention: " + ", ".join(labels) + ".", {"products": [p.id for p in products]}


def tool_forecast(db: Session, message: str) -> tuple[str, dict]:
    product = find_product(db, message)
    days_match = re.search(r"(7|14|30)\s*day", message.lower())
    days = int(days_match.group(1)) if days_match else 7
    if not product:
        return "Please specify a product (for example, “milk demand over the next 7 days”) so I can query its forecast.", {"needs_product": True}
    quantity = forecast_sum(db, product, days)
    return f"Forecast demand for {product.name} over the next {days} days is {quantity} {product.unit}(s), using the stored seasonal baseline from recent sales.", {"product_id": product.id, "days": days, "predicted_quantity": quantity}


def tool_expiry(db: Session, message: str) -> tuple[str, dict]:
    days_match = re.search(r"(?:within|next)\s*(\d+)\s*day", message.lower())
    days = int(days_match.group(1)) if days_match else 7
    today = date.today()
    rows = db.query(Product).filter(Product.expiry_date.is_not(None), Product.expiry_date <= today + timedelta(days=days)).order_by(Product.expiry_date).all()
    if not rows:
        return f"No products have an expiry date within the next {days} days.", {"products": []}
    labels = [f"{p.name} ({p.expiry_date.isoformat()})" for p in rows[:10]]
    return f"{len(rows)} product(s) are expired or expiring within {days} days: " + ", ".join(labels) + ".", {"products": [p.id for p in rows], "days": days}


def tool_waste(db: Session) -> tuple[str, dict]:
    rows = db.query(WastePrediction, Product).join(Product, Product.id == WastePrediction.product_id).order_by(WastePrediction.estimated_value.desc()).limit(8).all()
    if not rows:
        return "Waste risk has not been calculated yet. Refresh operational insights first.", {"products": []}
    high = [(w, p) for w, p in rows if w.risk_level == "HIGH"]
    selected = high or rows
    labels = [f"{p.name}: {w.risk_level} ({w.units_at_risk} units, ₹{float(w.estimated_value):,.2f})" for w, p in selected]
    return "Highest waste-risk products: " + "; ".join(labels) + ".", {"products": [p.id for w, p in selected]}


def tool_reorder(db: Session, message: str) -> tuple[str, dict]:
    product = find_product(db, message)
    if product:
        recommendation = build_reorder(db, product)
        db.commit()
        return recommendation.explanation, {"recommendation_id": recommendation.id, "quantity": recommendation.recommended_quantity}
    rows = db.query(Product).filter(Product.current_stock <= Product.reorder_point).all()
    recommendations = [build_reorder(db, p) for p in rows]
    db.commit()
    if not recommendations:
        return "There are no products currently at or below their reorder point.", {"recommendations": []}
    return "Recommended orders: " + "; ".join(f"{db.get(Product, r.product_id).name}: {r.recommended_quantity}" for r in recommendations[:8]) + ".", {"recommendations": [r.id for r in recommendations]}


def tool_revenue(db: Session) -> tuple[str, dict]:
    start = date.today().replace(day=1)
    total = float(db.query(func.coalesce(func.sum(Sale.revenue), 0)).filter(Sale.date >= start).scalar())
    result = db.query(Product.name, func.sum(Sale.revenue).label("revenue")).join(Sale, Sale.product_id == Product.id).filter(Sale.date >= start).group_by(Product.name).order_by(func.sum(Sale.revenue).desc()).first()
    if not result:
        return "There are no sales records for this month.", {"revenue": 0}
    return f"Month-to-date revenue is ₹{total:,.2f}. {result.name} is the highest-revenue product at ₹{float(result.revenue):,.2f}.", {"revenue": total, "top_product": result.name}


def tool_supplier(db: Session, message: str) -> tuple[str, dict]:
    lower = message.lower()
    supplier = next((s for s in db.query(Supplier).all() if s.name.lower() in lower), None)
    if supplier:
        return f"{supplier.name}: lead time {supplier.lead_time_days} days, minimum order {supplier.minimum_order_quantity}, reliability score {supplier.reliability_score:.0%}.", {"supplier_id": supplier.id}
    if "shortest" in lower or "lead time" in lower:
        supplier = db.query(Supplier).order_by(Supplier.lead_time_days).first()
        return f"{supplier.name} has the shortest configured lead time at {supplier.lead_time_days} days (reliability {supplier.reliability_score:.0%}).", {"supplier_id": supplier.id}
    product = find_product(db, message)
    if product:
        supplier = db.get(Supplier, product.supplier_id)
        return f"{product.name} is supplied by {supplier.name}; its configured lead time is {supplier.lead_time_days} days.", {"supplier_id": supplier.id, "product_id": product.id}
    return "Please name a supplier or product for contact and lead-time details.", {"needs_supplier": True}


def tool_what_if(db: Session, message: str) -> tuple[str, dict]:
    product = find_product(db, message)
    if not product:
        return "Please name a product for a what-if scenario so I can calculate stockout, waste, and order impact from live data.", {"needs_product": True}
    percent = re.search(r"(\d+)\s*%", message)
    change = int(percent.group(1)) if percent else 10
    direction = -1 if any(term in message.lower() for term in ("decrease", "drop", "reduce")) else 1
    lead_demand = forecast_sum(db, product, max(1, product.lead_time_days))
    adjusted = round(lead_demand * (1 + direction * change / 100))
    order = max(0, adjusted + product.safety_stock - product.current_stock)
    risk = "HIGH" if product.current_stock < adjusted else "LOW"
    return f"If {product.name} demand changes by {direction * change:+d}%, lead-time demand changes from {lead_demand} to {adjusted} units. Stockout risk is {risk}; the revised recommended order is {order} units.", {"product_id": product.id, "forecast_demand": adjusted, "recommended_order": order, "stockout_risk": risk}


async def generate_llm_response(original_response: str, message: str) -> str:
    from ..config import get_settings
    settings = get_settings()
    if not settings.llm_api_key or not settings.llm_model:
        return original_response
    
    prompt = (
        f"You are a helpful AI inventory assistant. The user asked: '{message}'. "
        f"The internal system returned this validated factual result: '{original_response}'. "
        f"Rephrase this fact into a helpful, natural conversational response. "
        f"DO NOT invent any numbers or change facts. Keep all numerical quantities, dates, and currency values exact."
    )
    
    base_url = (getattr(settings, "llm_base_url", None) or "https://api.nugen.in/api/v3").rstrip("/")
    if "nugen" in base_url.lower():
        endpoint = f"{base_url}/inference/chat/completions"
        payload = {
            "model": settings.llm_model,
            "messages": [
                {"role": "system", "content": "You are a professional inventory and supply chain decision assistant."},
                {"role": "user", "content": prompt}
            ],
            "max_tokens": 500,
            "temperature": 0.3,
            "reasoning": {"enabled": True}
        }
    else:
        endpoint = f"{base_url}/chat/completions"
        payload = {
            "model": settings.llm_model,
            "messages": [
                {"role": "system", "content": "You are a professional inventory and supply chain decision assistant."},
                {"role": "user", "content": prompt}
            ],
            "max_tokens": 500,
            "temperature": 0.3
        }
    
    try:
        async with httpx.AsyncClient(timeout=6.0) as client:
            resp = await client.post(
                endpoint,
                headers={
                    "Authorization": f"Bearer {settings.llm_api_key}",
                    "Content-Type": "application/json"
                },
                json=payload
            )
            if resp.status_code == 200:
                data = resp.json()
                choices = data.get("choices", [])
                if choices and "message" in choices[0] and choices[0]["message"].get("content"):
                    return choices[0]["message"]["content"].strip()
            else:
                print(f"LLM API call returned status {resp.status_code}. Using validated system output.")
    except Exception as e:
        print(f"LLM API call skipped ({type(e).__name__}). Using validated system output.")
    
    return original_response


async def answer(db: Session, message: str) -> tuple[str, str, dict, list[dict]]:
    intent = detect_intent(message)
    citations: list[dict] = []
    if intent == "inventory_status":
        response, data = tool_inventory(db, message)
    elif intent == "low_stock":
        response, data = tool_low_stock(db)
    elif intent == "forecast":
        response, data = tool_forecast(db, message)
    elif intent == "expiry":
        response, data = tool_expiry(db, message)
    elif intent == "waste_risk":
        response, data = tool_waste(db)
    elif intent == "reorder":
        response, data = tool_reorder(db, message)
    elif intent == "sales_analytics":
        response, data = tool_revenue(db)
    elif intent == "supplier":
        response, data = tool_supplier(db, message)
    elif intent == "what_if":
        response, data = tool_what_if(db, message)
    else:
        citations = retrieve(db, message)
        if citations:
            response, data = citations[0]["content"], {"source": citations[0]["title"]}
        else:
            response, data = "I can help with live inventory, low stock, demand forecasts, expiry, waste risk, orders, sales revenue, and suppliers. Ask a specific inventory question.", {}
    
    final_response = await generate_llm_response(response, message)
    return final_response, intent, data, citations
