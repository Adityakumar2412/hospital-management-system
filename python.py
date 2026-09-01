"""
Hospital Management System - Python Backend
FastAPI application with Supabase integration
"""
import os
import json
from datetime import datetime, date, time, timedelta
from typing import Optional, List
from decimal import Decimal

from fastapi import FastAPI, HTTPException, Depends, Header, Query, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse, FileResponse
from pydantic import BaseModel, EmailStr, Field, validator
from dotenv import load_dotenv
from supabase import create_client, Client
from jose import jwt, JWTError
import httpx
import io
import csv

# Load environment variables
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL", "https://prszqwicndnyfvxvwoka.supabase.co")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InByc3pxd2ljbmRueWZ2eHZ3b2thIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczMTkwNTYsImV4cCI6MjEwMjg5NTA1Nn0.JCfofFF_JaMYSe7p6rxK20qcZ9VBCTFNOL1-biiGj7s")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InByc3pxd2ljbmRueWZ2eHZ3b2thIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzMxOTA1NiwiZXhwIjoyMTAyODk1MDU2fQ.lF_0Eai1g0MYmw2py563ITPXWSW_KHIKf94cSOu3HIo")
JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "Lpkmuku5p7LcpFIxzcKBCiVPXXtrHDtlBm0ESGQzFHkAZf015dPRy7fsh5Fmg+80iqxZKmm8JIn/al2nfgo1dQ==")

# Default Admin Credentials
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "adityakumar9523340408@gmail.com")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "Adityakumar@9508")
ADMIN_INQUIRY_EMAIL = os.getenv("ADMIN_INQUIRY_EMAIL", "adiityakumar9523340408@gmail.com")

# Initialize Supabase clients
# Service role client for admin operations (bypasses RLS)
supabase_admin: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) if SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY else None
# Anon client for public operations
supabase_anon: Client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY) if SUPABASE_URL and SUPABASE_ANON_KEY else None

# ============================================
# FastAPI App Setup
# ============================================
app = FastAPI(
    title="Hospital Management System API",
    description="Backend API for Hospital Management System",
    version="1.0.0"
)

# CORS - allow frontend to connect
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify exact origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================
# Pydantic Models
# ============================================

class RegisterRequest(BaseModel):
    email: str
    password: str
    full_name: str
    phone: Optional[str] = None
    date_of_birth: Optional[str] = None
    gender: Optional[str] = None
    address: Optional[str] = None
    blood_group: Optional[str] = None

class LoginRequest(BaseModel):
    email: str
    password: str

class ProfileUpdate(BaseModel):
    full_name: Optional[str] = None
    phone: Optional[str] = None
    date_of_birth: Optional[str] = None
    gender: Optional[str] = None
    address: Optional[str] = None
    blood_group: Optional[str] = None
    avatar_url: Optional[str] = None

class DoctorCreate(BaseModel):
    full_name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    gender: Optional[str] = None
    department_id: Optional[str] = None
    specialization: str
    qualification: Optional[str] = None
    experience: Optional[int] = 0
    consultation_fee: Optional[float] = 0
    available_days: Optional[List[str]] = None
    available_time_start: Optional[str] = "09:00"
    available_time_end: Optional[str] = "17:00"
    avatar_url: Optional[str] = None
    status: Optional[str] = "active"

class DoctorUpdate(BaseModel):
    full_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    gender: Optional[str] = None
    department_id: Optional[str] = None
    specialization: Optional[str] = None
    qualification: Optional[str] = None
    experience: Optional[int] = None
    consultation_fee: Optional[float] = None
    available_days: Optional[List[str]] = None
    available_time_start: Optional[str] = None
    available_time_end: Optional[str] = None
    avatar_url: Optional[str] = None
    status: Optional[str] = None

class AppointmentCreate(BaseModel):
    doctor_id: str
    department_id: Optional[str] = None
    appointment_date: str
    appointment_time: str
    reason: Optional[str] = None

class AppointmentUpdate(BaseModel):
    appointment_date: Optional[str] = None
    appointment_time: Optional[str] = None
    reason: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = None

class DepartmentCreate(BaseModel):
    name: str
    description: Optional[str] = None
    head_doctor_id: Optional[str] = None
    status: Optional[str] = "active"

class DepartmentUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    head_doctor_id: Optional[str] = None
    status: Optional[str] = None

class MedicalRecordCreate(BaseModel):
    patient_id: str
    doctor_id: Optional[str] = None
    diagnosis: str
    symptoms: Optional[str] = None
    treatment: Optional[str] = None
    notes: Optional[str] = None
    record_date: Optional[str] = None
    followup_date: Optional[str] = None

class MedicalRecordUpdate(BaseModel):
    doctor_id: Optional[str] = None
    diagnosis: Optional[str] = None
    symptoms: Optional[str] = None
    treatment: Optional[str] = None
    notes: Optional[str] = None
    followup_date: Optional[str] = None

class PrescriptionCreate(BaseModel):
    patient_id: str
    doctor_id: Optional[str] = None
    appointment_id: Optional[str] = None
    prescription_date: Optional[str] = None
    notes: Optional[str] = None
    items: Optional[List[dict]] = []

class PrescriptionUpdate(BaseModel):
    doctor_id: Optional[str] = None
    notes: Optional[str] = None
    items: Optional[List[dict]] = None

class LabReportCreate(BaseModel):
    patient_id: str
    doctor_id: Optional[str] = None
    test_name: str
    test_date: Optional[str] = None
    result: Optional[str] = None
    reference_range: Optional[str] = None
    status: Optional[str] = "pending"
    report_file_url: Optional[str] = None
    notes: Optional[str] = None

class LabReportUpdate(BaseModel):
    result: Optional[str] = None
    reference_range: Optional[str] = None
    status: Optional[str] = None
    report_file_url: Optional[str] = None
    notes: Optional[str] = None

class BillingCreate(BaseModel):
    patient_id: str
    appointment_id: Optional[str] = None
    consultation_fee: Optional[float] = 0
    lab_charges: Optional[float] = 0
    medicine_charges: Optional[float] = 0
    room_charges: Optional[float] = 0
    other_charges: Optional[float] = 0
    paid_amount: Optional[float] = 0
    payment_status: Optional[str] = "pending"

class BillingUpdate(BaseModel):
    consultation_fee: Optional[float] = None
    lab_charges: Optional[float] = None
    medicine_charges: Optional[float] = None
    room_charges: Optional[float] = None
    other_charges: Optional[float] = None
    paid_amount: Optional[float] = None
    payment_status: Optional[str] = None

class PaymentCreate(BaseModel):
    billing_id: str
    patient_id: str
    amount: float
    payment_method: Optional[str] = "cash"
    transaction_ref: Optional[str] = None

class RoomCreate(BaseModel):
    room_number: str
    room_type: str
    floor: Optional[int] = 1
    status: Optional[str] = "available"

class RoomUpdate(BaseModel):
    room_number: Optional[str] = None
    room_type: Optional[str] = None
    floor: Optional[int] = None
    status: Optional[str] = None

class BedUpdate(BaseModel):
    is_available: Optional[bool] = None
    patient_id: Optional[str] = None
    admission_date: Optional[str] = None
    discharge_date: Optional[str] = None

class MedicineCreate(BaseModel):
    name: str
    category: Optional[str] = None
    manufacturer: Optional[str] = None
    quantity: Optional[int] = 0
    batch_number: Optional[str] = None
    expiry_date: Optional[str] = None
    price: Optional[float] = 0
    supplier: Optional[str] = None
    stock_status: Optional[str] = "in_stock"

class MedicineUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    manufacturer: Optional[str] = None
    quantity: Optional[int] = None
    batch_number: Optional[str] = None
    expiry_date: Optional[str] = None
    price: Optional[float] = None
    supplier: Optional[str] = None
    stock_status: Optional[str] = None

class EmergencyCreate(BaseModel):
    patient_name: str
    contact_number: Optional[str] = None
    emergency_type: str
    doctor_id: Optional[str] = None
    room_id: Optional[str] = None
    priority: Optional[str] = "medium"
    status: Optional[str] = "active"
    notes: Optional[str] = None

class EmergencyUpdate(BaseModel):
    patient_name: Optional[str] = None
    contact_number: Optional[str] = None
    emergency_type: Optional[str] = None
    doctor_id: Optional[str] = None
    room_id: Optional[str] = None
    priority: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = None

class NotificationCreate(BaseModel):
    user_id: str
    title: str
    message: Optional[str] = None
    type: Optional[str] = "info"

class PasswordUpdateRequest(BaseModel):
    new_password: str

class SettingUpdate(BaseModel):
    key: str
    value: str

class DirectInquiryRequest(BaseModel):
    full_name: str
    email: str
    phone: Optional[str] = "Not provided"
    department: Optional[str] = "General Inquiries"
    message: str

class AdminCreateRequest(BaseModel):
    full_name: str
    email: str
    password: str

class UserStatusUpdateRequest(BaseModel):
    status: str

# ============================================
# Authentication Helpers
# ============================================

async def get_current_user(authorization: Optional[str] = Header(None)):
    """Extract and validate user from JWT token"""
    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization header required")

    token = authorization.replace("Bearer ", "").replace("bearer ", "").strip()
    try:
        # Verify the JWT with Supabase Auth
        user_response = supabase_admin.auth.get_user(token)
        if not user_response or not user_response.user:
            raise HTTPException(status_code=401, detail="Invalid or expired access token")
        return user_response.user
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Authentication failed: {str(e)}")


async def require_admin(authorization: Optional[str] = Header(None)):
    """Verify user is an authenticated and active admin"""
    user = await get_current_user(authorization)
    profile = supabase_admin.table("profiles").select("role, status").eq("id", str(user.id)).single().execute()
    if not profile.data or profile.data.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Administrator authorization required")
    if profile.data.get("status") == "disabled":
        raise HTTPException(status_code=403, detail="Administrator account has been disabled")
    return user


def log_activity(user_id: str, action: str, entity_type: str = None, entity_id: str = None, details: dict = None):
    """Log admin/user activity"""
    try:
        supabase_admin.table("activity_logs").insert({
            "user_id": user_id,
            "action": action,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "details": details or {}
        }).execute()
    except Exception:
        pass  # Don't fail operations due to logging errors


def create_notification(user_id: str, title: str, message: str = "", notif_type: str = "info"):
    """Create a notification for a user"""
    try:
        supabase_admin.table("notifications").insert({
            "user_id": user_id,
            "title": title,
            "message": message,
            "type": notif_type
        }).execute()
    except Exception:
        pass

# ============================================
# AUTH ENDPOINTS
# ============================================

@app.post("/api/auth/register")
async def register(req: RegisterRequest):
    """Register a new patient"""
    try:
        # Create user in Supabase Auth
        user = supabase_admin.auth.admin.create_user({
            "email": req.email,
            "password": req.password,
            "email_confirm": True,
            "user_metadata": {
                "full_name": req.full_name,
                "role": "patient"
            }
        })

        if not user or not user.user:
            raise HTTPException(status_code=400, detail="Registration failed")

        # Update profile with additional details
        update_data = {}
        if req.phone:
            update_data["phone"] = req.phone
        if req.date_of_birth:
            update_data["date_of_birth"] = req.date_of_birth
        if req.gender:
            update_data["gender"] = req.gender
        if req.address:
            update_data["address"] = req.address
        if req.blood_group:
            update_data["blood_group"] = req.blood_group

        if update_data:
            supabase_admin.table("profiles").update(update_data).eq("id", user.user.id).execute()

        # Create welcome notification
        create_notification(
            user.user.id,
            "Welcome to MediCare Hospital!",
            "Your account has been created successfully. Complete your profile to get started.",
            "info"
        )

        log_activity(user.user.id, "registered", "user", str(user.user.id))

        return {"success": True, "message": "Registration successful", "user_id": str(user.user.id)}

    except HTTPException:
        raise
    except Exception as e:
        error_msg = str(e)
        if "already been registered" in error_msg.lower() or "already exists" in error_msg.lower():
            raise HTTPException(status_code=409, detail="An account with this email already exists")
        raise HTTPException(status_code=400, detail=f"Registration failed: {error_msg}")


@app.post("/api/auth/login")
async def login(req: LoginRequest):
    """Login a user (patient or admin)"""
    try:
        auth_response = supabase_anon.auth.sign_in_with_password({
            "email": req.email,
            "password": req.password
        })

        if not auth_response or not auth_response.user:
            raise HTTPException(status_code=401, detail="Invalid credentials")

        # Get profile with role
        profile = supabase_admin.table("profiles").select("*").eq("id", auth_response.user.id).single().execute()

        log_activity(auth_response.user.id, "login", "user", str(auth_response.user.id))

        return {
            "success": True,
            "session": {
                "access_token": auth_response.session.access_token,
                "refresh_token": auth_response.session.refresh_token,
                "expires_at": auth_response.session.expires_at
            },
            "user": {
                "id": str(auth_response.user.id),
                "email": auth_response.user.email,
                "role": profile.data.get("role", "patient") if profile.data else "patient"
            },
            "profile": profile.data
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=401, detail="Invalid email or password")


@app.post("/api/auth/admin-login")
async def admin_login(req: LoginRequest):
    """Login specifically for admin users"""
    try:
        try:
            auth_response = supabase_anon.auth.sign_in_with_password({
                "email": req.email,
                "password": req.password
            })
        except Exception:
            # Fallback for configured main admin credentials
            if req.email == ADMIN_EMAIL and req.password == ADMIN_PASSWORD:
                auth_response = supabase_anon.auth.sign_in_with_password({
                    "email": "admin@medicare.com",
                    "password": "Admin@123456"
                })
            else:
                raise

        if not auth_response or not auth_response.user:
            raise HTTPException(status_code=401, detail="Invalid credentials")

        # Verify admin role
        profile = supabase_admin.table("profiles").select("*").eq("id", auth_response.user.id).single().execute()
        if not profile.data or profile.data.get("role") != "admin":
            raise HTTPException(status_code=403, detail="Access denied. Admin privileges required.")

        log_activity(auth_response.user.id, "admin_login", "user", str(auth_response.user.id))

        return {
            "success": True,
            "session": {
                "access_token": auth_response.session.access_token,
                "refresh_token": auth_response.session.refresh_token,
                "expires_at": auth_response.session.expires_at
            },
            "user": {
                "id": str(auth_response.user.id),
                "email": auth_response.user.email,
                "role": "admin"
            },
            "profile": profile.data
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=401, detail="Invalid credentials")


@app.post("/api/auth/forgot-password")
async def forgot_password(email: str = Query(...)):
    """Send password reset email"""
    try:
        supabase_anon.auth.reset_password_email(email)
        return {"success": True, "message": "Password reset email sent if account exists"}
    except Exception:
        # Don't reveal if email exists
        return {"success": True, "message": "Password reset email sent if account exists"}


@app.put("/api/auth/update-password")
async def update_password(req: PasswordUpdateRequest, user=Depends(get_current_user)):
    """Update user password"""
    try:
        supabase_admin.auth.admin.update_user_by_id(user.id, {"password": req.new_password})
        return {"success": True, "message": "Password updated successfully"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to update password: {str(e)}")


@app.post("/api/auth/create-admin")
async def create_admin(req: RegisterRequest, admin_secret: str = Query(...)):
    """Create an admin account (requires admin setup secret from .env)"""
    expected_secret = os.getenv("ADMIN_SETUP_SECRET", "")
    if not expected_secret or admin_secret != expected_secret:
        raise HTTPException(status_code=403, detail="Invalid or unconfigured admin setup secret")

    try:
        user = supabase_admin.auth.admin.create_user({
            "email": req.email,
            "password": req.password,
            "email_confirm": True,
            "user_metadata": {
                "full_name": req.full_name,
                "role": "admin"
            }
        })

        if not user or not user.user:
            raise HTTPException(status_code=400, detail="Admin creation failed")

        # Update profile role to admin
        supabase_admin.table("profiles").update({"role": "admin"}).eq("id", user.user.id).execute()

        return {"success": True, "message": "Admin account created", "user_id": str(user.user.id)}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed: {str(e)}")


# ============================================
# PROFILE ENDPOINTS
# ============================================

@app.get("/api/patient/profile")
async def get_profile(user=Depends(get_current_user)):
    """Get current user's profile"""
    profile = supabase_admin.table("profiles").select("*").eq("id", user.id).single().execute()
    if not profile.data:
        raise HTTPException(status_code=404, detail="Profile not found")
    return {"success": True, "data": profile.data}


@app.put("/api/patient/profile")
async def update_profile(req: ProfileUpdate, user=Depends(get_current_user)):
    """Update current user's profile"""
    update_data = {k: v for k, v in req.dict().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail="No data to update")

    result = supabase_admin.table("profiles").update(update_data).eq("id", user.id).execute()
    log_activity(str(user.id), "profile_updated", "profile", str(user.id))
    return {"success": True, "data": result.data[0] if result.data else None}


# ============================================
# DASHBOARD ENDPOINTS
# ============================================

@app.get("/api/patient/dashboard")
async def patient_dashboard(user=Depends(get_current_user)):
    """Get patient dashboard data"""
    uid = str(user.id)

    # Upcoming appointments
    upcoming = supabase_admin.table("appointments")\
        .select("*, doctors(full_name, specialization, avatar_url), departments(name)")\
        .eq("patient_id", uid)\
        .in_("status", ["pending", "confirmed"])\
        .gte("appointment_date", date.today().isoformat())\
        .order("appointment_date")\
        .limit(5)\
        .execute()

    # Counts
    total_appointments = supabase_admin.table("appointments")\
        .select("id", count="exact")\
        .eq("patient_id", uid)\
        .execute()

    upcoming_count = supabase_admin.table("appointments")\
        .select("id", count="exact")\
        .eq("patient_id", uid)\
        .in_("status", ["pending", "confirmed"])\
        .gte("appointment_date", date.today().isoformat())\
        .execute()

    prescriptions_count = supabase_admin.table("prescriptions")\
        .select("id", count="exact")\
        .eq("patient_id", uid)\
        .execute()

    reports_count = supabase_admin.table("lab_reports")\
        .select("id", count="exact")\
        .eq("patient_id", uid)\
        .execute()

    pending_bills = supabase_admin.table("billing")\
        .select("id", count="exact")\
        .eq("patient_id", uid)\
        .in_("payment_status", ["pending", "partially_paid"])\
        .execute()

    unread_notifs = supabase_admin.table("notifications")\
        .select("id", count="exact")\
        .eq("user_id", uid)\
        .eq("is_read", False)\
        .execute()

    # Recent items
    recent_records = supabase_admin.table("medical_records")\
        .select("*, doctors(full_name)")\
        .eq("patient_id", uid)\
        .order("record_date", desc=True)\
        .limit(3)\
        .execute()

    recent_prescriptions = supabase_admin.table("prescriptions")\
        .select("*, doctors(full_name)")\
        .eq("patient_id", uid)\
        .order("prescription_date", desc=True)\
        .limit(3)\
        .execute()

    recent_notifications = supabase_admin.table("notifications")\
        .select("*")\
        .eq("user_id", uid)\
        .order("created_at", desc=True)\
        .limit(5)\
        .execute()

    return {
        "success": True,
        "data": {
            "stats": {
                "upcoming_appointments": upcoming_count.count or 0,
                "total_appointments": total_appointments.count or 0,
                "prescriptions": prescriptions_count.count or 0,
                "medical_reports": reports_count.count or 0,
                "pending_bills": pending_bills.count or 0,
                "unread_notifications": unread_notifs.count or 0
            },
            "upcoming_appointments": upcoming.data or [],
            "recent_records": recent_records.data or [],
            "recent_prescriptions": recent_prescriptions.data or [],
            "recent_notifications": recent_notifications.data or []
        }
    }


@app.get("/api/admin/stats")
async def admin_dashboard(user=Depends(require_admin)):
    """Get admin dashboard statistics"""
    today = date.today().isoformat()

    total_patients = supabase_admin.table("profiles")\
        .select("id", count="exact").eq("role", "patient").execute()

    total_doctors = supabase_admin.table("doctors")\
        .select("id", count="exact").eq("status", "active").execute()

    today_appointments = supabase_admin.table("appointments")\
        .select("id", count="exact").eq("appointment_date", today).execute()

    pending_appointments = supabase_admin.table("appointments")\
        .select("id", count="exact").eq("status", "pending").execute()

    available_beds = supabase_admin.table("beds")\
        .select("id", count="exact").eq("is_available", True).execute()

    occupied_beds = supabase_admin.table("beds")\
        .select("id", count="exact").eq("is_available", False).execute()

    # Today's revenue
    today_billing = supabase_admin.table("billing")\
        .select("paid_amount").eq("invoice_date", today).execute()
    today_revenue = sum(float(b.get("paid_amount", 0)) for b in (today_billing.data or []))

    pending_payments = supabase_admin.table("billing")\
        .select("remaining_amount")\
        .in_("payment_status", ["pending", "partially_paid"]).execute()
    total_pending = sum(float(b.get("remaining_amount", 0)) for b in (pending_payments.data or []))

    emergency_active = supabase_admin.table("emergency_cases")\
        .select("id", count="exact").eq("status", "active").execute()

    # Charts data - last 7 days appointments
    seven_days_ago = (date.today() - timedelta(days=6)).isoformat()
    recent_appointments = supabase_admin.table("appointments")\
        .select("appointment_date, status")\
        .gte("appointment_date", seven_days_ago)\
        .lte("appointment_date", today)\
        .execute()

    # Group by date
    appt_by_date = {}
    status_counts = {"pending": 0, "confirmed": 0, "completed": 0, "cancelled": 0, "rejected": 0}
    for a in (recent_appointments.data or []):
        d = a["appointment_date"]
        appt_by_date[d] = appt_by_date.get(d, 0) + 1
        s = a.get("status", "pending")
        if s in status_counts:
            status_counts[s] += 1

    # Department appointment counts
    dept_stats = supabase_admin.table("appointments")\
        .select("department_id, departments(name)")\
        .gte("appointment_date", seven_days_ago)\
        .execute()
    dept_counts = {}
    for a in (dept_stats.data or []):
        dept_name = a.get("departments", {}).get("name", "Unknown") if a.get("departments") else "Unknown"
        dept_counts[dept_name] = dept_counts.get(dept_name, 0) + 1

    # Room occupancy
    room_stats = supabase_admin.table("rooms")\
        .select("room_type, status").execute()
    room_occupancy = {}
    for r in (room_stats.data or []):
        rt = r["room_type"]
        if rt not in room_occupancy:
            room_occupancy[rt] = {"total": 0, "occupied": 0, "available": 0}
        room_occupancy[rt]["total"] += 1
        if r["status"] == "occupied":
            room_occupancy[rt]["occupied"] += 1
        else:
            room_occupancy[rt]["available"] += 1

    # Patient registrations trend (last 30 days)
    thirty_days_ago = (date.today() - timedelta(days=29)).isoformat()
    recent_patients = supabase_admin.table("profiles")\
        .select("created_at")\
        .eq("role", "patient")\
        .gte("created_at", thirty_days_ago)\
        .execute()
    patient_trend = {}
    for p in (recent_patients.data or []):
        d = p["created_at"][:10]
        patient_trend[d] = patient_trend.get(d, 0) + 1

    # Low stock medicines
    low_stock = supabase_admin.table("medicines")\
        .select("*")\
        .in_("stock_status", ["low_stock", "out_of_stock"])\
        .execute()

    return {
        "success": True,
        "data": {
            "stats": {
                "total_patients": total_patients.count or 0,
                "total_doctors": total_doctors.count or 0,
                "today_appointments": today_appointments.count or 0,
                "pending_appointments": pending_appointments.count or 0,
                "available_beds": available_beds.count or 0,
                "occupied_beds": occupied_beds.count or 0,
                "today_revenue": today_revenue,
                "pending_payments": total_pending,
                "emergency_cases": emergency_active.count or 0
            },
            "charts": {
                "appointments_by_date": appt_by_date,
                "appointment_status": status_counts,
                "department_performance": dept_counts,
                "room_occupancy": room_occupancy,
                "patient_registrations": patient_trend
            },
            "alerts": {
                "low_stock_medicines": low_stock.data or []
            }
        }
    }


# ============================================
# DIRECT INQUIRY ENDPOINTS
# ============================================

@app.post("/api/contact/inquiry")
@app.post("/api/inquiries")
async def submit_direct_inquiry(inquiry: DirectInquiryRequest):
    """
    Public Endpoint: Submit a direct inquiry
    Logs inquiry to Supabase activity records
    """
    try:
        # Log to Supabase activity logs
        try:
            if supabase_admin:
                supabase_admin.table("activity_logs").insert({
                    "action": "DIRECT_INQUIRY",
                    "entity_type": "inquiries",
                    "details": f"Inquiry from {inquiry.full_name} ({inquiry.email}, {inquiry.phone}) for {inquiry.department}: {inquiry.message}"
                }).execute()
        except Exception as log_err:
            print("Supabase activity log notice:", log_err)

        return {
            "success": True,
            "message": f"Inquiry received successfully for {ADMIN_INQUIRY_EMAIL}"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to process inquiry: {str(e)}")


# ============================================
# DOCTOR ENDPOINTS
# ============================================

@app.get("/api/doctors")
async def list_doctors(
    search: Optional[str] = None,
    department: Optional[str] = None,
    specialization: Optional[str] = None,
    status: Optional[str] = "active",
    page: int = 1,
    limit: int = 20
):
    """List doctors (public endpoint)"""
    query = supabase_admin.table("doctors")\
        .select("*, departments!doctors_department_id_fkey(name)", count="exact")

    if status:
        query = query.eq("status", status)
    if department:
        query = query.eq("department_id", department)
    if specialization:
        query = query.ilike("specialization", f"%{specialization}%")
    if search:
        query = query.or_(f"full_name.ilike.%{search}%,specialization.ilike.%{search}%,email.ilike.%{search}%")

    offset = (page - 1) * limit
    result = query.order("full_name").range(offset, offset + limit - 1).execute()

    return {
        "success": True,
        "data": result.data or [],
        "total": result.count or 0,
        "page": page,
        "limit": limit
    }


@app.get("/api/doctors/{doctor_id}")
async def get_doctor(doctor_id: str):
    """Get doctor details"""
    result = supabase_admin.table("doctors")\
        .select("*, departments!doctors_department_id_fkey(name)")\
        .eq("id", doctor_id)\
        .single()\
        .execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Doctor not found")
    return {"success": True, "data": result.data}


@app.get("/api/doctors/{doctor_id}/slots")
async def get_available_slots(doctor_id: str, date_str: str = Query(..., alias="date")):
    """Get available appointment slots for a doctor on a specific date"""
    # Get doctor schedule
    doctor = supabase_admin.table("doctors")\
        .select("available_days, available_time_start, available_time_end")\
        .eq("id", doctor_id)\
        .single()\
        .execute()

    if not doctor.data:
        raise HTTPException(status_code=404, detail="Doctor not found")

    doc = doctor.data
    # Check if the date falls on an available day
    try:
        target_date = datetime.strptime(date_str, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")

    day_name = target_date.strftime("%A")
    if day_name not in (doc.get("available_days") or []):
        return {"success": True, "data": [], "message": f"Doctor is not available on {day_name}"}

    # Generate slots
    start_time = datetime.strptime(doc.get("available_time_start", "09:00"), "%H:%M")
    end_time = datetime.strptime(doc.get("available_time_end", "17:00"), "%H:%M")
    slot_duration = 30  # minutes

    slots = []
    current = start_time
    while current + timedelta(minutes=slot_duration) <= end_time:
        slots.append(current.strftime("%H:%M"))
        current += timedelta(minutes=slot_duration)

    # Get booked slots for that date
    booked = supabase_admin.table("appointments")\
        .select("appointment_time")\
        .eq("doctor_id", doctor_id)\
        .eq("appointment_date", date_str)\
        .in_("status", ["pending", "confirmed"])\
        .execute()

    booked_times = set()
    for b in (booked.data or []):
        t = b["appointment_time"]
        # Normalize time format (handle HH:MM:SS)
        booked_times.add(t[:5])

    available_slots = [s for s in slots if s not in booked_times]

    return {"success": True, "data": available_slots}


@app.post("/api/admin/doctors")
async def create_doctor(req: DoctorCreate, user=Depends(require_admin)):
    """Create a new doctor"""
    data = {k: v for k, v in req.dict().items() if v is not None}
    result = supabase_admin.table("doctors").insert(data).execute()

    if result.data:
        log_activity(str(user.id), "created_doctor", "doctor", str(result.data[0]["id"]),
                     {"name": req.full_name})
    return {"success": True, "data": result.data[0] if result.data else None}


@app.put("/api/admin/doctors/{doctor_id}")
async def update_doctor(doctor_id: str, req: DoctorUpdate, user=Depends(require_admin)):
    """Update a doctor"""
    data = {k: v for k, v in req.dict().items() if v is not None}
    if not data:
        raise HTTPException(status_code=400, detail="No data to update")

    result = supabase_admin.table("doctors").update(data).eq("id", doctor_id).execute()
    log_activity(str(user.id), "updated_doctor", "doctor", doctor_id)
    return {"success": True, "data": result.data[0] if result.data else None}


@app.delete("/api/admin/doctors/{doctor_id}")
async def delete_doctor(doctor_id: str, user=Depends(require_admin)):
    """Deactivate a doctor"""
    result = supabase_admin.table("doctors")\
        .update({"status": "inactive"}).eq("id", doctor_id).execute()
    log_activity(str(user.id), "deactivated_doctor", "doctor", doctor_id)
    return {"success": True, "message": "Doctor deactivated"}


# ============================================
# APPOINTMENT ENDPOINTS
# ============================================

@app.get("/api/patient/appointments")
async def get_patient_appointments(
    user=Depends(get_current_user),
    status: Optional[str] = None,
    page: int = 1,
    limit: int = 20
):
    """Get patient's appointments"""
    query = supabase_admin.table("appointments")\
        .select("*, doctors(full_name, specialization, avatar_url), departments(name)", count="exact")\
        .eq("patient_id", str(user.id))

    if status:
        query = query.eq("status", status)

    offset = (page - 1) * limit
    result = query.order("appointment_date", desc=True).range(offset, offset + limit - 1).execute()

    return {
        "success": True,
        "data": result.data or [],
        "total": result.count or 0,
        "page": page
    }


@app.post("/api/patient/appointments")
async def book_appointment(req: AppointmentCreate, user=Depends(get_current_user)):
    """Book a new appointment"""
    uid = str(user.id)

    # Validate date is in the future
    try:
        appt_date = datetime.strptime(req.appointment_date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format")

    if appt_date < date.today():
        raise HTTPException(status_code=400, detail="Cannot book appointments in the past")

    # Check if slot is available
    existing = supabase_admin.table("appointments")\
        .select("id")\
        .eq("doctor_id", req.doctor_id)\
        .eq("appointment_date", req.appointment_date)\
        .eq("appointment_time", req.appointment_time)\
        .in_("status", ["pending", "confirmed"])\
        .execute()

    if existing.data:
        raise HTTPException(status_code=409, detail="This time slot is already booked")

    data = {
        "patient_id": uid,
        "doctor_id": req.doctor_id,
        "department_id": req.department_id,
        "appointment_date": req.appointment_date,
        "appointment_time": req.appointment_time,
        "reason": req.reason,
        "status": "pending"
    }

    result = supabase_admin.table("appointments").insert(data).execute()

    if result.data:
        # Get doctor name for notification
        doctor = supabase_admin.table("doctors").select("full_name").eq("id", req.doctor_id).single().execute()
        doctor_name = doctor.data.get("full_name", "Doctor") if doctor.data else "Doctor"

        create_notification(
            uid,
            "Appointment Booked",
            f"Your appointment with {doctor_name} on {req.appointment_date} at {req.appointment_time} has been booked and is pending confirmation.",
            "appointment"
        )
        log_activity(uid, "booked_appointment", "appointment", str(result.data[0]["id"]))

    return {"success": True, "data": result.data[0] if result.data else None}


@app.put("/api/patient/appointments/{appointment_id}")
async def update_patient_appointment(appointment_id: str, req: AppointmentUpdate, user=Depends(get_current_user)):
    """Reschedule or cancel a patient's appointment"""
    uid = str(user.id)

    # Verify ownership
    existing = supabase_admin.table("appointments")\
        .select("*").eq("id", appointment_id).eq("patient_id", uid).single().execute()

    if not existing.data:
        raise HTTPException(status_code=404, detail="Appointment not found")

    if existing.data["status"] in ["completed", "cancelled", "rejected"]:
        raise HTTPException(status_code=400, detail="Cannot modify this appointment")

    update_data = {k: v for k, v in req.dict().items() if v is not None}

    # If rescheduling, check slot availability
    if "appointment_date" in update_data or "appointment_time" in update_data:
        new_date = update_data.get("appointment_date", existing.data["appointment_date"])
        new_time = update_data.get("appointment_time", existing.data["appointment_time"])

        conflict = supabase_admin.table("appointments")\
            .select("id")\
            .eq("doctor_id", existing.data["doctor_id"])\
            .eq("appointment_date", new_date)\
            .eq("appointment_time", new_time)\
            .neq("id", appointment_id)\
            .in_("status", ["pending", "confirmed"])\
            .execute()

        if conflict.data:
            raise HTTPException(status_code=409, detail="New time slot is already booked")

    result = supabase_admin.table("appointments")\
        .update(update_data).eq("id", appointment_id).execute()

    action = "cancelled_appointment" if update_data.get("status") == "cancelled" else "rescheduled_appointment"
    log_activity(uid, action, "appointment", appointment_id)

    # Notify
    if update_data.get("status") == "cancelled":
        create_notification(uid, "Appointment Cancelled",
                          "Your appointment has been cancelled.", "appointment")

    return {"success": True, "data": result.data[0] if result.data else None}


@app.get("/api/admin/appointments")
async def admin_list_appointments(
    user=Depends(require_admin),
    status: Optional[str] = None,
    doctor_id: Optional[str] = None,
    patient_id: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    search: Optional[str] = None,
    page: int = 1,
    limit: int = 20
):
    """Admin: list all appointments with filters"""
    query = supabase_admin.table("appointments")\
        .select("*, doctors(full_name, specialization), departments(name), profiles!appointments_patient_id_fkey(full_name, email, phone)", count="exact")

    if status:
        query = query.eq("status", status)
    if doctor_id:
        query = query.eq("doctor_id", doctor_id)
    if patient_id:
        query = query.eq("patient_id", patient_id)
    if date_from:
        query = query.gte("appointment_date", date_from)
    if date_to:
        query = query.lte("appointment_date", date_to)

    offset = (page - 1) * limit
    result = query.order("appointment_date", desc=True).range(offset, offset + limit - 1).execute()

    return {
        "success": True,
        "data": result.data or [],
        "total": result.count or 0,
        "page": page
    }


@app.put("/api/admin/appointments/{appointment_id}")
async def admin_update_appointment(appointment_id: str, req: AppointmentUpdate, user=Depends(require_admin)):
    """Admin: update appointment status"""
    update_data = {k: v for k, v in req.dict().items() if v is not None}
    result = supabase_admin.table("appointments")\
        .update(update_data).eq("id", appointment_id).execute()

    if result.data and update_data.get("status"):
        # Notify patient
        patient_id = result.data[0].get("patient_id")
        if patient_id:
            status_msg = {
                "confirmed": "Your appointment has been confirmed.",
                "rejected": "Your appointment has been rejected.",
                "completed": "Your appointment has been marked as completed.",
                "cancelled": "Your appointment has been cancelled by admin."
            }
            msg = status_msg.get(update_data["status"], f"Appointment status updated to {update_data['status']}")
            create_notification(patient_id, f"Appointment {update_data['status'].title()}", msg, "appointment")

    log_activity(str(user.id), f"appointment_{update_data.get('status', 'updated')}", "appointment", appointment_id)
    return {"success": True, "data": result.data[0] if result.data else None}


# ============================================
# DEPARTMENT ENDPOINTS
# ============================================

@app.get("/api/departments")
async def list_departments():
    """List all departments"""
    result = supabase_admin.table("departments")\
        .select("*, doctors(id)", count="exact")\
        .eq("status", "active")\
        .order("name")\
        .execute()

    # Add doctor count
    departments = []
    for dept in (result.data or []):
        dept["doctor_count"] = len(dept.get("doctors", []))
        dept.pop("doctors", None)
        departments.append(dept)

    return {"success": True, "data": departments}


@app.post("/api/admin/departments")
async def create_department(req: DepartmentCreate, user=Depends(require_admin)):
    data = {k: v for k, v in req.dict().items() if v is not None}
    result = supabase_admin.table("departments").insert(data).execute()
    log_activity(str(user.id), "created_department", "department",
                 str(result.data[0]["id"]) if result.data else None)
    return {"success": True, "data": result.data[0] if result.data else None}


@app.put("/api/admin/departments/{dept_id}")
async def update_department(dept_id: str, req: DepartmentUpdate, user=Depends(require_admin)):
    data = {k: v for k, v in req.dict().items() if v is not None}
    result = supabase_admin.table("departments").update(data).eq("id", dept_id).execute()
    log_activity(str(user.id), "updated_department", "department", dept_id)
    return {"success": True, "data": result.data[0] if result.data else None}


@app.delete("/api/admin/departments/{dept_id}")
async def delete_department(dept_id: str, user=Depends(require_admin)):
    supabase_admin.table("departments").update({"status": "inactive"}).eq("id", dept_id).execute()
    log_activity(str(user.id), "deactivated_department", "department", dept_id)
    return {"success": True, "message": "Department deactivated"}


# ============================================
# MEDICAL RECORDS ENDPOINTS
# ============================================

@app.get("/api/patient/medical-records")
async def get_patient_records(user=Depends(get_current_user), page: int = 1, limit: int = 20):
    offset = (page - 1) * limit
    result = supabase_admin.table("medical_records")\
        .select("*, doctors(full_name, specialization)", count="exact")\
        .eq("patient_id", str(user.id))\
        .order("record_date", desc=True)\
        .range(offset, offset + limit - 1)\
        .execute()
    return {"success": True, "data": result.data or [], "total": result.count or 0, "page": page}


@app.get("/api/admin/medical-records")
async def admin_list_records(
    user=Depends(require_admin),
    patient_id: Optional[str] = None,
    search: Optional[str] = None,
    page: int = 1,
    limit: int = 20
):
    query = supabase_admin.table("medical_records")\
        .select("*, doctors(full_name), profiles!medical_records_patient_id_fkey(full_name, email)", count="exact")
    if patient_id:
        query = query.eq("patient_id", patient_id)
    if search:
        query = query.or_(f"diagnosis.ilike.%{search}%,symptoms.ilike.%{search}%,treatment.ilike.%{search}%")
    offset = (page - 1) * limit
    result = query.order("record_date", desc=True).range(offset, offset + limit - 1).execute()
    return {"success": True, "data": result.data or [], "total": result.count or 0, "page": page}


@app.post("/api/admin/medical-records")
async def create_record(req: MedicalRecordCreate, user=Depends(require_admin)):
    data = {k: v for k, v in req.dict().items() if v is not None}
    result = supabase_admin.table("medical_records").insert(data).execute()
    if result.data:
        create_notification(req.patient_id, "New Medical Record",
                          f"A new medical record has been added: {req.diagnosis}", "info")
        log_activity(str(user.id), "created_medical_record", "medical_record", str(result.data[0]["id"]))
    return {"success": True, "data": result.data[0] if result.data else None}


@app.put("/api/admin/medical-records/{record_id}")
async def update_record(record_id: str, req: MedicalRecordUpdate, user=Depends(require_admin)):
    data = {k: v for k, v in req.dict().items() if v is not None}
    result = supabase_admin.table("medical_records").update(data).eq("id", record_id).execute()
    log_activity(str(user.id), "updated_medical_record", "medical_record", record_id)
    return {"success": True, "data": result.data[0] if result.data else None}


@app.delete("/api/admin/medical-records/{record_id}")
async def delete_record(record_id: str, user=Depends(require_admin)):
    supabase_admin.table("medical_records").delete().eq("id", record_id).execute()
    log_activity(str(user.id), "deleted_medical_record", "medical_record", record_id)
    return {"success": True, "message": "Record deleted"}


# ============================================
# PRESCRIPTION ENDPOINTS
# ============================================

@app.get("/api/patient/prescriptions")
async def get_patient_prescriptions(user=Depends(get_current_user), page: int = 1, limit: int = 20):
    offset = (page - 1) * limit
    result = supabase_admin.table("prescriptions")\
        .select("*, doctors(full_name, specialization), prescription_items(*)", count="exact")\
        .eq("patient_id", str(user.id))\
        .order("prescription_date", desc=True)\
        .range(offset, offset + limit - 1)\
        .execute()
    return {"success": True, "data": result.data or [], "total": result.count or 0, "page": page}


@app.get("/api/admin/prescriptions")
async def admin_list_prescriptions(
    user=Depends(require_admin),
    patient_id: Optional[str] = None,
    page: int = 1,
    limit: int = 20
):
    query = supabase_admin.table("prescriptions")\
        .select("*, doctors(full_name), profiles!prescriptions_patient_id_fkey(full_name, email), prescription_items(*)", count="exact")
    if patient_id:
        query = query.eq("patient_id", patient_id)
    offset = (page - 1) * limit
    result = query.order("prescription_date", desc=True).range(offset, offset + limit - 1).execute()
    return {"success": True, "data": result.data or [], "total": result.count or 0, "page": page}


@app.post("/api/admin/prescriptions")
async def create_prescription(req: PrescriptionCreate, user=Depends(require_admin)):
    items = req.items or []
    data = {k: v for k, v in req.dict().items() if v is not None and k != "items"}
    result = supabase_admin.table("prescriptions").insert(data).execute()

    if result.data and items:
        presc_id = result.data[0]["id"]
        for item in items:
            item["prescription_id"] = presc_id
        supabase_admin.table("prescription_items").insert(items).execute()

    if result.data:
        create_notification(req.patient_id, "New Prescription",
                          "A new prescription has been issued for you.", "prescription")
        log_activity(str(user.id), "created_prescription", "prescription", str(result.data[0]["id"]))

    return {"success": True, "data": result.data[0] if result.data else None}


@app.put("/api/admin/prescriptions/{presc_id}")
async def update_prescription(presc_id: str, req: PrescriptionUpdate, user=Depends(require_admin)):
    data = {k: v for k, v in req.dict().items() if v is not None and k != "items"}
    if data:
        supabase_admin.table("prescriptions").update(data).eq("id", presc_id).execute()

    if req.items is not None:
        # Replace items
        supabase_admin.table("prescription_items").delete().eq("prescription_id", presc_id).execute()
        for item in req.items:
            item["prescription_id"] = presc_id
        if req.items:
            supabase_admin.table("prescription_items").insert(req.items).execute()

    result = supabase_admin.table("prescriptions")\
        .select("*, prescription_items(*)").eq("id", presc_id).single().execute()
    log_activity(str(user.id), "updated_prescription", "prescription", presc_id)
    return {"success": True, "data": result.data}


@app.delete("/api/admin/prescriptions/{presc_id}")
async def delete_prescription(presc_id: str, user=Depends(require_admin)):
    supabase_admin.table("prescriptions").delete().eq("id", presc_id).execute()
    log_activity(str(user.id), "deleted_prescription", "prescription", presc_id)
    return {"success": True, "message": "Prescription deleted"}


# ============================================
# LAB REPORT ENDPOINTS
# ============================================

@app.get("/api/patient/lab-reports")
async def get_patient_lab_reports(user=Depends(get_current_user), page: int = 1, limit: int = 20):
    offset = (page - 1) * limit
    result = supabase_admin.table("lab_reports")\
        .select("*, doctors(full_name)", count="exact")\
        .eq("patient_id", str(user.id))\
        .order("test_date", desc=True)\
        .range(offset, offset + limit - 1)\
        .execute()
    return {"success": True, "data": result.data or [], "total": result.count or 0, "page": page}


@app.get("/api/admin/lab-reports")
async def admin_list_lab_reports(
    user=Depends(require_admin),
    patient_id: Optional[str] = None,
    status: Optional[str] = None,
    page: int = 1,
    limit: int = 20
):
    query = supabase_admin.table("lab_reports")\
        .select("*, doctors(full_name), profiles!lab_reports_patient_id_fkey(full_name, email)", count="exact")
    if patient_id:
        query = query.eq("patient_id", patient_id)
    if status:
        query = query.eq("status", status)
    offset = (page - 1) * limit
    result = query.order("test_date", desc=True).range(offset, offset + limit - 1).execute()
    return {"success": True, "data": result.data or [], "total": result.count or 0, "page": page}


@app.post("/api/admin/lab-reports")
async def create_lab_report(req: LabReportCreate, user=Depends(require_admin)):
    data = {k: v for k, v in req.dict().items() if v is not None}
    result = supabase_admin.table("lab_reports").insert(data).execute()
    if result.data:
        create_notification(req.patient_id, "New Lab Report",
                          f"Your lab report for {req.test_name} is available.", "lab_report")
        log_activity(str(user.id), "created_lab_report", "lab_report", str(result.data[0]["id"]))
    return {"success": True, "data": result.data[0] if result.data else None}


@app.put("/api/admin/lab-reports/{report_id}")
async def update_lab_report(report_id: str, req: LabReportUpdate, user=Depends(require_admin)):
    data = {k: v for k, v in req.dict().items() if v is not None}
    result = supabase_admin.table("lab_reports").update(data).eq("id", report_id).execute()
    log_activity(str(user.id), "updated_lab_report", "lab_report", report_id)
    return {"success": True, "data": result.data[0] if result.data else None}


@app.delete("/api/admin/lab-reports/{report_id}")
async def delete_lab_report(report_id: str, user=Depends(require_admin)):
    supabase_admin.table("lab_reports").delete().eq("id", report_id).execute()
    log_activity(str(user.id), "deleted_lab_report", "lab_report", report_id)
    return {"success": True, "message": "Lab report deleted"}


# ============================================
# BILLING ENDPOINTS
# ============================================

@app.get("/api/patient/billing")
async def get_patient_billing(user=Depends(get_current_user), page: int = 1, limit: int = 20):
    offset = (page - 1) * limit
    result = supabase_admin.table("billing")\
        .select("*, appointments(appointment_date, doctors(full_name))", count="exact")\
        .eq("patient_id", str(user.id))\
        .order("invoice_date", desc=True)\
        .range(offset, offset + limit - 1)\
        .execute()
    return {"success": True, "data": result.data or [], "total": result.count or 0, "page": page}


@app.get("/api/admin/billing")
async def admin_list_billing(
    user=Depends(require_admin),
    patient_id: Optional[str] = None,
    payment_status: Optional[str] = None,
    page: int = 1,
    limit: int = 20
):
    query = supabase_admin.table("billing")\
        .select("*, profiles!billing_patient_id_fkey(full_name, email), appointments(appointment_date, doctors(full_name))", count="exact")
    if patient_id:
        query = query.eq("patient_id", patient_id)
    if payment_status:
        query = query.eq("payment_status", payment_status)
    offset = (page - 1) * limit
    result = query.order("invoice_date", desc=True).range(offset, offset + limit - 1).execute()
    return {"success": True, "data": result.data or [], "total": result.count or 0, "page": page}


@app.post("/api/admin/billing")
async def create_bill(req: BillingCreate, user=Depends(require_admin)):
    data = {k: v for k, v in req.dict().items() if v is not None}
    result = supabase_admin.table("billing").insert(data).execute()
    if result.data:
        create_notification(req.patient_id, "New Invoice",
                          f"A new invoice of ${data.get('consultation_fee', 0) + data.get('lab_charges', 0) + data.get('medicine_charges', 0) + data.get('room_charges', 0) + data.get('other_charges', 0):.2f} has been generated.",
                          "billing")
        log_activity(str(user.id), "created_bill", "billing", str(result.data[0]["id"]))
    return {"success": True, "data": result.data[0] if result.data else None}


@app.put("/api/admin/billing/{bill_id}")
async def update_bill(bill_id: str, req: BillingUpdate, user=Depends(require_admin)):
    data = {k: v for k, v in req.dict().items() if v is not None}
    result = supabase_admin.table("billing").update(data).eq("id", bill_id).execute()
    log_activity(str(user.id), "updated_bill", "billing", bill_id)
    return {"success": True, "data": result.data[0] if result.data else None}


@app.post("/api/admin/payments")
async def record_payment(req: PaymentCreate, user=Depends(require_admin)):
    """Record a payment and update billing"""
    data = {k: v for k, v in req.dict().items() if v is not None}
    payment_result = supabase_admin.table("payments").insert(data).execute()

    # Update billing paid amount
    billing = supabase_admin.table("billing").select("*").eq("id", req.billing_id).single().execute()
    if billing.data:
        new_paid = float(billing.data.get("paid_amount", 0)) + req.amount
        supabase_admin.table("billing").update({"paid_amount": new_paid}).eq("id", req.billing_id).execute()

    create_notification(req.patient_id, "Payment Received",
                       f"Payment of ${req.amount:.2f} has been recorded.", "billing")
    log_activity(str(user.id), "recorded_payment", "payment",
                 str(payment_result.data[0]["id"]) if payment_result.data else None)

    return {"success": True, "data": payment_result.data[0] if payment_result.data else None}


# ============================================
# MEDICINE ENDPOINTS
# ============================================

@app.get("/api/admin/medicines")
async def list_medicines(
    user=Depends(require_admin),
    search: Optional[str] = None,
    category: Optional[str] = None,
    stock_status: Optional[str] = None,
    page: int = 1,
    limit: int = 20
):
    query = supabase_admin.table("medicines").select("*", count="exact")
    if search:
        query = query.or_(f"name.ilike.%{search}%,category.ilike.%{search}%,manufacturer.ilike.%{search}%")
    if category:
        query = query.eq("category", category)
    if stock_status:
        query = query.eq("stock_status", stock_status)
    offset = (page - 1) * limit
    result = query.order("name").range(offset, offset + limit - 1).execute()

    # Check for expiring medicines
    today = date.today()
    for med in (result.data or []):
        if med.get("expiry_date"):
            exp = datetime.strptime(med["expiry_date"], "%Y-%m-%d").date()
            if exp < today:
                med["_warning"] = "expired"
            elif exp < today + timedelta(days=90):
                med["_warning"] = "near_expiry"

    return {"success": True, "data": result.data or [], "total": result.count or 0, "page": page}


@app.post("/api/admin/medicines")
async def create_medicine(req: MedicineCreate, user=Depends(require_admin)):
    data = {k: v for k, v in req.dict().items() if v is not None}
    result = supabase_admin.table("medicines").insert(data).execute()
    log_activity(str(user.id), "created_medicine", "medicine",
                 str(result.data[0]["id"]) if result.data else None)
    return {"success": True, "data": result.data[0] if result.data else None}


@app.put("/api/admin/medicines/{med_id}")
async def update_medicine(med_id: str, req: MedicineUpdate, user=Depends(require_admin)):
    data = {k: v for k, v in req.dict().items() if v is not None}
    result = supabase_admin.table("medicines").update(data).eq("id", med_id).execute()
    log_activity(str(user.id), "updated_medicine", "medicine", med_id)
    return {"success": True, "data": result.data[0] if result.data else None}


@app.delete("/api/admin/medicines/{med_id}")
async def delete_medicine(med_id: str, user=Depends(require_admin)):
    supabase_admin.table("medicines").delete().eq("id", med_id).execute()
    log_activity(str(user.id), "deleted_medicine", "medicine", med_id)
    return {"success": True, "message": "Medicine deleted"}


# ============================================
# ROOM & BED ENDPOINTS
# ============================================

@app.get("/api/admin/rooms")
async def list_rooms(
    user=Depends(require_admin),
    room_type: Optional[str] = None,
    status: Optional[str] = None,
    page: int = 1,
    limit: int = 50
):
    query = supabase_admin.table("rooms")\
        .select("*, beds(id, bed_number, is_available, patient_id, profiles(full_name))", count="exact")
    if room_type:
        query = query.eq("room_type", room_type)
    if status:
        query = query.eq("status", status)
    offset = (page - 1) * limit
    result = query.order("room_number").range(offset, offset + limit - 1).execute()
    return {"success": True, "data": result.data or [], "total": result.count or 0, "page": page}


@app.post("/api/admin/rooms")
async def create_room(req: RoomCreate, user=Depends(require_admin)):
    data = {k: v for k, v in req.dict().items() if v is not None}
    result = supabase_admin.table("rooms").insert(data).execute()
    if result.data:
        # Create 2 default beds
        room_id = result.data[0]["id"]
        supabase_admin.table("beds").insert([
            {"room_id": room_id, "bed_number": "A"},
            {"room_id": room_id, "bed_number": "B"}
        ]).execute()
        log_activity(str(user.id), "created_room", "room", room_id)
    return {"success": True, "data": result.data[0] if result.data else None}


@app.put("/api/admin/rooms/{room_id}")
async def update_room(room_id: str, req: RoomUpdate, user=Depends(require_admin)):
    data = {k: v for k, v in req.dict().items() if v is not None}
    result = supabase_admin.table("rooms").update(data).eq("id", room_id).execute()
    log_activity(str(user.id), "updated_room", "room", room_id)
    return {"success": True, "data": result.data[0] if result.data else None}


@app.put("/api/admin/beds/{bed_id}")
async def update_bed(bed_id: str, req: BedUpdate, user=Depends(require_admin)):
    data = {k: v for k, v in req.dict().items() if v is not None}
    result = supabase_admin.table("beds").update(data).eq("id", bed_id).execute()

    # Update room status based on bed availability
    bed = supabase_admin.table("beds").select("room_id").eq("id", bed_id).single().execute()
    if bed.data:
        room_beds = supabase_admin.table("beds")\
            .select("is_available").eq("room_id", bed.data["room_id"]).execute()
        all_occupied = all(not b["is_available"] for b in (room_beds.data or []))
        room_status = "occupied" if all_occupied else "available"
        supabase_admin.table("rooms").update({"status": room_status}).eq("id", bed.data["room_id"]).execute()

    log_activity(str(user.id), "updated_bed", "bed", bed_id)
    return {"success": True, "data": result.data[0] if result.data else None}


# ============================================
# EMERGENCY ENDPOINTS
# ============================================

@app.get("/api/admin/emergency")
async def list_emergencies(
    user=Depends(require_admin),
    status: Optional[str] = None,
    priority: Optional[str] = None,
    page: int = 1,
    limit: int = 20
):
    query = supabase_admin.table("emergency_cases")\
        .select("*, doctors(full_name), rooms(room_number, room_type)", count="exact")
    if status:
        query = query.eq("status", status)
    if priority:
        query = query.eq("priority", priority)
    offset = (page - 1) * limit
    result = query.order("arrival_time", desc=True).range(offset, offset + limit - 1).execute()
    return {"success": True, "data": result.data or [], "total": result.count or 0, "page": page}


@app.post("/api/admin/emergency")
async def create_emergency(req: EmergencyCreate, user=Depends(require_admin)):
    data = {k: v for k, v in req.dict().items() if v is not None}
    result = supabase_admin.table("emergency_cases").insert(data).execute()
    log_activity(str(user.id), "created_emergency", "emergency",
                 str(result.data[0]["id"]) if result.data else None)
    return {"success": True, "data": result.data[0] if result.data else None}


@app.put("/api/admin/emergency/{emergency_id}")
async def update_emergency(emergency_id: str, req: EmergencyUpdate, user=Depends(require_admin)):
    data = {k: v for k, v in req.dict().items() if v is not None}
    result = supabase_admin.table("emergency_cases").update(data).eq("id", emergency_id).execute()
    log_activity(str(user.id), "updated_emergency", "emergency", emergency_id)
    return {"success": True, "data": result.data[0] if result.data else None}


# ============================================
# NOTIFICATION ENDPOINTS
# ============================================

@app.get("/api/patient/notifications")
async def get_notifications(user=Depends(get_current_user), page: int = 1, limit: int = 20):
    offset = (page - 1) * limit
    result = supabase_admin.table("notifications")\
        .select("*", count="exact")\
        .eq("user_id", str(user.id))\
        .order("created_at", desc=True)\
        .range(offset, offset + limit - 1)\
        .execute()

    unread = supabase_admin.table("notifications")\
        .select("id", count="exact")\
        .eq("user_id", str(user.id))\
        .eq("is_read", False)\
        .execute()

    return {
        "success": True,
        "data": result.data or [],
        "total": result.count or 0,
        "unread_count": unread.count or 0,
        "page": page
    }


@app.put("/api/patient/notifications/{notif_id}/read")
async def mark_notification_read(notif_id: str, user=Depends(get_current_user)):
    supabase_admin.table("notifications")\
        .update({"is_read": True})\
        .eq("id", notif_id)\
        .eq("user_id", str(user.id))\
        .execute()
    return {"success": True}


@app.put("/api/patient/notifications/read-all")
async def mark_all_read(user=Depends(get_current_user)):
    supabase_admin.table("notifications")\
        .update({"is_read": True})\
        .eq("user_id", str(user.id))\
        .eq("is_read", False)\
        .execute()
    return {"success": True}


@app.post("/api/admin/notifications")
async def admin_send_notification(req: NotificationCreate, user=Depends(require_admin)):
    data = {k: v for k, v in req.dict().items() if v is not None}
    result = supabase_admin.table("notifications").insert(data).execute()
    return {"success": True, "data": result.data[0] if result.data else None}


@app.get("/api/admin/notifications")
async def admin_list_notifications(user=Depends(require_admin), page: int = 1, limit: int = 20):
    offset = (page - 1) * limit
    result = supabase_admin.table("notifications")\
        .select("*, profiles!notifications_user_id_fkey(full_name, email)", count="exact")\
        .order("created_at", desc=True)\
        .range(offset, offset + limit - 1)\
        .execute()
    return {"success": True, "data": result.data or [], "total": result.count or 0, "page": page}


# ============================================
# ADMIN USER MANAGEMENT (ADMINS & PATIENTS)
# ============================================

@app.get("/api/admin/admins")
async def admin_list_admins(
    user=Depends(require_admin),
    search: Optional[str] = None
):
    """List all administrator accounts"""
    query = supabase_admin.table("profiles")\
        .select("id, full_name, email, role, status, created_at")\
        .eq("role", "admin")
    if search:
        query = query.or_(f"full_name.ilike.%{search}%,email.ilike.%{search}%")
    result = query.order("created_at", desc=False).execute()
    return {"success": True, "data": result.data or []}


@app.post("/api/admin/create-admin")
async def admin_create_new_admin(
    req: AdminCreateRequest,
    user=Depends(require_admin)
):
    """
    Create a new administrator account securely in Supabase Auth & profiles.
    Role is set to admin. Passwords are encrypted by Supabase Auth and never stored in plain text.
    """
    if not req.full_name or not req.email or not req.password:
        raise HTTPException(status_code=400, detail="Full Name, Email, and Password are required.")

    if len(req.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters long.")

    try:
        # 1. Create user in Supabase Auth via Service Role
        auth_user = supabase_admin.auth.admin.create_user({
            "email": req.email.strip().lower(),
            "password": req.password,
            "email_confirm": True,
            "user_metadata": {
                "full_name": req.full_name.strip(),
                "role": "admin"
            }
        })

        if not auth_user or not auth_user.user:
            raise HTTPException(status_code=400, detail="Failed to create auth user in Supabase.")

        user_id = str(auth_user.user.id)

        # 2. Upsert profile with admin role and active status
        profile_data = {
            "id": user_id,
            "full_name": req.full_name.strip(),
            "email": req.email.strip().lower(),
            "role": "admin",
            "status": "active"
        }
        supabase_admin.table("profiles").upsert(profile_data).execute()

        # 3. Log activity
        log_activity(str(user.id), "created_admin", "user", user_id, {"email": req.email, "name": req.full_name})

        return {
            "success": True,
            "message": f"Administrator account for {req.full_name} created successfully.",
            "data": profile_data
        }
    except HTTPException:
        raise
    except Exception as e:
        err_msg = str(e)
        if "already registered" in err_msg.lower() or "already exists" in err_msg.lower():
            raise HTTPException(status_code=409, detail="An account with this email address already exists.")
        raise HTTPException(status_code=500, detail=f"Failed to create admin: {err_msg}")


@app.put("/api/admin/users/{user_id}/status")
async def admin_update_user_status(
    user_id: str,
    req: UserStatusUpdateRequest,
    user=Depends(require_admin)
):
    """Enable or disable an administrator or patient account"""
    if req.status not in ["active", "disabled"]:
        raise HTTPException(status_code=400, detail="Status must be 'active' or 'disabled'.")

    # Safeguard: prevent disabling the acting main admin
    if str(user.id) == user_id and req.status == "disabled":
        raise HTTPException(status_code=400, detail="You cannot disable your own active administrator account.")

    # Check profile
    prof = supabase_admin.table("profiles").select("*").eq("id", user_id).single().execute()
    if not prof.data:
        raise HTTPException(status_code=404, detail="User account not found.")

    # Update status
    supabase_admin.table("profiles").update({"status": req.status}).eq("id", user_id).execute()
    log_activity(str(user.id), f"set_user_status_{req.status}", "user", user_id, {"previous_status": prof.data.get("status")})

    return {
        "success": True,
        "message": f"User status successfully changed to {req.status.upper()}."
    }


@app.delete("/api/admin/users/{user_id}")
async def admin_delete_user(
    user_id: str,
    user=Depends(require_admin)
):
    """Delete a user account (admin or patient)"""
    # Safeguard: cannot delete self
    if str(user.id) == user_id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account while logged in.")

    # Check profile
    prof = supabase_admin.table("profiles").select("*").eq("id", user_id).single().execute()
    if prof.data:
        # Safeguard protected emails
        if prof.data.get("email") in ["adityakumar9523340408@gmail.com", "admin@medicare.com"]:
            raise HTTPException(status_code=403, detail="Main system administrator account cannot be deleted.")

    try:
        # Delete profile
        supabase_admin.table("profiles").delete().eq("id", user_id).execute()
        # Delete from Supabase Auth
        try:
            supabase_admin.auth.admin.delete_user(user_id)
        except Exception as auth_err:
            print("Auth delete notice:", auth_err)

        log_activity(str(user.id), "deleted_user", "user", user_id)
        return {"success": True, "message": "User account deleted successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete user: {str(e)}")


# ============================================
# PATIENT MANAGEMENT (ADMIN)
# ============================================

@app.get("/api/admin/patients")
async def admin_list_patients(
    user=Depends(require_admin),
    search: Optional[str] = None,
    page: int = 1,
    limit: int = 20
):
    query = supabase_admin.table("profiles")\
        .select("*", count="exact")\
        .eq("role", "patient")
    if search:
        query = query.or_(f"full_name.ilike.%{search}%,email.ilike.%{search}%,phone.ilike.%{search}%")
    offset = (page - 1) * limit
    result = query.order("created_at", desc=True).range(offset, offset + limit - 1).execute()
    return {"success": True, "data": result.data or [], "total": result.count or 0, "page": page}


@app.get("/api/admin/patients/{patient_id}")
async def admin_get_patient(patient_id: str, user=Depends(require_admin)):
    profile = supabase_admin.table("profiles").select("*").eq("id", patient_id).single().execute()
    if not profile.data:
        raise HTTPException(status_code=404, detail="Patient not found")

    # Get summary counts
    appts = supabase_admin.table("appointments")\
        .select("id", count="exact").eq("patient_id", patient_id).execute()
    records = supabase_admin.table("medical_records")\
        .select("id", count="exact").eq("patient_id", patient_id).execute()
    bills = supabase_admin.table("billing")\
        .select("id", count="exact").eq("patient_id", patient_id).execute()

    return {
        "success": True,
        "data": {
            **profile.data,
            "total_appointments": appts.count or 0,
            "total_records": records.count or 0,
            "total_bills": bills.count or 0
        }
    }


# ============================================
# ACTIVITY LOGS
# ============================================

@app.get("/api/admin/activity-logs")
async def admin_activity_logs(
    user=Depends(require_admin),
    entity_type: Optional[str] = None,
    user_id: Optional[str] = None,
    page: int = 1,
    limit: int = 50
):
    query = supabase_admin.table("activity_logs")\
        .select("*, profiles!activity_logs_user_id_fkey(full_name, email)", count="exact")
    if entity_type:
        query = query.eq("entity_type", entity_type)
    if user_id:
        query = query.eq("user_id", user_id)
    offset = (page - 1) * limit
    result = query.order("created_at", desc=True).range(offset, offset + limit - 1).execute()
    return {"success": True, "data": result.data or [], "total": result.count or 0, "page": page}


# ============================================
# SETTINGS
# ============================================

@app.get("/api/settings")
async def get_settings():
    """Get public hospital settings"""
    result = supabase_admin.table("hospital_settings").select("*").execute()
    settings = {s["key"]: s["value"] for s in (result.data or [])}
    return {"success": True, "data": settings}


@app.put("/api/admin/settings")
async def update_settings(req: SettingUpdate, user=Depends(require_admin)):
    # Upsert setting
    existing = supabase_admin.table("hospital_settings")\
        .select("id").eq("key", req.key).execute()
    if existing.data:
        supabase_admin.table("hospital_settings")\
            .update({"value": req.value}).eq("key", req.key).execute()
    else:
        supabase_admin.table("hospital_settings")\
            .insert({"key": req.key, "value": req.value}).execute()
    log_activity(str(user.id), "updated_setting", "setting", None, {"key": req.key})
    return {"success": True}


# ============================================
# EXPORT ENDPOINTS
# ============================================

@app.get("/api/admin/export/{entity}")
async def export_data(entity: str, format: str = "csv", user=Depends(require_admin)):
    """Export data as CSV or JSON"""
    valid_entities = {
        "patients": ("profiles", {"role": "patient"}),
        "doctors": ("doctors", {}),
        "appointments": ("appointments", {}),
        "billing": ("billing", {}),
        "medicines": ("medicines", {}),
        "lab_reports": ("lab_reports", {}),
        "emergency": ("emergency_cases", {}),
    }

    if entity not in valid_entities:
        raise HTTPException(status_code=400, detail=f"Invalid entity. Choose from: {list(valid_entities.keys())}")

    table_name, filters = valid_entities[entity]
    query = supabase_admin.table(table_name).select("*")
    for k, v in filters.items():
        query = query.eq(k, v)
    result = query.execute()
    data = result.data or []

    if format == "json":
        return {"success": True, "data": data}

    # CSV export
    if not data:
        return {"success": True, "data": "", "message": "No data to export"}

    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=data[0].keys())
    writer.writeheader()
    writer.writerows(data)

    return StreamingResponse(
        io.BytesIO(output.getvalue().encode()),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={entity}_{date.today().isoformat()}.csv"}
    )


# ============================================
# FRONTEND STATIC ROUTES & HEALTH CHECK
# ============================================

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

@app.get("/")
async def serve_index():
    index_path = os.path.join(BASE_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path, media_type="text/html")
    return {"status": "running", "name": "MediCare Hospital System"}

@app.get("/style.css")
async def serve_style():
    css_path = os.path.join(BASE_DIR, "style.css")
    if os.path.exists(css_path):
        return FileResponse(css_path, media_type="text/css")
    raise HTTPException(status_code=404, detail="style.css not found")

@app.get("/script.js")
async def serve_script():
    js_path = os.path.join(BASE_DIR, "script.js")
    if os.path.exists(js_path):
        return FileResponse(js_path, media_type="application/javascript")
    raise HTTPException(status_code=404, detail="script.js not found")

@app.get("/api/health")
async def health_check():
    return {"status": "healthy", "timestamp": datetime.now().isoformat()}


# ============================================
# RUN SERVER
# ============================================
if __name__ == "__main__":
    import uvicorn
    print("=" * 50)
    print("  Hospital Management System - Backend API")
    print("  Running on http://localhost:8000")
    print("  API Docs: http://localhost:8000/docs")
    print("=" * 50)
    uvicorn.run("python:app", host="0.0.0.0", port=8000, reload=True)

