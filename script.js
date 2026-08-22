/**
 * MediCare Hospital Management System - Complete Frontend Controller
 * Full Supabase Integration (v2) + Python FastAPI Backend Support
 */

const App = {
  // -------------------------------------------------------------
  // 1. CONFIGURATION
  // -------------------------------------------------------------
  Config: {
    supabaseUrl: "https://prszqwicndnyfvxvwoka.supabase.co",
    supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InByc3pxd2ljbmRueWZ2eHZ3b2thIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczMTkwNTYsImV4cCI6MjEwMjg5NTA1Nn0.JCfofFF_JaMYSe7p6rxK20qcZ9VBCTFNOL1-biiGj7s",
    apiBaseUrl: "http://localhost:8000/api",
    client: null
  },

  // -------------------------------------------------------------
  // 2. STATE MANAGEMENT
  // -------------------------------------------------------------
  State: {
    user: null,
    profile: null,
    role: null, // 'patient' | 'admin'
    currentSection: null,
    cachedDoctors: [],
    cachedDepartments: [],
    cachedPatients: [],
    cachedRooms: [],
    charts: {}
  },

  // -------------------------------------------------------------
  // 3. INITIALIZATION
  // -------------------------------------------------------------
  async init() {
    try {
      // Initialize Supabase Client
      if (window.supabase) {
        App.Config.client = window.supabase.createClient(
          App.Config.supabaseUrl,
          App.Config.supabaseAnonKey
        );
        // Alias table to from for backward/cross-compatibility
        App.Config.client.table = function (tableName) {
          return this.from(tableName);
        };
      } else {
        console.error("Supabase client library not loaded.");
      }

      // Initialize UI Theme
      App.UI.initTheme();

      // Check session
      await App.Auth.checkSession();

      // Load Landing Page Data
      App.Landing.loadData();

      // Setup Realtime subscriptions if user is logged in
      if (App.State.user) {
        App.Realtime.setup();
      }
    } catch (err) {
      console.error("Initialization error:", err);
    }
  },

  // -------------------------------------------------------------
  // 4. API CALL HELPER
  // -------------------------------------------------------------
  async api(endpoint, method = "GET", body = null) {
    const session = App.Config.client?.auth ? (await App.Config.client.auth.getSession()).data.session : null;
    const headers = { "Content-Type": "application/json" };
    if (session?.access_token) {
      headers["Authorization"] = `Bearer ${session.access_token}`;
    }

    try {
      const response = await fetch(`${App.Config.apiBaseUrl}${endpoint}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : null
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `Request failed with status ${response.status}`);
      }

      return await response.json();
    } catch (err) {
      // Fallback: If FastAPI backend is not running, query Supabase directly
      console.warn(`Backend API not reachable for ${endpoint}. Falling back to direct Supabase query.`);
      return App.Fallback.handle(endpoint, method, body);
    }
  },

  // -------------------------------------------------------------
  // 5. DIRECT SUPABASE FALLBACK HANDLER
  // -------------------------------------------------------------
  Fallback: {
    async handle(endpoint, method, body) {
      const db = App.Config.client;
      if (!db) throw new Error("Supabase client not initialized");
      const uid = App.State.user?.id;

      // Public Doctors listing
      if (endpoint.startsWith("/doctors") && method === "GET") {
        let q = db.from("doctors").select("*, departments!doctors_department_id_fkey(name)").eq("status", "active").order("full_name");
        const urlParams = new URLSearchParams(endpoint.split("?")[1] || "");
        const dept = urlParams.get("department");
        if (dept) q = q.eq("department_id", dept);
        const { data, error } = await q;
        if (error) throw error;
        return { success: true, data: data || [] };
      }

      // Public Departments
      if (endpoint === "/departments" && method === "GET") {
        const { data, error } = await db.from("departments").select("*").eq("status", "active").order("name");
        if (error) throw error;
        return { success: true, data };
      }

      // Patient Dashboard
      if (endpoint === "/patient/dashboard" && method === "GET") {
        const today = new Date().toISOString().split("T")[0];
        const [appts, recs, prescs, labs, bills, notifs] = await Promise.all([
          db.from("appointments").select("*, doctors(full_name, specialization)", { count: "exact" }).eq("patient_id", uid).order("appointment_date"),
          db.from("medical_records").select("*, doctors(full_name)").eq("patient_id", uid).order("record_date", { ascending: false }).limit(3),
          db.from("prescriptions").select("*, doctors(full_name)", { count: "exact" }).eq("patient_id", uid),
          db.from("lab_reports").select("*", { count: "exact" }).eq("patient_id", uid),
          db.from("billing").select("*", { count: "exact" }).eq("patient_id", uid).in("payment_status", ["pending", "partially_paid"]),
          db.from("notifications").select("*").eq("user_id", uid).order("created_at", { ascending: false }).limit(5)
        ]);

        const upcoming = (appts.data || []).filter(a => a.appointment_date >= today && ["pending", "confirmed"].includes(a.status));

        return {
          success: true,
          data: {
            stats: {
              upcoming_appointments: upcoming.length,
              total_appointments: appts.count || 0,
              prescriptions: prescs.count || 0,
              medical_reports: labs.count || 0,
              pending_bills: bills.count || 0
            },
            upcoming_appointments: upcoming,
            recent_records: recs.data || [],
            recent_notifications: notifs.data || []
          }
        };
      }

      // Patient Profile
      if (endpoint === "/patient/profile" && method === "GET") {
        const { data, error } = await db.from("profiles").select("*").eq("id", uid).single();
        if (error) throw error;
        return { success: true, data };
      }

      // Patient Profile Update
      if (endpoint === "/patient/profile" && method === "PUT") {
        const { data, error } = await db.from("profiles").update(body).eq("id", uid).select().single();
        if (error) throw error;
        return { success: true, data };
      }

      // Patient Appointments
      if (endpoint.startsWith("/patient/appointments") && method === "GET") {
        const { data, error } = await db.from("appointments")
          .select("*, doctors(full_name, specialization, consultation_fee), departments(name)")
          .eq("patient_id", uid)
          .order("appointment_date", { ascending: false });
        if (error) throw error;
        return { success: true, data: data || [] };
      }

      // Book Appointment
      if (endpoint === "/patient/appointments" && method === "POST") {
        const insertData = { ...body, patient_id: uid, status: "pending" };
        const { data, error } = await db.from("appointments").insert(insertData).select().single();
        if (error) throw error;
        // Create notification
        await db.from("notifications").insert({
          user_id: uid,
          title: "Appointment Booked",
          message: `Appointment scheduled on ${body.appointment_date} at ${body.appointment_time}.`,
          type: "appointment"
        });
        return { success: true, data };
      }

      // Patient Medical Records
      if (endpoint === "/patient/medical-records") {
        const { data, error } = await db.from("medical_records").select("*, doctors(full_name, specialization)").eq("patient_id", uid).order("record_date", { ascending: false });
        if (error) throw error;
        return { success: true, data: data || [] };
      }

      // Patient Prescriptions
      if (endpoint === "/patient/prescriptions") {
        const { data, error } = await db.from("prescriptions").select("*, doctors(full_name, specialization), prescription_items(*)").eq("patient_id", uid).order("prescription_date", { ascending: false });
        if (error) throw error;
        return { success: true, data: data || [] };
      }

      // Patient Lab Reports
      if (endpoint === "/patient/lab-reports") {
        const { data, error } = await db.from("lab_reports").select("*, doctors(full_name)").eq("patient_id", uid).order("test_date", { ascending: false });
        if (error) throw error;
        return { success: true, data: data || [] };
      }

      // Patient Billing
      if (endpoint === "/patient/billing") {
        const { data, error } = await db.from("billing").select("*, appointments(appointment_date, doctors(full_name))").eq("patient_id", uid).order("invoice_date", { ascending: false });
        if (error) throw error;
        return { success: true, data: data || [] };
      }

      // Admin Stats
      if (endpoint === "/admin/stats") {
        const today = new Date().toISOString().split("T")[0];
        const [pts, docs, appts, beds, bills, emg, deptData, roomData] = await Promise.all([
          db.from("profiles").select("id", { count: "exact" }).eq("role", "patient"),
          db.from("doctors").select("id", { count: "exact" }).eq("status", "active"),
          db.from("appointments").select("*"),
          db.from("beds").select("*"),
          db.from("billing").select("*"),
          db.from("emergency_cases").select("*").eq("status", "active"),
          db.from("appointments").select("department_id, departments(name)"),
          db.from("rooms").select("room_type, status")
        ]);

        const todayAppts = (appts.data || []).filter(a => a.appointment_date === today);
        const pendingAppts = (appts.data || []).filter(a => a.status === "pending");
        const availableBeds = (beds.data || []).filter(b => b.is_available);
        const occupiedBeds = (beds.data || []).filter(b => !b.is_available);
        const todayRevenue = (bills.data || []).filter(b => b.invoice_date === today).reduce((s, b) => s + parseFloat(b.paid_amount || 0), 0);
        const pendingRevenue = (bills.data || []).reduce((s, b) => s + parseFloat(b.remaining_amount || 0), 0);

        // Chart calculations
        const statusCounts = { pending: 0, confirmed: 0, completed: 0, cancelled: 0, rejected: 0 };
        const apptByDate = {};
        (appts.data || []).forEach(a => {
          if (statusCounts[a.status] !== undefined) statusCounts[a.status]++;
          apptByDate[a.appointment_date] = (apptByDate[a.appointment_date] || 0) + 1;
        });

        const deptCounts = {};
        (deptData.data || []).forEach(d => {
          const name = d.departments?.name || "General";
          deptCounts[name] = (deptCounts[name] || 0) + 1;
        });

        const roomOcc = {};
        (roomData.data || []).forEach(r => {
          if (!roomOcc[r.room_type]) roomOcc[r.room_type] = { total: 0, occupied: 0, available: 0 };
          roomOcc[r.room_type].total++;
          if (r.status === "occupied") roomOcc[r.room_type].occupied++;
          else roomOcc[r.room_type].available++;
        });

        return {
          success: true,
          data: {
            stats: {
              total_patients: pts.count || 0,
              total_doctors: docs.count || 0,
              today_appointments: todayAppts.length,
              pending_appointments: pendingAppts.length,
              available_beds: availableBeds.length,
              occupied_beds: occupiedBeds.length,
              today_revenue: todayRevenue,
              pending_payments: pendingRevenue,
              emergency_cases: emg.data?.length || 0
            },
            charts: {
              appointments_by_date: apptByDate,
              appointment_status: statusCounts,
              department_performance: deptCounts,
              room_occupancy: roomOcc
            }
          }
        };
      }

      // Generic table queries fallback for Admin
      const tables = {
        "/admin/patients": "profiles",
        "/admin/doctors": "doctors",
        "/admin/departments": "departments",
        "/admin/appointments": "appointments",
        "/admin/medical-records": "medical_records",
        "/admin/prescriptions": "prescriptions",
        "/admin/lab-reports": "lab_reports",
        "/admin/medicines": "medicines",
        "/admin/rooms": "rooms",
        "/admin/emergency": "emergency_cases",
        "/admin/billing": "billing",
        "/admin/notifications": "notifications",
        "/admin/activity-logs": "activity_logs"
      };

      for (const [route, tbl] of Object.entries(tables)) {
        if (endpoint.startsWith(route)) {
          if (method === "GET") {
            let q = db.from(tbl).select("*");
            if (tbl === "profiles") q = q.eq("role", "patient");
            if (tbl === "doctors") q = db.from(tbl).select("*, departments!doctors_department_id_fkey(name)");
            if (tbl === "departments") q = db.from(tbl).select("*, doctors!doctors_department_id_fkey(id)");
            if (tbl === "appointments") q = db.from(tbl).select("*, doctors(full_name), departments(name), profiles!appointments_patient_id_fkey(full_name, email, phone)");
            if (tbl === "medical_records") q = db.from(tbl).select("*, doctors(full_name), profiles!medical_records_patient_id_fkey(full_name)");
            if (tbl === "prescriptions") q = db.from(tbl).select("*, doctors(full_name), profiles!prescriptions_patient_id_fkey(full_name), prescription_items(*)");
            if (tbl === "lab_reports") q = db.from(tbl).select("*, doctors(full_name), profiles!lab_reports_patient_id_fkey(full_name)");
            if (tbl === "rooms") q = db.from(tbl).select("*, beds(*)");
            if (tbl === "emergency_cases") q = db.from(tbl).select("*, doctors(full_name), rooms(room_number)");
            if (tbl === "billing") q = db.from(tbl).select("*, profiles!billing_patient_id_fkey(full_name)");
            if (tbl === "notifications") q = db.from(tbl).select("*, profiles!notifications_user_id_fkey(full_name)");

            const { data, error } = await q.order("created_at", { ascending: false });
            if (error) throw error;
            return { success: true, data: data || [] };
          }
          if (method === "POST") {
            const { data, error } = await db.from(tbl).insert(body).select().single();
            if (error) throw error;
            return { success: true, data };
          }
          if (method === "PUT") {
            const id = endpoint.split("/").pop();
            const { data, error } = await db.from(tbl).update(body).eq("id", id).select().single();
            if (error) throw error;
            return { success: true, data };
          }
          if (method === "DELETE") {
            const id = endpoint.split("/").pop();
            const { error } = await db.from(tbl).delete().eq("id", id);
            if (error) throw error;
            return { success: true, message: "Deleted successfully" };
          }
        }
      }

      throw new Error(`Unhandled fallback endpoint: ${endpoint}`);
    }
  },

  // -------------------------------------------------------------
  // 6. ROUTER & VIEW CONTROLLER
  // -------------------------------------------------------------
  Router: {
    navigate(viewName) {
      const views = [
        "view-landing",
        "view-patient-login",
        "view-patient-register",
        "view-admin-login",
        "view-forgot-password",
        "view-app-layout"
      ];

      views.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add("hidden");
      });

      const targetEl = document.getElementById(`view-${viewName}`);
      if (targetEl) {
        targetEl.classList.remove("hidden");
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    },

    switchSection(sectionId) {
      App.State.currentSection = sectionId;

      // Hide all app sections
      document.querySelectorAll(".app-section").forEach(sec => {
        sec.classList.remove("active");
      });

      // Show target section
      const targetSec = document.getElementById(`sec-${sectionId}`);
      if (targetSec) {
        targetSec.classList.add("active");
        window.scrollTo({ top: 0, behavior: "smooth" });
      }

      // Update sidebar active classes
      document.querySelectorAll(".sidebar-item").forEach(item => {
        item.classList.remove("active");
        if (item.dataset.target === sectionId) {
          item.classList.add("active");
        }
      });

      // Update Topbar Breadcrumb
      const titles = {
        "patient-dashboard": "Overview",
        "patient-book": "Book Appointment",
        "patient-appointments": "My Appointments",
        "patient-doctors": "Specialists Directory",
        "patient-records": "Medical Records",
        "patient-prescriptions": "Prescriptions",
        "patient-lab-reports": "Lab Reports",
        "patient-billing": "Billing & Invoices",
        "patient-profile": "Profile Settings",
        "patient-notifications": "Notifications Inbox",
        "admin-dashboard": "Executive Analytics",
        "admin-emergency": "Emergency Department",
        "admin-appointments": "Appointments Master",
        "admin-doctors": "Doctors Management",
        "admin-patients": "Patient Directory",
        "admin-departments": "Hospital Departments",
        "admin-medical-records": "Clinical Records",
        "admin-prescriptions": "Prescription Management",
        "admin-lab-reports": "Diagnostic Laboratory",
        "admin-medicines": "Pharmacy Inventory",
        "admin-rooms": "Rooms & Beds",
        "admin-billing": "Revenue & Invoices",
        "admin-notifications": "Notification Broadcasts",
        "admin-activity-logs": "Audit Activity Logs",
        "admin-settings": "Hospital System Settings"
      };

      const breadcrumbTitle = document.getElementById("topbar-breadcrumb-title");
      if (breadcrumbTitle) breadcrumbTitle.textContent = titles[sectionId] || "Dashboard";

      // Trigger section-specific data loads
      App.Router.onSectionLoad(sectionId);

      // Close mobile sidebar if open
      App.UI.closeSidebarMobile();
    },

    onSectionLoad(sectionId) {
      switch (sectionId) {
        case "patient-dashboard": App.PatientDashboard.load(); break;
        case "patient-book": App.PatientAppointments.initWizard(); break;
        case "patient-appointments": App.PatientAppointments.load(); break;
        case "patient-doctors": App.PatientDoctors.load(); break;
        case "patient-records": App.PatientRecords.load(); break;
        case "patient-prescriptions": App.PatientPrescriptions.load(); break;
        case "patient-lab-reports": App.PatientLabReports.load(); break;
        case "patient-billing": App.PatientBilling.load(); break;
        case "patient-profile": App.PatientProfile.load(); break;
        case "patient-notifications": App.Notifications.loadFullList(); break;
        case "admin-dashboard": App.AdminDashboard.load(); break;
        case "admin-emergency": App.AdminEmergency.loadEmergencies(); break;
        case "admin-appointments": App.AdminAppointments.loadAppointments(); break;
        case "admin-admins": App.AdminAdmins.loadAdmins(); break;
        case "admin-doctors": App.AdminDoctors.loadDoctors(); break;
        case "admin-patients": App.AdminPatients.loadPatients(); break;
        case "admin-departments": App.AdminDepartments.loadDepartments(); break;
        case "admin-medical-records": App.AdminMedicalRecords.loadRecords(); break;
        case "admin-prescriptions": App.AdminPrescriptions.loadPrescriptions(); break;
        case "admin-lab-reports": App.AdminLabReports.loadLabReports(); break;
        case "admin-medicines": App.AdminMedicines.loadMedicines(); break;
        case "admin-rooms": App.AdminRooms.loadRooms(); break;
        case "admin-billing": App.AdminBilling.loadBilling(); break;
        case "admin-notifications": App.AdminNotifications.loadNotifications(); break;
        case "admin-activity-logs": App.AdminLogs.loadLogs(); break;
        case "admin-settings": App.AdminSettings.loadSettings(); break;
      }
    },

    goToProfile() {
      if (App.State.role === "patient") {
        App.Router.switchSection("patient-profile");
      } else {
        App.Router.switchSection("admin-settings");
      }
      App.UI.closeDropdowns();
    }
  },

  // -------------------------------------------------------------
  // 7. AUTHENTICATION CONTROLLER
  // -------------------------------------------------------------
  Auth: {
    _authListenerRegistered: false,

    async checkSession() {
      const db = App.Config.client;
      if (!db) return;

      // Handle OAuth error hash parameters if present (e.g. user cancelled Google OAuth consent)
      if (typeof window !== "undefined" && window.location && window.location.hash && window.location.hash.includes("error=")) {
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        const errorDesc = hashParams.get("error_description") || hashParams.get("error");
        if (errorDesc) {
          App.UI.toast(`Google Login notice: ${decodeURIComponent(errorDesc.replace(/\+/g, " "))}`, "warning");
        }
        if (window.history && window.history.replaceState) {
          window.history.replaceState(null, document.title, window.location.pathname + window.location.search);
        }
      }

      // Check current session
      const { data: { session } } = await db.auth.getSession();
      if (session?.user) {
        await App.Auth.setUserSession(session.user);
      } else {
        App.Router.navigate("landing");
      }

      // Listen for auth state changes (handles redirect from OAuth)
      if (!App.Auth._authListenerRegistered && db.auth?.onAuthStateChange) {
        App.Auth._authListenerRegistered = true;
        db.auth.onAuthStateChange(async (event, session) => {
          if (event === "SIGNED_IN" && session?.user) {
            if (!App.State.user || App.State.user.id !== session.user.id) {
              await App.Auth.setUserSession(session.user);
            }
          } else if (event === "SIGNED_OUT") {
            App.State.user = null;
            App.State.profile = null;
            App.State.role = null;
            App.Router.navigate("landing");
          }
        });
      }
    },

    async setUserSession(user) {
      App.State.user = user;
      const db = App.Config.client;

      // Fetch user profile
      let { data: profile, error } = await db.from("profiles").select("*").eq("id", user.id).maybeSingle();

      // If user has no profile yet (e.g. newly signed up via Google OAuth)
      if (!profile) {
        const metadata = user.user_metadata || {};
        const fullName = metadata.full_name || metadata.name || (user.email ? user.email.split("@")[0] : "Patient User");
        const avatarUrl = metadata.avatar_url || metadata.picture || null;

        const newProfile = {
          id: user.id,
          full_name: fullName,
          email: user.email,
          role: "patient", // STRICT: Google OAuth users are always given patient role, never admin
          status: "active",
          avatar_url: avatarUrl
        };

        const { error: insertErr } = await db.from("profiles").insert(newProfile);
        if (insertErr) {
          console.warn("Notice: profile insert note:", insertErr);
        }
        profile = newProfile;
      }

      // Account status check
      if (profile?.status === "disabled") {
        await db.auth.signOut();
        App.UI.toast("Your account has been disabled. Please contact hospital administration.", "error");
        App.Router.navigate("landing");
        return;
      }

      App.State.profile = profile || {};
      App.State.role = profile?.role || "patient";

      // Update UI elements with user data
      const name = profile?.full_name || (user.email ? user.email.split("@")[0] : "User");
      const role = profile?.role || "patient";
      const initial = name.charAt(0).toUpperCase();

      const topName = document.getElementById("topbar-user-name");
      const topAvatar = document.getElementById("topbar-user-avatar");
      const sideName = document.getElementById("sidebar-user-name");
      const sideRole = document.getElementById("sidebar-user-role");
      const sideAvatar = document.getElementById("sidebar-user-avatar");
      const breadcrumbRole = document.getElementById("topbar-breadcrumb-role");

      if (topName) topName.textContent = name;
      if (topAvatar) topAvatar.textContent = initial;
      if (sideName) sideName.textContent = name;
      if (sideRole) sideRole.textContent = role.toUpperCase();
      if (sideAvatar) sideAvatar.textContent = initial;
      if (breadcrumbRole) breadcrumbRole.textContent = role === "admin" ? "Hospital Admin" : "Patient Portal";

      // Toggle Sidebar Sections based on Role
      const patientMenu = document.getElementById("sidebar-patient-menu");
      const adminMenu = document.getElementById("sidebar-admin-menu");

      if (role === "admin") {
        if (patientMenu) patientMenu.classList.add("hidden");
        if (adminMenu) adminMenu.classList.remove("hidden");
        App.Router.navigate("app-layout");
        App.Router.switchSection("admin-dashboard");
      } else {
        if (patientMenu) patientMenu.classList.remove("hidden");
        if (adminMenu) adminMenu.classList.add("hidden");
        App.Router.navigate("app-layout");
        App.Router.switchSection("patient-dashboard");
      }

      // Load initial notifications
      App.Notifications.loadUnread();
    },

    async handleGoogleLogin() {
      try {
        const db = App.Config.client;
        if (!db) throw new Error("Supabase client is not initialized.");

        App.UI.toast("Redirecting to Google Sign-In...", "info");

        // Redirect URL: return to the current web application url
        const redirectUrl = window.location.origin + window.location.pathname;

        const { data, error } = await db.auth.signInWithOAuth({
          provider: "google",
          options: {
            redirectTo: redirectUrl,
            queryParams: {
              access_type: "offline",
              prompt: "consent"
            }
          }
        });

        if (error) throw error;
      } catch (err) {
        console.error("Google OAuth login error:", err);
        App.UI.toast(err.message || "Failed to start Google sign in. Please try again.", "error");
      }
    },

    async handlePatientLogin(e) {
      e.preventDefault();
      const email = document.getElementById("login-patient-email").value.trim();
      const password = document.getElementById("login-patient-pass").value;
      const submitBtn = document.getElementById("btn-patient-login-submit");

      try {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<div class="spinner spinner-sm"></div> Signing in...`;

        const { data, error } = await App.Config.client.auth.signInWithPassword({ email, password });
        if (error) throw error;

        // Safety check: Patient login should always open patient portal
        // Fetch profile and verify role and status
        const { data: profile } = await App.Config.client.from("profiles").select("role, status").eq("id", data.user.id).single();
        if (profile?.status === "disabled") {
          await App.Config.client.auth.signOut();
          App.UI.toast("Your patient account has been disabled. Please contact hospital administration.", "error");
          return;
        }

        if (profile && profile.role === "admin") {
          // If admin tries patient login, sign them out and redirect to admin login
          await App.Config.client.auth.signOut();
          App.UI.toast("This is an Admin account. Please use the Admin Login portal.", "warning");
          App.Router.navigate("admin-login");
          return;
        }

        App.UI.toast("Welcome back! Signed in successfully.", "success");
        await App.Auth.setUserSession(data.user);
      } catch (err) {
        App.UI.toast(err.message || "Invalid email or password", "error");
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `<i class="fa-solid fa-right-to-bracket"></i> Sign In to Dashboard`;
      }
    },

    async handlePatientRegister(e) {
      e.preventDefault();
      const fullName = document.getElementById("reg-name").value.trim();
      const email = document.getElementById("reg-email").value.trim();
      const phone = document.getElementById("reg-phone").value.trim();
      const dob = document.getElementById("reg-dob").value;
      const gender = document.getElementById("reg-gender").value;
      const bloodGroup = document.getElementById("reg-blood").value;
      const address = document.getElementById("reg-address").value.trim();
      const password = document.getElementById("reg-pass").value;
      const confirmPass = document.getElementById("reg-pass-confirm").value;
      const submitBtn = document.getElementById("btn-patient-reg-submit");

      if (password !== confirmPass) {
        App.UI.toast("Passwords do not match.", "error");
        return;
      }

      try {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<div class="spinner spinner-sm"></div> Creating Account...`;

        const { data, error } = await App.Config.client.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: fullName,
              role: "patient"
            }
          }
        });

        if (error) throw error;

        // Update profile table with extra fields
        if (data.user) {
          await App.Config.client.from("profiles").update({
            phone,
            date_of_birth: dob || null,
            gender: gender || null,
            blood_group: bloodGroup || null,
            address: address || null,
            status: "active"
          }).eq("id", data.user.id);
        }

        App.UI.toast("Registration complete! Welcome to MediCare.", "success");
        await App.Auth.setUserSession(data.user);
      } catch (err) {
        App.UI.toast(err.message || "Registration failed. Please try again.", "error");
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `<i class="fa-solid fa-user-check"></i> Complete Registration`;
      }
    },

    async handleAdminLogin(e) {
      e.preventDefault();
      const email = document.getElementById("login-admin-email").value.trim();
      const password = document.getElementById("login-admin-pass").value;
      const submitBtn = document.getElementById("btn-admin-login-submit");

      try {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<div class="spinner spinner-sm"></div> Authenticating Admin...`;

        // 1. Authenticate with Supabase Auth
        const { data, error } = await App.Config.client.auth.signInWithPassword({ email, password });
        if (error) throw error;

        const authUser = data?.user;
        if (!authUser) throw new Error("Authentication failed: No user returned");

        // 2. Check if user is actually admin and not disabled
        const { data: profile, error: profError } = await App.Config.client
          .from("profiles")
          .select("role, status, full_name")
          .eq("id", authUser.id)
          .single();

        if (profError) console.warn("Profile fetch note:", profError);

        if (profile?.status === "disabled") {
          await App.Config.client.auth.signOut();
          throw new Error("Your administrator account has been disabled. Please contact the main administrator.");
        }

        if (profile && profile.role !== "admin") {
          await App.Config.client.auth.signOut();
          throw new Error("Access denied. Administrator authorization required.");
        }

        App.UI.toast("Admin authenticated. Welcome to Executive Control.", "success");
        await App.Auth.setUserSession(authUser);
      } catch (err) {
        console.error("Admin login error:", err);
        App.UI.toast(err.message || "Invalid Admin Email or Password", "error");
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `<i class="fa-solid fa-lock-open"></i> Login as Administrator`;
      }
    },

    async handleForgotPassword(e) {
      e.preventDefault();
      const email = document.getElementById("forgot-email").value.trim();
      try {
        const { error } = await App.Config.client.auth.resetPasswordForEmail(email);
        if (error) throw error;
        App.UI.toast("Password reset instructions sent to your email.", "info");
        App.Router.navigate("patient-login");
      } catch (err) {
        App.UI.toast(err.message || "Failed to send reset link", "error");
      }
    },

    async logout() {
      App.UI.confirm("Are you sure you want to sign out from MediCare?", async () => {
        await App.Config.client.auth.signOut();
        App.State.user = null;
        App.State.profile = null;
        App.State.role = null;
        App.UI.toast("You have been signed out.", "info");
        App.Router.navigate("landing");
      });
    }
  },

  // -------------------------------------------------------------
  // 8. PUBLIC LANDING PAGE
  // -------------------------------------------------------------
  Landing: {
    async loadData() {
      try {
        // Load active doctors
        const { data: doctors } = await App.Config.client.from("doctors").select("*, departments!doctors_department_id_fkey(name)").eq("status", "active").limit(6);
        const docGrid = document.getElementById("landing-doctors-grid");
        if (docGrid && doctors) {
          docGrid.innerHTML = doctors.map(doc => `
            <div class="doctor-card">
              <div class="doctor-card-img">
                ${doc.avatar_url ? `<img src="${doc.avatar_url}" alt="${doc.full_name}">` : `<i class="fa-solid fa-user-doctor"></i>`}
              </div>
              <div class="doctor-card-body">
                <h3>${doc.full_name}</h3>
                <div class="specialization">${doc.specialization} • ${doc.departments?.name || "General"}</div>
                <div class="info"><i class="fa-solid fa-graduation-cap"></i> ${doc.qualification || "Specialist"}</div>
                <div class="info mt-1"><i class="fa-solid fa-clock"></i> ${doc.experience || 5}+ Years Exp.</div>
                <div class="flex justify-between items-center mt-3">
                  <span class="font-bold text-primary">₹${parseFloat(doc.consultation_fee || 0).toFixed(0)}</span>
                  <button class="btn btn-outline-primary btn-sm" onclick="App.Router.navigate('patient-register')">
                    Book Visit
                  </button>
                </div>
              </div>
            </div>
          `).join("");
        }
      } catch (err) {
        console.error("Error loading landing doctors:", err);
      }
    },

    async handleInquiry(e) {
      e.preventDefault();
      const submitBtn = document.getElementById("btn-inquiry-submit");
      const originalText = submitBtn ? submitBtn.innerHTML : '<i class="fa-solid fa-paper-plane"></i> Send Direct Inquiry';

      // Prevent duplicate clicks
      if (submitBtn && submitBtn.disabled) return;

      const name = document.getElementById("inquiry-name")?.value.trim();
      const email = document.getElementById("inquiry-email")?.value.trim();
      const phone = document.getElementById("inquiry-phone")?.value.trim() || "Not provided";
      const dept = document.getElementById("inquiry-dept")?.value || "General Inquiries";
      const message = document.getElementById("inquiry-message")?.value.trim();

      if (!name || !email || !message) {
        App.UI.toast("Please fill in all required fields (Name, Email, Message).", "warning");
        return;
      }

      try {
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.innerHTML = `<div class="spinner spinner-sm"></div> Sending inquiry to Gmail...`;
        }

        // Determine API URL: prefer relative if running on same origin, else configured apiBaseUrl
        const isSameServer = typeof window !== "undefined" && window.location && (window.location.port === "8000" || window.location.host === "localhost:8000");
        const inquiryUrl = isSameServer ? "/api/contact/inquiry" : `${App.Config.apiBaseUrl}/contact/inquiry`;

        // Flow: Form -> FastAPI -> Gmail SMTP -> Gmail inbox
        let response;
        try {
          response = await fetch(inquiryUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Accept": "application/json"
            },
            body: JSON.stringify({
              full_name: name,
              email: email,
              phone: phone,
              department: dept,
              message: message
            })
          });
        } catch (fetchErr) {
          // If relative failed, try full absolute URL
          if (isSameServer) {
            response = await fetch(`http://localhost:8000/api/contact/inquiry`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Accept": "application/json"
              },
              body: JSON.stringify({
                full_name: name,
                email: email,
                phone: phone,
                department: dept,
                message: message
              })
            });
          } else {
            throw new Error("Unable to connect to backend server at http://localhost:8000. Please ensure 'uvicorn python:app --reload --port 8000' is running.");
          }
        }

        const resData = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(resData.detail || `Server returned error status (${response.status})`);
        }

        App.UI.toast("Inquiry sent successfully! Delivered to your Gmail inbox.", "success");
        document.getElementById("landing-inquiry-form")?.reset();
      } catch (err) {
        console.error("Inquiry transmission error:", err);
        App.UI.toast(`Error sending inquiry: ${err.message}`, "error");
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = originalText;
        }
      }
    }
  },

  // -------------------------------------------------------------
  // 9. PATIENT DASHBOARD & MODULES
  // -------------------------------------------------------------
  PatientDashboard: {
    async load() {
      try {
        const welcomeHeading = document.getElementById("patient-welcome-heading");
        if (welcomeHeading && App.State.profile?.full_name) {
          welcomeHeading.textContent = `Welcome Back, ${App.State.profile.full_name.split(" ")[0]}!`;
        }

        const res = await App.api("/patient/dashboard");
        if (!res.success) return;
        const { stats, upcoming_appointments, recent_records } = res.data;

        // Update Stat Cards
        document.getElementById("p-stat-upcoming").textContent = stats.upcoming_appointments;
        document.getElementById("p-stat-total-appts").textContent = stats.total_appointments;
        document.getElementById("p-stat-prescriptions").textContent = stats.prescriptions;
        document.getElementById("p-stat-reports").textContent = stats.medical_reports;
        document.getElementById("p-stat-bills").textContent = stats.pending_bills;

        // Upcoming Appointment Card
        const nextApptCard = document.getElementById("patient-next-appt-card");
        if (nextApptCard) {
          if (upcoming_appointments && upcoming_appointments.length > 0) {
            const next = upcoming_appointments[0];
            nextApptCard.innerHTML = `
              <div style="background:var(--primary-50); border:1px solid var(--primary-100); border-radius:var(--radius-lg); padding:1.25rem;">
                <div class="flex justify-between items-center mb-2">
                  <span class="badge badge-primary"><i class="fa-solid fa-clock"></i> ${next.status.toUpperCase()}</span>
                  <span class="text-sm font-semibold text-primary">${App.Utils.formatDate(next.appointment_date)} at ${next.appointment_time}</span>
                </div>
                <h3 style="font-size:1.15rem; margin-bottom:0.25rem;">${next.doctors?.full_name || "Doctor"}</h3>
                <p class="text-muted text-sm mb-3">${next.doctors?.specialization || "Specialist"} • ${next.departments?.name || "Clinic"}</p>
                <p class="text-sm"><strong>Reason:</strong> ${next.reason || "General Consultation"}</p>
                <div class="flex gap-2 mt-4">
                  <button class="btn btn-danger btn-sm" onclick="App.PatientAppointments.cancelAppointment('${next.id}')">
                    <i class="fa-solid fa-ban"></i> Cancel
                  </button>
                </div>
              </div>
            `;
          } else {
            nextApptCard.innerHTML = `
              <div class="empty-state" style="padding:2rem 1rem;">
                <div class="icon"><i class="fa-solid fa-calendar-xmark"></i></div>
                <h3>No Upcoming Visits</h3>
                <p>You have no pending consultations scheduled at MediCare.</p>
                <button class="btn btn-primary btn-sm mt-2" onclick="App.Router.switchSection('patient-book')">
                  Book an Appointment
                </button>
              </div>
            `;
          }
        }

        // Recent Medical Records
        const recentRecsList = document.getElementById("patient-recent-records-list");
        if (recentRecsList) {
          if (recent_records && recent_records.length > 0) {
            recentRecsList.innerHTML = recent_records.map(r => `
              <div style="padding:0.75rem 0; border-bottom:1px solid var(--border-light);">
                <div class="flex justify-between items-center mb-1">
                  <span class="font-semibold text-sm">${r.diagnosis}</span>
                  <span class="text-xs text-muted">${App.Utils.formatDate(r.record_date)}</span>
                </div>
                <p class="text-xs text-muted">Dr. ${r.doctors?.full_name || "Specialist"}</p>
                <p class="text-xs mt-1 truncate">${r.treatment || r.symptoms || "No treatment notes."}</p>
              </div>
            `).join("");
          } else {
            recentRecsList.innerHTML = `<div class="p-3 text-center text-muted text-sm">No recent medical records logged.</div>`;
          }
        }
      } catch (err) {
        console.error("Error loading patient dashboard:", err);
      }
    }
  },

  // -------------------------------------------------------------
  // 10. APPOINTMENT MANAGEMENT (PATIENT)
  // -------------------------------------------------------------
  PatientAppointments: {
    currentAppointments: [],
    selectedDoctor: null,

    async load() {
      try {
        const res = await App.api("/patient/appointments");
        if (!res.success) return;
        App.PatientAppointments.currentAppointments = res.data;
        App.PatientAppointments.renderTable(res.data);
      } catch (err) {
        console.error("Error loading appointments:", err);
      }
    },

    filterTab(status, btn) {
      document.querySelectorAll("#sec-patient-appointments .tab-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      if (status === "all") {
        App.PatientAppointments.renderTable(App.PatientAppointments.currentAppointments);
      } else {
        const filtered = App.PatientAppointments.currentAppointments.filter(a => a.status === status);
        App.PatientAppointments.renderTable(filtered);
      }
    },

    renderTable(list) {
      const tbody = document.getElementById("patient-appointments-table-body");
      if (!tbody) return;

      if (!list || list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center p-4 text-muted">No appointments found in this category.</td></tr>`;
        return;
      }

      tbody.innerHTML = list.map(a => `
        <tr>
          <td>
            <div class="cell-user">
              <div class="cell-avatar"><i class="fa-solid fa-user-doctor"></i></div>
              <div>
                <div class="cell-name">${a.doctors?.full_name || "Specialist"}</div>
                <div class="cell-email">${a.doctors?.specialization || "Physician"}</div>
              </div>
            </div>
          </td>
          <td>${a.departments?.name || "General"}</td>
          <td>
            <div class="font-medium">${App.Utils.formatDate(a.appointment_date)}</div>
            <div class="text-xs text-muted">${a.appointment_time}</div>
          </td>
          <td class="text-sm">${a.reason || "General Consultation"}</td>
          <td>${App.Utils.getStatusBadge(a.status)}</td>
          <td>
            <div class="cell-actions">
              ${["pending", "confirmed"].includes(a.status) ? `
                <button title="Cancel Appointment" class="danger" onclick="App.PatientAppointments.cancelAppointment('${a.id}')">
                  <i class="fa-solid fa-xmark"></i>
                </button>
              ` : `
                <span class="text-xs text-muted">No action</span>
              `}
            </div>
          </td>
        </tr>
      `).join("");
    },

    // Appointment Booking Wizard
    async initWizard() {
      // Load departments into select
      const res = await App.api("/departments");
      const deptSelect = document.getElementById("book-dept-select");
      if (deptSelect && res.data) {
        deptSelect.innerHTML = `<option value="">-- Choose Department --</option>` +
          res.data.map(d => `<option value="${d.id}">${d.name}</option>`).join("");
      }
      App.PatientAppointments.goToStep(1);

      // Set min date to today
      const dateInput = document.getElementById("book-date-input");
      if (dateInput) {
        dateInput.min = new Date().toISOString().split("T")[0];
        dateInput.value = new Date().toISOString().split("T")[0];
      }
    },

    goToStep(step) {
      // Validate prior steps
      if (step === 2) {
        if (!document.getElementById("book-dept-select").value) {
          App.UI.toast("Please select a medical department first.", "warning");
          return;
        }
        App.PatientAppointments.handleDeptChange();
      }
      if (step === 3 && !document.getElementById("book-doctor-select").value) {
        App.UI.toast("Please select a specialist doctor.", "warning");
        return;
      }
      if (step === 4) {
        const slot = document.getElementById("book-selected-time").value;
        const date = document.getElementById("book-date-input").value;
        if (!date || !slot) {
          App.UI.toast("Please pick a consultation date and available time slot.", "warning");
          return;
        }
        App.PatientAppointments.renderBookingSummary();
      }

      // Hide all panes
      for (let i = 1; i <= 4; i++) {
        const pane = document.getElementById(`wizard-pane-${i}`);
        const stepTab = document.getElementById(`wiz-step-1`.replace("1", i));
        if (pane) pane.classList.add("hidden");
        if (stepTab) {
          stepTab.classList.remove("active");
          if (i < step) stepTab.classList.add("completed");
          else stepTab.classList.remove("completed");
        }
      }

      // Show current pane
      const currentPane = document.getElementById(`wizard-pane-${step}`);
      const currentStepTab = document.getElementById(`wiz-step-1`.replace("1", step));
      if (currentPane) currentPane.classList.remove("hidden");
      if (currentStepTab) currentStepTab.classList.add("active");
    },

    async handleDeptChange() {
      const deptId = document.getElementById("book-dept-select").value;
      const docSelect = document.getElementById("book-doctor-select");
      if (!docSelect) return;

      try {
        let q = App.Config.client
          .from("doctors")
          .select("*, departments!doctors_department_id_fkey(name)")
          .eq("status", "active")
          .order("full_name");

        if (deptId) {
          q = q.eq("department_id", deptId);
        }

        const { data: doctors, error } = await q;
        if (error) throw error;

        if (doctors && doctors.length > 0) {
          docSelect.innerHTML = `<option value="">-- Select Specialist --</option>` +
            doctors.map(doc => `<option value="${doc.id}">${doc.full_name} (${doc.specialization}) - ₹${parseFloat(doc.consultation_fee || 0).toFixed(0)}</option>`).join("");
        } else {
          docSelect.innerHTML = `<option value="">No active doctors in this department</option>`;
        }
      } catch (err) {
        console.error("Error fetching doctors for department:", err);
      }
    },

    async handleDoctorChange() {
      const docId = document.getElementById("book-doctor-select").value;
      const previewBox = document.getElementById("book-doctor-preview-card");
      if (!docId) {
        if (previewBox) previewBox.classList.add("hidden");
        return;
      }

      const { data: doc } = await App.Config.client.from("doctors").select("*, departments!doctors_department_id_fkey(name)").eq("id", docId).single();
      if (doc && previewBox) {
        App.PatientAppointments.selectedDoctor = doc;
        previewBox.classList.remove("hidden");
        previewBox.innerHTML = `
          <div class="flex items-center gap-3">
            <div class="cell-avatar" style="width:48px; height:48px; font-size:1.2rem;">
              ${doc.avatar_url ? `<img src="${doc.avatar_url}" alt="${doc.full_name}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">` : `<i class="fa-solid fa-user-doctor"></i>`}
            </div>
            <div>
              <h4 style="margin-bottom:0.15rem;">${doc.full_name}</h4>
              <p class="text-xs text-primary font-medium">${doc.specialization} • ${doc.qualification || "Physician"}</p>
              <p class="text-xs text-muted mt-1">Available: ${(doc.available_days || []).join(", ")} (${doc.available_time_start || "09:00"} - ${doc.available_time_end || "17:00"})</p>
              <p class="text-sm font-bold mt-1">Consultation Fee: ₹${parseFloat(doc.consultation_fee || 0).toFixed(0)}</p>
            </div>
          </div>
        `;
      }
      App.PatientAppointments.loadDoctorSlots();
    },

    async loadDoctorSlots() {
      const docId = document.getElementById("book-doctor-select").value;
      const dateStr = document.getElementById("book-date-input").value;
      const slotsContainer = document.getElementById("book-slots-grid");
      if (!docId || !dateStr || !slotsContainer) return;

      slotsContainer.innerHTML = `<div class="p-3 text-muted"><div class="spinner spinner-sm"></div> Checking doctor schedule...</div>`;

      try {
        const doc = App.PatientAppointments.selectedDoctor || (await App.Config.client.from("doctors").select("*").eq("id", docId).single()).data;
        const targetDate = new Date(dateStr + "T00:00:00");
        const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        const dayName = days[targetDate.getDay()];

        if (!(doc.available_days || []).includes(dayName)) {
          slotsContainer.innerHTML = `<p class="text-danger text-sm"><i class="fa-solid fa-circle-exclamation"></i> ${doc.full_name} is not available on ${dayName}s. Please pick another date.</p>`;
          return;
        }

        // Generate 30-minute interval slots between start and end
        const startHour = parseInt((doc.available_time_start || "09:00").split(":")[0]);
        const endHour = parseInt((doc.available_time_end || "17:00").split(":")[0]);
        const allSlots = [];

        for (let h = startHour; h < endHour; h++) {
          allSlots.push(`${String(h).padStart(2, '0')}:00`);
          allSlots.push(`${String(h).padStart(2, '0')}:30`);
        }

        // Fetch already booked slots for this doctor on this date
        const { data: booked } = await App.Config.client.from("appointments")
          .select("appointment_time")
          .eq("doctor_id", docId)
          .eq("appointment_date", dateStr)
          .in("status", ["pending", "confirmed"]);

        const bookedTimes = new Set((booked || []).map(b => b.appointment_time.slice(0, 5)));

        slotsContainer.innerHTML = allSlots.map(time => {
          const isBooked = bookedTimes.has(time);
          return `
            <button type="button" class="time-slot ${isBooked ? 'booked' : ''}" 
              ${isBooked ? 'disabled title="Slot already booked"' : `onclick="App.PatientAppointments.selectSlot('${time}', this)"`}>
              ${time}
            </button>
          `;
        }).join("");
      } catch (err) {
        slotsContainer.innerHTML = `<p class="text-danger text-sm">Failed to load slots.</p>`;
      }
    },

    selectSlot(time, btn) {
      document.querySelectorAll(".time-slot").forEach(s => s.classList.remove("selected"));
      btn.classList.add("selected");
      document.getElementById("book-selected-time").value = time;
    },

    renderBookingSummary() {
      const summaryBox = document.getElementById("book-summary-box");
      const deptSelect = document.getElementById("book-dept-select");
      const deptName = deptSelect.options[deptSelect.selectedIndex]?.text || "Department";
      const doc = App.PatientAppointments.selectedDoctor;
      const date = document.getElementById("book-date-input").value;
      const time = document.getElementById("book-selected-time").value;

      if (summaryBox) {
        summaryBox.innerHTML = `
          <div class="grid-2">
            <div>
              <div class="text-xs text-muted uppercase font-bold">Specialist Doctor</div>
              <div class="font-semibold">${doc?.full_name || "Doctor"}</div>
              <div class="text-xs text-primary">${doc?.specialization}</div>
            </div>
            <div>
              <div class="text-xs text-muted uppercase font-bold">Department</div>
              <div class="font-semibold">${deptName}</div>
            </div>
            <div class="mt-2">
              <div class="text-xs text-muted uppercase font-bold">Date & Time</div>
              <div class="font-semibold text-primary">${App.Utils.formatDate(date)} at ${time}</div>
            </div>
            <div class="mt-2">
              <div class="text-xs text-muted uppercase font-bold">Consultation Fee</div>
              <div class="font-semibold text-success">₹${parseFloat(doc?.consultation_fee || 0).toFixed(0)}</div>
            </div>
          </div>
        `;
      }
    },

    async submitBooking(e) {
      e.preventDefault();
      const doctorId = document.getElementById("book-doctor-select").value;
      const deptId = document.getElementById("book-dept-select").value;
      const apptDate = document.getElementById("book-date-input").value;
      const apptTime = document.getElementById("book-selected-time").value;
      const reason = document.getElementById("book-reason-input").value.trim();
      const submitBtn = document.getElementById("btn-confirm-booking-submit");

      try {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<div class="spinner spinner-sm"></div> Confirming Appointment...`;

        const res = await App.api("/patient/appointments", "POST", {
          doctor_id: doctorId,
          department_id: deptId,
          appointment_date: apptDate,
          appointment_time: apptTime,
          reason
        });

        if (!res.success) throw new Error(res.message || "Booking failed");

        App.UI.toast("Appointment successfully booked! Status: Pending Confirmation.", "success");
        App.Router.switchSection("patient-appointments");
      } catch (err) {
        App.UI.toast(err.message || "Failed to book appointment", "error");
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `<i class="fa-solid fa-check"></i> Confirm & Book Appointment`;
      }
    },

    async cancelAppointment(id) {
      App.UI.confirm("Are you sure you want to cancel this appointment?", async () => {
        try {
          await App.Config.client.from("appointments").update({ status: "cancelled" }).eq("id", id);
          App.UI.toast("Appointment cancelled.", "info");
          App.PatientAppointments.load();
        } catch (err) {
          App.UI.toast("Failed to cancel appointment.", "error");
        }
      });
    }
  },

  // -------------------------------------------------------------
  // 11. DOCTORS DIRECTORY (PATIENT)
  // -------------------------------------------------------------
  PatientDoctors: {
    doctorsList: [],

    async load() {
      try {
        const [docRes, deptRes] = await Promise.all([
          App.api("/doctors"),
          App.api("/departments")
        ]);

        App.PatientDoctors.doctorsList = docRes.data || [];
        App.PatientDoctors.render(App.PatientDoctors.doctorsList);

        const filterSelect = document.getElementById("patient-doc-dept-filter");
        if (filterSelect && deptRes.data) {
          filterSelect.innerHTML = `<option value="">All Departments</option>` +
            deptRes.data.map(d => `<option value="${d.id}">${d.name}</option>`).join("");
        }
      } catch (err) {
        console.error("Error loading doctors:", err);
      }
    },

    handleSearch() {
      const q = (document.getElementById("patient-doc-search").value || "").toLowerCase();
      const dept = document.getElementById("patient-doc-dept-filter").value;

      const filtered = App.PatientDoctors.doctorsList.filter(d => {
        const matchQuery = d.full_name.toLowerCase().includes(q) || d.specialization.toLowerCase().includes(q);
        const matchDept = !dept || d.department_id === dept;
        return matchQuery && matchDept;
      });

      App.PatientDoctors.render(filtered);
    },

    render(list) {
      const grid = document.getElementById("patient-doctors-grid");
      if (!grid) return;

      if (!list || list.length === 0) {
        grid.innerHTML = `<div class="p-4 text-center text-muted" style="grid-column:1/-1;">No doctors found matching your criteria.</div>`;
        return;
      }

      grid.innerHTML = list.map(doc => `
        <div class="doctor-card">
          <div class="doctor-card-img">
            ${doc.avatar_url ? `<img src="${doc.avatar_url}" alt="${doc.full_name}">` : `<i class="fa-solid fa-user-doctor"></i>`}
          </div>
          <div class="doctor-card-body">
            <h3>${doc.full_name}</h3>
            <div class="specialization">${doc.specialization} • ${doc.departments?.name || "General"}</div>
            <div class="info"><i class="fa-solid fa-graduation-cap"></i> ${doc.qualification || "Physician"}</div>
            <div class="info mt-1"><i class="fa-solid fa-calendar-days"></i> Available: ${(doc.available_days || []).slice(0, 3).join(", ")}...</div>
            <div class="flex justify-between items-center mt-3">
              <span class="font-bold text-primary">₹${parseFloat(doc.consultation_fee || 0).toFixed(0)}</span>
              <button class="btn btn-primary btn-sm" onclick="App.PatientDoctors.openDetails('${doc.id}')">
                View & Book
              </button>
            </div>
          </div>
        </div>
      `).join("");
    },

    async openDetails(id) {
      const doc = App.PatientDoctors.doctorsList.find(d => d.id === id);
      if (!doc) return;

      const modalBody = document.getElementById("doctor-details-body");
      if (modalBody) {
        modalBody.innerHTML = `
          <div class="doctor-profile-view">
            <div class="profile-photo">
              ${doc.avatar_url ? `<img src="${doc.avatar_url}" alt="${doc.full_name}">` : `<i class="fa-solid fa-user-doctor"></i>`}
            </div>
            <div class="profile-details">
              <h2>${doc.full_name}</h2>
              <div class="specialization-text">${doc.specialization} • ${doc.departments?.name || "General Department"}</div>
              <div class="detail-row"><span class="label">Qualification:</span> <span>${doc.qualification || "MBBS, MD"}</span></div>
              <div class="detail-row"><span class="label">Experience:</span> <span>${doc.experience || 0} Years in Practice</span></div>
              <div class="detail-row"><span class="label">Consultation Fee:</span> <span class="text-success font-bold">₹${parseFloat(doc.consultation_fee || 0).toFixed(0)}</span></div>
              <div class="detail-row"><span class="label">Working Days:</span> <span>${(doc.available_days || []).join(", ")}</span></div>
              <div class="detail-row"><span class="label">Clinic Hours:</span> <span>${doc.available_time_start || "09:00"} - ${doc.available_time_end || "17:00"}</span></div>
            </div>
          </div>
        `;
      }

      const bookBtn = document.getElementById("book-with-doc-btn");
      if (bookBtn) {
        bookBtn.onclick = () => {
          App.UI.closeModal("doctor-details-modal");
          App.Router.switchSection("patient-book");
        };
      }

      App.UI.openModal("doctor-details-modal");
    }
  },

  // -------------------------------------------------------------
  // 12. MEDICAL RECORDS (PATIENT)
  // -------------------------------------------------------------
  PatientRecords: {
    async load() {
      try {
        const res = await App.api("/patient/medical-records");
        const tbody = document.getElementById("patient-records-table-body");
        if (!tbody || !res.data) return;

        if (res.data.length === 0) {
          tbody.innerHTML = `<tr><td colspan="6" class="text-center p-4 text-muted">No medical records registered.</td></tr>`;
          return;
        }

        tbody.innerHTML = res.data.map(r => `
          <tr>
            <td class="font-medium">${App.Utils.formatDate(r.record_date)}</td>
            <td>Dr. ${r.doctors?.full_name || "Specialist"}</td>
            <td><span class="badge badge-primary">${r.diagnosis}</span></td>
            <td class="text-sm">${r.symptoms || "—"}</td>
            <td class="text-sm">${r.treatment || "—"}</td>
            <td class="text-sm text-muted">${r.followup_date ? App.Utils.formatDate(r.followup_date) : "None"}</td>
          </tr>
        `).join("");
      } catch (err) {
        console.error("Error loading medical records:", err);
      }
    }
  },

  // -------------------------------------------------------------
  // 13. PRESCRIPTIONS (PATIENT)
  // -------------------------------------------------------------
  PatientPrescriptions: {
    prescriptions: [],

    async load() {
      try {
        const res = await App.api("/patient/prescriptions");
        const tbody = document.getElementById("patient-prescriptions-table-body");
        if (!tbody || !res.data) return;

        App.PatientPrescriptions.prescriptions = res.data;

        if (res.data.length === 0) {
          tbody.innerHTML = `<tr><td colspan="5" class="text-center p-4 text-muted">No prescriptions found.</td></tr>`;
          return;
        }

        tbody.innerHTML = res.data.map(p => {
          const medNames = (p.prescription_items || []).map(i => `${i.medicine_name} (${i.dosage || ''})`).join(", ");
          return `
            <tr>
              <td class="font-medium">${App.Utils.formatDate(p.prescription_date)}</td>
              <td>Dr. ${p.doctors?.full_name || "Doctor"}</td>
              <td class="text-sm font-semibold">${medNames || "Standard Prescription"}</td>
              <td class="text-sm text-muted">${p.notes || "Follow instructions as prescribed."}</td>
              <td>
                <button class="btn btn-secondary btn-sm" onclick="App.PatientPrescriptions.viewPrescription('${p.id}')">
                  <i class="fa-solid fa-print"></i> View / Print
                </button>
              </td>
            </tr>
          `;
        }).join("");
      } catch (err) {
        console.error("Error loading prescriptions:", err);
      }
    },

    viewPrescription(id) {
      const p = App.PatientPrescriptions.prescriptions.find(x => x.id === id);
      if (!p) return;

      const modalBody = document.getElementById("prescription-modal-body");
      if (modalBody) {
        modalBody.innerHTML = `
          <div class="invoice-view">
            <div class="invoice-header">
              <div class="hospital-info">
                <h2>MediCare General Hospital</h2>
                <p>123 Healthcare Ave, Medical District, NY</p>
                <p>Phone: +1 (555) 123-4567 | Emergency: +1 (555) 911-0000</p>
              </div>
              <div class="invoice-meta">
                <h3>PRESCRIPTION</h3>
                <p><strong>Rx #:</strong> ${p.id.slice(0, 8).toUpperCase()}</p>
                <p><strong>Date:</strong> ${App.Utils.formatDate(p.prescription_date)}</p>
              </div>
            </div>

            <div class="invoice-details">
              <div class="detail-group">
                <h4>Patient Information</h4>
                <p><strong>Name:</strong> ${App.State.profile?.full_name || "Patient"}</p>
                <p><strong>Blood Group:</strong> ${App.State.profile?.blood_group || "N/A"}</p>
                <p><strong>Gender / Age:</strong> ${App.State.profile?.gender || "N/A"}</p>
              </div>
              <div class="detail-group">
                <h4>Attending Physician</h4>
                <p><strong>Doctor:</strong> Dr. ${p.doctors?.full_name || "Specialist"}</p>
                <p><strong>Specialty:</strong> ${p.doctors?.specialization || "Clinical Medicine"}</p>
              </div>
            </div>

            <table class="invoice-table">
              <thead>
                <tr>
                  <th>Medicine Name</th>
                  <th>Dosage</th>
                  <th>Frequency</th>
                  <th>Duration</th>
                  <th>Instructions</th>
                </tr>
              </thead>
              <tbody>
                ${(p.prescription_items || []).map(i => `
                  <tr>
                    <td class="font-bold">${i.medicine_name}</td>
                    <td>${i.dosage || "—"}</td>
                    <td>${i.frequency || "—"}</td>
                    <td>${i.duration || "—"}</td>
                    <td class="text-sm">${i.instructions || "After meals"}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>

            <div style="margin-top:2rem; padding-top:1rem; border-top:1px dashed var(--border);">
              <p><strong>Physician Advice / Notes:</strong> ${p.notes || "Take adequate rest and complete the medication course."}</p>
            </div>
          </div>
        `;
      }

      App.UI.openModal("prescription-modal");
    }
  },

  // -------------------------------------------------------------
  // 14. DIAGNOSTIC LAB REPORTS (PATIENT)
  // -------------------------------------------------------------
  PatientLabReports: {
    async load() {
      try {
        const res = await App.api("/patient/lab-reports");
        const tbody = document.getElementById("patient-lab-reports-table-body");
        if (!tbody || !res.data) return;

        if (res.data.length === 0) {
          tbody.innerHTML = `<tr><td colspan="7" class="text-center p-4 text-muted">No diagnostic laboratory reports on file.</td></tr>`;
          return;
        }

        tbody.innerHTML = res.data.map(r => `
          <tr>
            <td class="font-semibold">${r.test_name}</td>
            <td>${App.Utils.formatDate(r.test_date)}</td>
            <td>Dr. ${r.doctors?.full_name || "Diagnostic Lab"}</td>
            <td>${r.result || "Processing..."}</td>
            <td class="text-sm text-muted">${r.reference_range || "Standard"}</td>
            <td>${App.Utils.getStatusBadge(r.status)}</td>
            <td>
              <button class="btn btn-secondary btn-sm" onclick="window.print()">
                <i class="fa-solid fa-download"></i> Print
              </button>
            </td>
          </tr>
        `).join("");
      } catch (err) {
        console.error("Error loading lab reports:", err);
      }
    }
  },

  // -------------------------------------------------------------
  // 15. BILLING & INVOICES (PATIENT)
  // -------------------------------------------------------------
  PatientBilling: {
    invoices: [],

    async load() {
      try {
        const res = await App.api("/patient/billing");
        const tbody = document.getElementById("patient-billing-table-body");
        if (!tbody || !res.data) return;

        App.PatientBilling.invoices = res.data;

        if (res.data.length === 0) {
          tbody.innerHTML = `<tr><td colspan="6" class="text-center p-4 text-muted">No hospital invoices found.</td></tr>`;
          return;
        }

        tbody.innerHTML = res.data.map(b => `
          <tr>
            <td class="font-medium">${App.Utils.formatDate(b.invoice_date)}</td>
            <td class="font-bold">₹${parseFloat(b.total_amount || 0).toFixed(2)}</td>
            <td class="text-success font-medium">₹${parseFloat(b.paid_amount || 0).toFixed(2)}</td>
            <td class="text-danger font-medium">₹${parseFloat(b.remaining_amount || 0).toFixed(2)}</td>
            <td>${App.Utils.getStatusBadge(b.payment_status)}</td>
            <td>
              <button class="btn btn-secondary btn-sm" onclick="App.PatientBilling.viewInvoice('${b.id}')">
                <i class="fa-solid fa-file-invoice"></i> View Invoice
              </button>
            </td>
          </tr>
        `).join("");
      } catch (err) {
        console.error("Error loading billing records:", err);
      }
    },

    viewInvoice(id) {
      const b = App.PatientBilling.invoices.find(x => x.id === id);
      if (!b) return;

      const modalBody = document.getElementById("invoice-modal-body");
      if (modalBody) {
        modalBody.innerHTML = `
          <div class="invoice-view">
            <div class="invoice-header">
              <div class="hospital-info">
                <h2>MediCare General Hospital</h2>
                <p>123 Healthcare Ave, Medical District</p>
                <p>Phone: +91 (555) 123-4567 | Billing Desk: ext. 402</p>
              </div>
              <div class="invoice-meta">
                <h3>INVOICE</h3>
                <p><strong>Invoice #:</strong> INV-${b.id.slice(0, 8).toUpperCase()}</p>
                <p><strong>Date:</strong> ${App.Utils.formatDate(b.invoice_date)}</p>
                <p><strong>Status:</strong> ${b.payment_status.toUpperCase()}</p>
              </div>
            </div>

            <div class="invoice-details">
              <div class="detail-group">
                <h4>Billed To</h4>
                <p><strong>Patient:</strong> ${App.State.profile?.full_name || "Patient"}</p>
                <p><strong>Email:</strong> ${App.State.user?.email}</p>
                <p><strong>Phone:</strong> ${App.State.profile?.phone || "N/A"}</p>
              </div>
              <div class="detail-group">
                <h4>Payment Summary</h4>
                <p><strong>Total Due:</strong> ₹${parseFloat(b.total_amount || 0).toFixed(2)}</p>
                <p><strong>Paid Amount:</strong> ₹${parseFloat(b.paid_amount || 0).toFixed(2)}</p>
                <p class="text-danger"><strong>Remaining Balance:</strong> ₹${parseFloat(b.remaining_amount || 0).toFixed(2)}</p>
              </div>
            </div>

            <table class="invoice-table">
              <thead>
                <tr>
                  <th>Description</th>
                  <th style="text-align:right;">Amount (₹)</th>
                </tr>
              </thead>
              <tbody>
                <tr><td>Physician Consultation Fee</td><td style="text-align:right;">₹${parseFloat(b.consultation_fee || 0).toFixed(2)}</td></tr>
                <tr><td>Laboratory Diagnostic Charges</td><td style="text-align:right;">₹${parseFloat(b.lab_charges || 0).toFixed(2)}</td></tr>
                <tr><td>Pharmacy / Medication Charges</td><td style="text-align:right;">₹${parseFloat(b.medicine_charges || 0).toFixed(2)}</td></tr>
                <tr><td>Room & Bed Inpatient Charges</td><td style="text-align:right;">₹${parseFloat(b.room_charges || 0).toFixed(2)}</td></tr>
                <tr><td>Other Hospital Services</td><td style="text-align:right;">₹${parseFloat(b.other_charges || 0).toFixed(2)}</td></tr>
              </tbody>
            </table>

            <div class="invoice-total">
              <table>
                <tr><td>Subtotal:</td><td style="text-align:right;">₹${parseFloat(b.total_amount || 0).toFixed(2)}</td></tr>
                <tr><td>Paid to Date:</td><td style="text-align:right;" class="text-success">-₹${parseFloat(b.paid_amount || 0).toFixed(2)}</td></tr>
                <tr class="total-row"><td>Balance Due:</td><td style="text-align:right;">₹${parseFloat(b.remaining_amount || 0).toFixed(2)}</td></tr>
              </table>
            </div>
          </div>
        `;
      }

      App.UI.openModal("invoice-modal");
    }
  },

  // -------------------------------------------------------------
  // 16. PROFILE MANAGEMENT
  // -------------------------------------------------------------
  PatientProfile: {
    async load() {
      try {
        const { data: prof } = await App.Config.client.from("profiles").select("*").eq("id", App.State.user.id).single();
        if (!prof) return;

        document.getElementById("prof-name").value = prof.full_name || "";
        document.getElementById("prof-email").value = prof.email || App.State.user.email;
        document.getElementById("prof-phone").value = prof.phone || "";
        document.getElementById("prof-dob").value = prof.date_of_birth || "";
        document.getElementById("prof-gender").value = prof.gender || "Male";
        document.getElementById("prof-blood").value = prof.blood_group || "";
        document.getElementById("prof-address").value = prof.address || "";
      } catch (err) {
        console.error("Error loading profile:", err);
      }
    },

    async saveProfile(e) {
      e.preventDefault();
      try {
        const updateData = {
          full_name: document.getElementById("prof-name").value.trim(),
          phone: document.getElementById("prof-phone").value.trim(),
          date_of_birth: document.getElementById("prof-dob").value || null,
          gender: document.getElementById("prof-gender").value,
          blood_group: document.getElementById("prof-blood").value || null,
          address: document.getElementById("prof-address").value.trim()
        };

        const { error } = await App.Config.client.from("profiles").update(updateData).eq("id", App.State.user.id);
        if (error) throw error;

        App.UI.toast("Profile details updated successfully.", "success");
        App.Auth.checkSession();
      } catch (err) {
        App.UI.toast("Failed to update profile.", "error");
      }
    },

    async changePassword(e) {
      e.preventDefault();
      const p1 = document.getElementById("prof-new-pass").value;
      const p2 = document.getElementById("prof-new-pass-confirm").value;

      if (p1 !== p2) {
        App.UI.toast("Passwords do not match.", "error");
        return;
      }

      try {
        const { error } = await App.Config.client.auth.updateUser({ password: p1 });
        if (error) throw error;
        App.UI.toast("Security password updated successfully.", "success");
        e.target.reset();
      } catch (err) {
        App.UI.toast(err.message || "Failed to update password", "error");
      }
    }
  },

  // -------------------------------------------------------------
  // 17. NOTIFICATIONS CENTER
  // -------------------------------------------------------------
  Notifications: {
    async loadUnread() {
      if (!App.State.user) return;
      try {
        const { data: notifs, count } = await App.Config.client.from("notifications")
          .select("*", { count: "exact" })
          .eq("user_id", App.State.user.id)
          .eq("is_read", false);

        const badgeDot = document.getElementById("topbar-notif-badge");
        const sideBadge = document.getElementById("sidebar-patient-notif-badge");

        if (count && count > 0) {
          if (badgeDot) badgeDot.classList.remove("hidden");
          if (sideBadge) {
            sideBadge.textContent = count;
            sideBadge.classList.remove("hidden");
          }
        } else {
          if (badgeDot) badgeDot.classList.add("hidden");
          if (sideBadge) sideBadge.classList.add("hidden");
        }

        // Render Topbar dropdown list
        const listEl = document.getElementById("topbar-notif-list");
        if (listEl && notifs) {
          if (notifs.length === 0) {
            listEl.innerHTML = `<div class="p-3 text-center text-muted text-sm">No new notifications</div>`;
          } else {
            listEl.innerHTML = notifs.map(n => `
              <div class="notification-item unread" onclick="App.Notifications.markRead('${n.id}')">
                <div class="notif-icon ${n.type}"><i class="fa-solid fa-bell"></i></div>
                <div class="notif-content">
                  <div class="notif-title">${n.title}</div>
                  <div class="notif-message">${n.message}</div>
                  <div class="notif-time">${App.Utils.timeAgo(n.created_at)}</div>
                </div>
              </div>
            `).join("");
          }
        }
      } catch (err) {
        console.error("Error loading notifications:", err);
      }
    },

    async loadFullList() {
      try {
        const { data: notifs } = await App.Config.client.from("notifications")
          .select("*")
          .eq("user_id", App.State.user.id)
          .order("created_at", { ascending: false });

        const container = document.getElementById("patient-full-notif-list");
        if (!container) return;

        if (!notifs || notifs.length === 0) {
          container.innerHTML = `<div class="p-4 text-center text-muted">No notifications in your inbox.</div>`;
          return;
        }

        container.innerHTML = notifs.map(n => `
          <div class="notification-item ${n.is_read ? '' : 'unread'}" onclick="App.Notifications.markRead('${n.id}')">
            <div class="notif-icon ${n.type}"><i class="fa-solid fa-bell"></i></div>
            <div class="notif-content">
              <div class="notif-title">${n.title}</div>
              <div class="notif-message">${n.message}</div>
              <div class="notif-time">${App.Utils.formatDate(n.created_at)}</div>
            </div>
          </div>
        `).join("");
      } catch (err) {
        console.error("Error loading notification inbox:", err);
      }
    },

    async markRead(id) {
      await App.Config.client.from("notifications").update({ is_read: true }).eq("id", id);
      App.Notifications.loadUnread();
      if (App.State.currentSection === "patient-notifications") {
        App.Notifications.loadFullList();
      }
    },

    async markAllAsRead() {
      if (!App.State.user) return;
      await App.Config.client.from("notifications").update({ is_read: true }).eq("user_id", App.State.user.id);
      App.Notifications.loadUnread();
      if (App.State.currentSection === "patient-notifications") {
        App.Notifications.loadFullList();
      }
      App.UI.toast("All notifications marked as read.", "success");
    }
  },

  // -------------------------------------------------------------
  // 18. ADMIN DASHBOARD & KPI ANALYTICS
  // -------------------------------------------------------------
  AdminDashboard: {
    async load() {
      try {
        const res = await App.api("/admin/stats");
        if (!res.success) return;
        const { stats, charts } = res.data;

        // Metric Counters
        document.getElementById("adm-stat-patients").textContent = stats.total_patients;
        document.getElementById("adm-stat-doctors").textContent = stats.total_doctors;
        document.getElementById("adm-stat-today-appts").textContent = stats.today_appointments;
        document.getElementById("adm-stat-pending-appts-badge").textContent = `${stats.pending_appointments} Pending Approval`;
        document.getElementById("adm-stat-emergencies").textContent = stats.emergency_cases;
        document.getElementById("adm-stat-beds").textContent = stats.available_beds;
        document.getElementById("adm-stat-beds-occupied-badge").textContent = `${stats.occupied_beds} Occupied`;
        document.getElementById("adm-stat-revenue").textContent = `₹${parseFloat(stats.today_revenue || 0).toFixed(2)}`;
        document.getElementById("adm-stat-pending-revenue").textContent = `₹${parseFloat(stats.pending_payments || 0).toFixed(2)} Pending`;

        // Render Charts with Chart.js
        App.AdminDashboard.renderCharts(charts);
      } catch (err) {
        console.error("Error loading admin stats:", err);
      }
    },

    refreshStats() {
      App.AdminDashboard.load();
      App.UI.toast("Analytics synchronized.", "info");
    },

    renderCharts(data) {
      if (!window.Chart || !data) return;

      // 1. Appointments Trend Line Chart
      const trendCtx = document.getElementById("chart-appointments-trend");
      if (trendCtx) {
        if (App.State.charts.trend) App.State.charts.trend.destroy();
        const dates = Object.keys(data.appointments_by_date || {});
        const counts = Object.values(data.appointments_by_date || {});

        App.State.charts.trend = new Chart(trendCtx, {
          type: "line",
          data: {
            labels: dates.length ? dates : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
            datasets: [{
              label: "Appointments",
              data: counts.length ? counts : [4, 7, 5, 9, 12, 8, 10],
              borderColor: "#0077B6",
              backgroundColor: "rgba(0,119,182,0.1)",
              fill: true,
              tension: 0.4
            }]
          },
          options: { responsive: true, maintainAspectRatio: false }
        });
      }

      // 2. Status Breakdown Pie Chart
      const statusCtx = document.getElementById("chart-appointment-status");
      if (statusCtx) {
        if (App.State.charts.status) App.State.charts.status.destroy();
        const sc = data.appointment_status || {};
        App.State.charts.status = new Chart(statusCtx, {
          type: "doughnut",
          data: {
            labels: ["Pending", "Confirmed", "Completed", "Cancelled"],
            datasets: [{
              data: [sc.pending || 2, sc.confirmed || 5, sc.completed || 8, sc.cancelled || 1],
              backgroundColor: ["#FFD166", "#00B4D8", "#06D6A0", "#EF476F"]
            }]
          },
          options: { responsive: true, maintainAspectRatio: false }
        });
      }

      // 3. Department Performance Bar Chart
      const deptCtx = document.getElementById("chart-department-performance");
      if (deptCtx) {
        if (App.State.charts.dept) App.State.charts.dept.destroy();
        const dLabels = Object.keys(data.department_performance || {});
        const dCounts = Object.values(data.department_performance || {});
        App.State.charts.dept = new Chart(deptCtx, {
          type: "bar",
          data: {
            labels: dLabels.length ? dLabels : ["Cardiology", "Neurology", "Orthopedics", "Pediatrics", "Dermatology"],
            datasets: [{
              label: "Patients Consulted",
              data: dCounts.length ? dCounts : [15, 12, 18, 9, 14],
              backgroundColor: "#00B4D8"
            }]
          },
          options: { responsive: true, maintainAspectRatio: false }
        });
      }

      // 4. Room Occupancy Chart
      const roomCtx = document.getElementById("chart-room-occupancy");
      if (roomCtx) {
        if (App.State.charts.room) App.State.charts.room.destroy();
        const rLabels = Object.keys(data.room_occupancy || {});
        const rAvail = rLabels.map(k => data.room_occupancy[k].available);
        const rOcc = rLabels.map(k => data.room_occupancy[k].occupied);

        App.State.charts.room = new Chart(roomCtx, {
          type: "bar",
          data: {
            labels: rLabels.length ? rLabels : ["General", "ICU", "Private", "Semi-Private"],
            datasets: [
              { label: "Occupied Beds", data: rOcc.length ? rOcc : [8, 4, 3, 5], backgroundColor: "#EF476F" },
              { label: "Available Beds", data: rAvail.length ? rAvail : [12, 2, 7, 5], backgroundColor: "#06D6A0" }
            ]
          },
          options: { responsive: true, maintainAspectRatio: false, scales: { x: { stacked: true }, y: { stacked: true } } }
        });
      }
    }
  },

  // -------------------------------------------------------------
  // 19. ADMIN DOCTOR MANAGEMENT
  // -------------------------------------------------------------
  AdminDoctors: {
    _cache: null,
    _deptCache: null,
    _searchTimer: null,

    handlePhotoSelect(e) {
      const file = e.target.files[0];
      if (!file) return;

      if (!file.type.startsWith("image/")) {
        App.UI.toast("Please select an image file (JPG, PNG, WebP).", "warning");
        return;
      }

      if (file.size > 3 * 1024 * 1024) {
        App.UI.toast("Image file is too large (max 3MB).", "warning");
        return;
      }

      const reader = new FileReader();
      reader.onload = (loadEvent) => {
        const dataUrl = loadEvent.target.result;
        App.AdminDoctors.setPhotoPreview(dataUrl);
      };
      reader.readAsDataURL(file);
    },

    handlePhotoUrlInput(url) {
      const trimmed = (url || "").trim();
      if (trimmed && (trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("data:image/"))) {
        App.AdminDoctors.setPhotoPreview(trimmed);
      } else if (!trimmed) {
        App.AdminDoctors.removePhoto();
      }
    },

    setPhotoPreview(url) {
      const preview = document.getElementById("doc-photo-preview");
      const hiddenInput = document.getElementById("doc-form-avatar-url");
      const removeBtn = document.getElementById("btn-doc-remove-photo");

      if (hiddenInput) hiddenInput.value = url;
      if (removeBtn) removeBtn.style.display = "inline-flex";
      if (preview) {
        preview.innerHTML = `<img src="${url}" alt="Doctor photo" style="width:100%; height:100%; object-fit:cover; border-radius:50%;">`;
      }
    },

    removePhoto() {
      const preview = document.getElementById("doc-photo-preview");
      const hiddenInput = document.getElementById("doc-form-avatar-url");
      const fileInput = document.getElementById("doc-form-photo-file");
      const urlInput = document.getElementById("doc-form-photo-url-input");
      const removeBtn = document.getElementById("btn-doc-remove-photo");

      if (hiddenInput) hiddenInput.value = "";
      if (fileInput) fileInput.value = "";
      if (urlInput) urlInput.value = "";
      if (removeBtn) removeBtn.style.display = "none";
      if (preview) {
        preview.innerHTML = `<i class="fa-solid fa-user-doctor"></i>`;
      }
    },

    async loadDoctors() {
      const tbody = document.getElementById("adm-doctors-table-body");
      if (!tbody) return;

      try {
        const search = (document.getElementById("adm-doc-search")?.value || "").toLowerCase();
        const deptFilter = document.getElementById("adm-doc-dept-filter")?.value;
        const statusFilter = document.getElementById("adm-doc-status-filter")?.value;

        // Show loading on first load
        if (!App.AdminDoctors._cache) {
          tbody.innerHTML = `<tr><td colspan="8" class="text-center p-4"><div class="spinner"></div></td></tr>`;
        }

        const { data: docs, error: docsErr } = await App.Config.client.from("doctors").select("*, departments!doctors_department_id_fkey(name)").order("full_name");
        if (docsErr) throw docsErr;

        const { data: depts, error: deptsErr } = await App.Config.client.from("departments").select("*").eq("status", "active").order("name");
        if (deptsErr) console.warn("Dept load warning:", deptsErr);

        App.AdminDoctors._cache = docs || [];
        App.AdminDoctors._deptCache = depts || [];

        // Populate dept filter dropdown
        const deptFilterEl = document.getElementById("adm-doc-dept-filter");
        if (deptFilterEl && depts) {
          const currentVal = deptFilterEl.value;
          deptFilterEl.innerHTML = `<option value="">All Departments</option>` +
            depts.map(d => `<option value="${d.id}" ${d.id === currentVal ? 'selected' : ''}>${d.name}</option>`).join("");
        }

        const filtered = (docs || []).filter(d => {
          const matchSearch = !search || (d.full_name || "").toLowerCase().includes(search) || (d.specialization || "").toLowerCase().includes(search) || (d.email || "").toLowerCase().includes(search);
          const matchDept = !deptFilter || d.department_id === deptFilter;
          const matchStatus = !statusFilter || d.status === statusFilter;
          return matchSearch && matchDept && matchStatus;
        });

        if (filtered.length === 0) {
          tbody.innerHTML = `<tr><td colspan="8" class="text-center p-4 text-muted">No doctors found matching your search.</td></tr>`;
          return;
        }

        tbody.innerHTML = filtered.map(d => {
          const days = (d.available_days || []);
          const daysDisplay = days.length > 3 ? days.slice(0, 3).join(", ") + `... +${days.length - 3}` : days.join(", ") || "Not set";
          const avatarHtml = d.avatar_url ?
            `<img src="${d.avatar_url}" alt="${d.full_name}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">` :
            `<i class="fa-solid fa-user-doctor"></i>`;

          return `
          <tr>
            <td>
              <div class="cell-user">
                <div class="cell-avatar">${avatarHtml}</div>
                <div>
                  <div class="cell-name">${d.full_name || "Unnamed Doctor"}</div>
                  <div class="cell-email">${d.email || d.phone || "No contact"}</div>
                </div>
              </div>
            </td>
            <td>${d.departments?.name || "—"}</td>
            <td>${d.specialization || "—"}</td>
            <td>${d.experience || 0} yrs</td>
            <td class="font-bold text-primary">₹${parseFloat(d.consultation_fee || 0).toFixed(0)}</td>
            <td class="text-xs text-muted">${daysDisplay}</td>
            <td>${App.Utils.getStatusBadge(d.status)}</td>
            <td>
              <div class="cell-actions">
                <button title="Edit Doctor" onclick="App.AdminDoctors.openEditModal('${d.id}')">
                  <i class="fa-solid fa-pen-to-square"></i>
                </button>
                <button title="Toggle Status" class="danger" onclick="App.AdminDoctors.toggleStatus('${d.id}', '${d.status}')">
                  <i class="fa-solid fa-power-off"></i>
                </button>
                <button title="Delete Doctor" class="danger" onclick="App.AdminDoctors.deleteDoctor('${d.id}', '${(d.full_name || "").replace(/'/g, "\\'")  }')">
                  <i class="fa-solid fa-trash"></i>
                </button>
              </div>
            </td>
          </tr>
        `;
        }).join("");
      } catch (err) {
        console.error("Error loading admin doctors:", err);
        tbody.innerHTML = `<tr><td colspan="8" class="text-center p-4 text-danger">Error loading doctors: ${err.message || 'Unknown error'}</td></tr>`;
      }
    },

    async openAddModal() {
      try {
        document.getElementById("modal-doctor-title").innerHTML = `<i class="fa-solid fa-user-doctor text-primary"></i> Add New Doctor`;
        document.getElementById("form-doctor-crud").reset();
        document.getElementById("doc-form-id").value = "";
        App.AdminDoctors.removePhoto();

        // Reset checkboxes to default (Mon-Fri checked)
        document.querySelectorAll('input[name="doc_days"]').forEach(cb => {
          cb.checked = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].includes(cb.value);
        });

        // Populate departments select
        const depts = App.AdminDoctors._deptCache || (await App.Config.client.from("departments").select("*").eq("status", "active").order("name")).data;
        const deptSelect = document.getElementById("doc-form-dept");
        if (deptSelect && depts) {
          deptSelect.innerHTML = `<option value="">-- Select Department --</option>` + depts.map(d => `<option value="${d.id}">${d.name}</option>`).join("");
        }

        App.UI.openModal("modal-doctor-form");
      } catch (err) {
        App.UI.toast("Failed to open add doctor form: " + (err.message || ""), "error");
      }
    },

    async openEditModal(id) {
      try {
        const { data: doc, error } = await App.Config.client.from("doctors").select("*").eq("id", id).single();
        if (error) throw error;
        if (!doc) { App.UI.toast("Doctor not found.", "error"); return; }

        document.getElementById("modal-doctor-title").innerHTML = `<i class="fa-solid fa-user-pen text-primary"></i> Edit Doctor Information`;
        document.getElementById("doc-form-id").value = doc.id;
        document.getElementById("doc-form-name").value = doc.full_name || "";
        document.getElementById("doc-form-spec").value = doc.specialization || "";
        document.getElementById("doc-form-qual").value = doc.qualification || "";
        document.getElementById("doc-form-email").value = doc.email || "";
        document.getElementById("doc-form-phone").value = doc.phone || "";
        document.getElementById("doc-form-exp").value = doc.experience || 0;
        document.getElementById("doc-form-fee").value = doc.consultation_fee || 0;
        document.getElementById("doc-form-gender").value = doc.gender || "Male";
        document.getElementById("doc-form-status").value = doc.status || "active";

        // Handle avatar photo preview
        if (doc.avatar_url) {
          App.AdminDoctors.setPhotoPreview(doc.avatar_url);
          const urlInput = document.getElementById("doc-form-photo-url-input");
          if (urlInput && doc.avatar_url.startsWith("http")) urlInput.value = doc.avatar_url;
        } else {
          App.AdminDoctors.removePhoto();
        }

        // Handle time fields - strip seconds if present
        const startTime = (doc.available_time_start || "09:00").substring(0, 5);
        const endTime = (doc.available_time_end || "17:00").substring(0, 5);
        document.getElementById("doc-form-start").value = startTime;
        document.getElementById("doc-form-end").value = endTime;

        // Set available days checkboxes
        const docDays = doc.available_days || [];
        document.querySelectorAll('input[name="doc_days"]').forEach(cb => {
          cb.checked = docDays.includes(cb.value);
        });

        // Populate departments select
        const depts = App.AdminDoctors._deptCache || (await App.Config.client.from("departments").select("*").eq("status", "active").order("name")).data;
        const deptSelect = document.getElementById("doc-form-dept");
        if (deptSelect && depts) {
          deptSelect.innerHTML = depts.map(d => `<option value="${d.id}" ${d.id === doc.department_id ? 'selected' : ''}>${d.name}</option>`).join("");
        }

        App.UI.openModal("modal-doctor-form");
      } catch (err) {
        App.UI.toast("Failed to load doctor details: " + (err.message || ""), "error");
      }
    },

    async saveDoctor(e) {
      e.preventDefault();
      const saveBtn = e.target.querySelector('button[type="submit"]');
      const originalText = saveBtn.innerHTML;

      try {
        saveBtn.disabled = true;
        saveBtn.innerHTML = `<div class="spinner spinner-sm"></div> Saving...`;

        const id = document.getElementById("doc-form-id").value;
        const checkedDays = Array.from(document.querySelectorAll('input[name="doc_days"]:checked')).map(cb => cb.value);
        const deptId = document.getElementById("doc-form-dept").value;
        const avatarUrl = document.getElementById("doc-form-avatar-url")?.value || null;

        if (!deptId) {
          App.UI.toast("Please select a department.", "warning");
          return;
        }

        const payload = {
          full_name: document.getElementById("doc-form-name").value.trim(),
          department_id: deptId,
          specialization: document.getElementById("doc-form-spec").value.trim(),
          qualification: document.getElementById("doc-form-qual").value.trim(),
          email: document.getElementById("doc-form-email").value.trim() || null,
          phone: document.getElementById("doc-form-phone").value.trim() || null,
          experience: parseInt(document.getElementById("doc-form-exp").value) || 0,
          consultation_fee: parseFloat(document.getElementById("doc-form-fee").value) || 0,
          available_time_start: document.getElementById("doc-form-start").value || "09:00",
          available_time_end: document.getElementById("doc-form-end").value || "17:00",
          available_days: checkedDays.length ? checkedDays : ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
          gender: document.getElementById("doc-form-gender").value || "Male",
          status: document.getElementById("doc-form-status").value || "active",
          avatar_url: avatarUrl
        };

        if (!payload.full_name) {
          App.UI.toast("Doctor name is required.", "warning");
          return;
        }
        if (!payload.specialization) {
          App.UI.toast("Specialization is required.", "warning");
          return;
        }

        if (id) {
          const { error } = await App.Config.client.from("doctors").update(payload).eq("id", id);
          if (error) throw error;
          App.UI.toast("Doctor updated successfully!", "success");
        } else {
          const { error } = await App.Config.client.from("doctors").insert(payload);
          if (error) throw error;
          App.UI.toast("New doctor added successfully!", "success");
        }

        App.AdminDoctors._cache = null; // Clear cache to force refresh
        App.UI.closeModal("modal-doctor-form");
        await App.AdminDoctors.loadDoctors();
      } catch (err) {
        console.error("Save doctor error:", err);
        App.UI.toast("Failed to save doctor: " + (err.message || "Unknown error"), "error");
      } finally {
        saveBtn.disabled = false;
        saveBtn.innerHTML = originalText;
      }
    },

    async toggleStatus(id, currentStatus) {
      const nextStatus = currentStatus === "active" ? "inactive" : "active";
      App.UI.confirm(`Change doctor status to ${nextStatus.toUpperCase()}?`, async () => {
        try {
          const { error } = await App.Config.client.from("doctors").update({ status: nextStatus }).eq("id", id);
          if (error) throw error;
          App.UI.toast(`Doctor marked as ${nextStatus}.`, "info");
          App.AdminDoctors._cache = null;
          App.AdminDoctors.loadDoctors();
        } catch (err) {
          App.UI.toast("Failed to update status: " + (err.message || ""), "error");
        }
      });
    },

    async deleteDoctor(id, name) {
      App.UI.confirm(`Permanently DELETE Dr. ${name}? This cannot be undone.`, async () => {
        try {
          const { error } = await App.Config.client.from("doctors").delete().eq("id", id);
          if (error) throw error;
          App.UI.toast(`Doctor "${name}" deleted successfully.`, "info");
          App.AdminDoctors._cache = null;
          App.AdminDoctors.loadDoctors();
        } catch (err) {
          App.UI.toast("Failed to delete doctor: " + (err.message || ""), "error");
        }
      });
    }
  },

  // -------------------------------------------------------------
  // 20. ADMIN MANAGEMENT (ADMIN ACCOUNTS)
  // -------------------------------------------------------------
  AdminAdmins: {
    _cache: null,

    async loadAdmins() {
      const tbody = document.getElementById("adm-admins-table-body");
      if (!tbody) return;

      try {
        const q = (document.getElementById("adm-admin-search")?.value || "").toLowerCase();

        if (!App.AdminAdmins._cache) {
          tbody.innerHTML = `<tr><td colspan="6" class="text-center p-4"><div class="spinner"></div></td></tr>`;
        }

        const { data: admins, error } = await App.Config.client
          .from("profiles")
          .select("id, full_name, email, role, status, created_at")
          .eq("role", "admin")
          .order("created_at", { ascending: true });

        if (error) throw error;
        App.AdminAdmins._cache = admins || [];

        const filtered = (admins || []).filter(a => {
          return (a.full_name || "").toLowerCase().includes(q) || (a.email || "").toLowerCase().includes(q);
        });

        if (filtered.length === 0) {
          tbody.innerHTML = `<tr><td colspan="6" class="text-center p-4 text-muted">No administrators found matching your search.</td></tr>`;
          return;
        }

        tbody.innerHTML = filtered.map(a => {
          const isMain = a.email === "adityakumar9523340408@gmail.com" || a.email === "admin@medicare.com";
          const isSelf = App.State.user && (App.State.user.id === a.id || App.State.user.email === a.email);
          const status = a.status || "active";
          const statusBadge = status === "active"
            ? `<span class="badge badge-success"><i class="fa-solid fa-circle-check"></i> Active</span>`
            : `<span class="badge badge-danger"><i class="fa-solid fa-ban"></i> Disabled</span>`;

          return `
            <tr>
              <td>
                <div class="cell-user">
                  <div class="cell-avatar" style="background:linear-gradient(135deg, #0077B6, #00B4D8); color:white; font-weight:bold;">
                    <i class="fa-solid fa-user-shield"></i>
                  </div>
                  <div>
                    <div class="cell-name">${a.full_name || "Administrator"} ${isSelf ? '<span class="badge badge-info" style="font-size:0.7rem; margin-left:4px;">YOU</span>' : ''}</div>
                    <div class="cell-email text-xs text-muted">${a.email || ""}</div>
                  </div>
                </div>
              </td>
              <td class="font-medium">${a.email || "—"}</td>
              <td><span class="badge badge-primary font-bold">ADMIN</span></td>
              <td>${statusBadge}</td>
              <td class="text-xs text-muted">${App.Utils.formatDate(a.created_at)}</td>
              <td>
                <div class="cell-actions">
                  ${!isSelf ? `
                    <button title="${status === 'active' ? 'Disable Admin Account' : 'Enable Admin Account'}"
                            class="${status === 'active' ? 'danger' : 'btn-sm'}"
                            onclick="App.AdminAdmins.toggleAdminStatus('${a.id}', '${status}', '${(a.full_name || "").replace(/'/g, "\\'")}')">
                      <i class="fa-solid ${status === 'active' ? 'fa-user-slash' : 'fa-user-check'}"></i>
                    </button>
                  ` : ''}
                  ${!isMain && !isSelf ? `
                    <button title="Delete Administrator" class="danger"
                            onclick="App.AdminAdmins.deleteAdmin('${a.id}', '${(a.full_name || "").replace(/'/g, "\\'")}', '${a.email}')">
                      <i class="fa-solid fa-trash"></i>
                    </button>
                  ` : ''}
                </div>
              </td>
            </tr>
          `;
        }).join("");
      } catch (err) {
        console.error("Error loading admins:", err);
        tbody.innerHTML = `<tr><td colspan="6" class="text-center p-4 text-danger">Error: ${err.message || 'Failed to load administrators'}</td></tr>`;
      }
    },

    openAddModal() {
      document.getElementById("form-admin-create").reset();
      App.UI.openModal("modal-admin-form");
    },

    async saveNewAdmin(e) {
      e.preventDefault();
      const submitBtn = document.getElementById("btn-save-admin-submit");
      const originalText = submitBtn ? submitBtn.innerHTML : '<i class="fa-solid fa-user-check"></i> Create Administrator';

      // Prevent duplicate clicks / submissions
      if (submitBtn && submitBtn.disabled) return;

      const name = document.getElementById("admin-form-name")?.value.trim();
      const email = document.getElementById("admin-form-email")?.value.trim().toLowerCase();
      const pass = document.getElementById("admin-form-pass")?.value;
      const confirmPass = document.getElementById("admin-form-confirm-pass")?.value;

      if (!name || !email || !pass) {
        App.UI.toast("Please fill in all required fields.", "warning");
        return;
      }

      if (pass !== confirmPass) {
        App.UI.toast("Passwords do not match.", "error");
        return;
      }

      if (pass.length < 6) {
        App.UI.toast("Password must be at least 6 characters.", "warning");
        return;
      }

      try {
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.innerHTML = `<div class="spinner spinner-sm"></div> Creating Administrator...`;
        }

        // Get active Supabase session access token for Bearer Authorization
        const { data: sessionData } = await App.Config.client.auth.getSession();
        const token = sessionData?.session?.access_token;

        if (!token) {
          throw new Error("Admin session expired. Please log out and sign in as Administrator again.");
        }

        const headers = {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        };

        // Call FastAPI secure backend endpoint: POST /api/admin/create-admin
        const res = await fetch(`${App.Config.apiBaseUrl}/admin/create-admin`, {
          method: "POST",
          headers: headers,
          body: JSON.stringify({
            full_name: name,
            email: email,
            password: pass
          })
        });

        const resData = await res.json().catch(() => ({}));

        if (!res.ok) {
          throw new Error(resData.detail || `Server error (${res.status}): Failed to create administrator.`);
        }

        App.UI.toast(`New Administrator "${name}" created successfully!`, "success");
        App.AdminAdmins._cache = null;
        App.UI.closeModal("modal-admin-form");
        await App.AdminAdmins.loadAdmins();
      } catch (err) {
        console.error("Create admin error:", err);
        App.UI.toast(err.message || "Failed to create administrator.", "error");
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = originalText;
        }
      }
    },

    async toggleAdminStatus(id, currentStatus, name) {
      const nextStatus = currentStatus === "active" ? "disabled" : "active";
      App.UI.confirm(`Are you sure you want to ${nextStatus.toUpperCase()} administrator "${name}"?`, async () => {
        try {
          const { data: sessionData } = await App.Config.client.auth.getSession();
          const token = sessionData?.session?.access_token;
          const headers = { "Content-Type": "application/json" };
          if (token) headers["Authorization"] = `Bearer ${token}`;

          try {
            await fetch(`${App.Config.apiBaseUrl}/admin/users/${id}/status`, {
              method: "PUT",
              headers: headers,
              body: JSON.stringify({ status: nextStatus })
            });
          } catch (beErr) {
            console.warn("Backend status update note:", beErr);
          }

          const { error } = await App.Config.client.from("profiles").update({ status: nextStatus }).eq("id", id);
          if (error) throw error;

          App.UI.toast(`Administrator account "${name}" has been marked as ${nextStatus}.`, "info");
          App.AdminAdmins._cache = null;
          await App.AdminAdmins.loadAdmins();
        } catch (err) {
          App.UI.toast("Failed to update status: " + (err.message || ""), "error");
        }
      });
    },

    async deleteAdmin(id, name, email) {
      if (email === "adityakumar9523340408@gmail.com" || email === "admin@medicare.com") {
        App.UI.toast("The main executive administrator account cannot be deleted.", "warning");
        return;
      }

      App.UI.confirm(`Permanently DELETE administrator "${name}"? This cannot be undone.`, async () => {
        try {
          const { data: sessionData } = await App.Config.client.auth.getSession();
          const token = sessionData?.session?.access_token;
          const headers = { "Content-Type": "application/json" };
          if (token) headers["Authorization"] = `Bearer ${token}`;

          try {
            await fetch(`${App.Config.apiBaseUrl}/admin/users/${id}`, {
              method: "DELETE",
              headers: headers
            });
          } catch (beErr) {
            console.warn("Backend user delete note:", beErr);
          }

          const { error } = await App.Config.client.from("profiles").delete().eq("id", id);
          if (error) throw error;

          App.UI.toast(`Administrator "${name}" deleted successfully.`, "info");
          App.AdminAdmins._cache = null;
          await App.AdminAdmins.loadAdmins();
        } catch (err) {
          App.UI.toast("Failed to delete administrator: " + (err.message || ""), "error");
        }
      });
    }
  },

  // -------------------------------------------------------------
  // 21. ADMIN PATIENT DIRECTORY & USERS
  // -------------------------------------------------------------
  AdminPatients: {
    async loadPatients() {
      const tbody = document.getElementById("adm-patients-table-body");
      if (!tbody) return;

      try {
        const q = (document.getElementById("adm-patient-search")?.value || "").toLowerCase();
        const { data: pts, error } = await App.Config.client
          .from("profiles")
          .select("*")
          .eq("role", "patient")
          .order("created_at", { ascending: false });
        if (error) throw error;

        const filtered = (pts || []).filter(p => {
          return (p.full_name || "").toLowerCase().includes(q) || (p.email || "").toLowerCase().includes(q) || (p.phone || "").includes(q);
        });

        if (filtered.length === 0) {
          tbody.innerHTML = `<tr><td colspan="7" class="text-center p-4 text-muted">No registered patients found.</td></tr>`;
          return;
        }

        tbody.innerHTML = filtered.map(p => {
          const status = p.status || "active";
          const statusBadge = status === "active"
            ? `<span class="badge badge-success"><i class="fa-solid fa-circle-check"></i> Active</span>`
            : `<span class="badge badge-danger"><i class="fa-solid fa-ban"></i> Disabled</span>`;

          return `
            <tr>
              <td>
                <div class="cell-user">
                  <div class="cell-avatar"><i class="fa-solid fa-hospital-user"></i></div>
                  <div>
                    <div class="cell-name">${p.full_name || "Patient"}</div>
                    <div class="text-xs text-muted">Blood: ${p.blood_group || "N/A"}</div>
                  </div>
                </div>
              </td>
              <td>${p.email || "—"}</td>
              <td>${p.phone || "—"}</td>
              <td>${p.gender || "—"}</td>
              <td>${statusBadge}</td>
              <td class="text-xs text-muted">${App.Utils.formatDate(p.created_at)}</td>
              <td>
                <div class="cell-actions">
                  <button class="btn btn-secondary btn-sm" title="View Patient Details" onclick="App.AdminPatients.viewPatientDetails('${p.id}')">
                    <i class="fa-solid fa-eye"></i> Details
                  </button>
                  <button class="${status === 'active' ? 'danger' : 'btn-sm'}" title="${status === 'active' ? 'Disable Patient Account' : 'Enable Patient Account'}"
                          onclick="App.AdminPatients.togglePatientStatus('${p.id}', '${status}', '${(p.full_name || "").replace(/'/g, "\\'")}')">
                    <i class="fa-solid ${status === 'active' ? 'fa-user-slash' : 'fa-user-check'}"></i>
                  </button>
                </div>
              </td>
            </tr>
          `;
        }).join("");
      } catch (err) {
        console.error("Error loading admin patients:", err);
        tbody.innerHTML = `<tr><td colspan="7" class="text-center p-4 text-danger">Error: ${err.message || 'Failed to load patients'}</td></tr>`;
      }
    },

    async togglePatientStatus(id, currentStatus, name) {
      const nextStatus = currentStatus === "active" ? "disabled" : "active";
      App.UI.confirm(`Are you sure you want to mark patient "${name}" account as ${nextStatus.toUpperCase()}?`, async () => {
        try {
          const { error } = await App.Config.client.from("profiles").update({ status: nextStatus }).eq("id", id);
          if (error) throw error;

          App.UI.toast(`Patient account for "${name}" is now ${nextStatus}.`, "info");
          await App.AdminPatients.loadPatients();
        } catch (err) {
          App.UI.toast("Failed to update status: " + (err.message || ""), "error");
        }
      });
    },

    async viewPatientDetails(id) {
      try {
        const { data: p, error } = await App.Config.client.from("profiles").select("*").eq("id", id).single();
        if (error) throw error;
        if (!p) { App.UI.toast("Patient not found.", "error"); return; }

        // Get appointment count
        const { count: apptCount } = await App.Config.client.from("appointments").select("id", { count: "exact", head: true }).eq("patient_id", id);

        const detailsBody = document.getElementById("doctor-details-body");
        if (detailsBody) {
          detailsBody.innerHTML = `
            <div style="text-align:center; margin-bottom:1.5rem;">
              <div style="width:64px; height:64px; border-radius:50%; background:linear-gradient(135deg, var(--primary), var(--accent)); display:flex; align-items:center; justify-content:center; margin:0 auto 0.75rem; color:white; font-size:1.5rem; font-weight:700;">
                ${(p.full_name || "P").charAt(0).toUpperCase()}
              </div>
              <h3 style="margin:0;">${p.full_name || "Patient"}</h3>
              <p class="text-muted text-sm">${p.email || ""}</p>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:1rem;">
              <div class="card p-3" style="background:var(--bg-tertiary);">
                <div class="text-xs text-muted">Phone</div>
                <div class="font-medium">${p.phone || "Not provided"}</div>
              </div>
              <div class="card p-3" style="background:var(--bg-tertiary);">
                <div class="text-xs text-muted">Gender</div>
                <div class="font-medium">${p.gender || "Not specified"}</div>
              </div>
              <div class="card p-3" style="background:var(--bg-tertiary);">
                <div class="text-xs text-muted">Date of Birth</div>
                <div class="font-medium">${p.date_of_birth ? App.Utils.formatDate(p.date_of_birth) : "Not provided"}</div>
              </div>
              <div class="card p-3" style="background:var(--bg-tertiary);">
                <div class="text-xs text-muted">Blood Group</div>
                <div class="font-medium"><span class="badge badge-danger">${p.blood_group || "N/A"}</span></div>
              </div>
              <div class="card p-3" style="background:var(--bg-tertiary); grid-column:span 2;">
                <div class="text-xs text-muted">Address</div>
                <div class="font-medium">${p.address || "Not provided"}</div>
              </div>
              <div class="card p-3" style="background:var(--bg-tertiary);">
                <div class="text-xs text-muted">Registered On</div>
                <div class="font-medium">${App.Utils.formatDate(p.created_at)}</div>
              </div>
              <div class="card p-3" style="background:var(--bg-tertiary);">
                <div class="text-xs text-muted">Total Appointments</div>
                <div class="font-medium">${apptCount || 0}</div>
              </div>
            </div>
          `;
          document.querySelector('#doctor-details-modal .modal-header h3').textContent = 'Patient Details';
          const bookBtn = document.getElementById('book-with-doc-btn');
          if (bookBtn) bookBtn.style.display = 'none';
          App.UI.openModal('doctor-details-modal');
        }
      } catch (err) {
        App.UI.toast("Failed to load patient details: " + (err.message || ""), "error");
      }
    }
  },

  // -------------------------------------------------------------
  // 21. ADMIN DEPARTMENT MANAGEMENT
  // -------------------------------------------------------------
  AdminDepartments: {
    async loadDepartments() {
      try {
        const { data: depts, error } = await App.Config.client.from("departments").select("*, doctors!doctors_department_id_fkey(id)").order("name");
        if (error) throw error;
        const tbody = document.getElementById("adm-departments-table-body");
        if (!tbody || !depts) return;

        tbody.innerHTML = depts.map(d => `
          <tr>
            <td class="font-semibold">${d.name}</td>
            <td class="text-sm text-muted">${d.description || "—"}</td>
            <td><span class="badge badge-primary">${(d.doctors || []).length} Doctors</span></td>
            <td>${App.Utils.getStatusBadge(d.status)}</td>
            <td>
              <div class="cell-actions">
                <button title="Edit Department" onclick="App.AdminDepartments.openEditModal('${d.id}')">
                  <i class="fa-solid fa-pen-to-square"></i>
                </button>
              </div>
            </td>
          </tr>
        `).join("");
      } catch (err) {
        console.error("Error loading departments:", err);
      }
    },

    openAddModal() {
      document.getElementById("modal-dept-title").textContent = "Add Department";
      document.getElementById("form-dept-crud").reset();
      document.getElementById("dept-form-id").value = "";
      App.UI.openModal("modal-department-form");
    },

    async openEditModal(id) {
      const { data: d } = await App.Config.client.from("departments").select("*").eq("id", id).single();
      if (!d) return;

      document.getElementById("modal-dept-title").textContent = "Edit Department";
      document.getElementById("dept-form-id").value = d.id;
      document.getElementById("dept-form-name").value = d.name;
      document.getElementById("dept-form-desc").value = d.description || "";
      document.getElementById("dept-form-status").value = d.status || "active";
      App.UI.openModal("modal-department-form");
    },

    async saveDepartment(e) {
      e.preventDefault();
      const id = document.getElementById("dept-form-id").value;
      const payload = {
        name: document.getElementById("dept-form-name").value.trim(),
        description: document.getElementById("dept-form-desc").value.trim(),
        status: document.getElementById("dept-form-status").value
      };

      try {
        if (id) {
          await App.Config.client.from("departments").update(payload).eq("id", id);
          App.UI.toast("Department updated.", "success");
        } else {
          await App.Config.client.from("departments").insert(payload);
          App.UI.toast("Department added.", "success");
        }
        App.UI.closeModal("modal-department-form");
        App.AdminDepartments.loadDepartments();
      } catch (err) {
        App.UI.toast("Failed to save department.", "error");
      }
    }
  },

  // -------------------------------------------------------------
  // 22. ADMIN APPOINTMENTS MASTER
  // -------------------------------------------------------------
  AdminAppointments: {
    async loadAppointments() {
      try {
        const statusFilter = document.getElementById("adm-appt-status-filter")?.value;
        const dateFilter = document.getElementById("adm-appt-date-filter")?.value;

        let q = App.Config.client.from("appointments")
          .select("*, doctors(full_name), departments(name), profiles!appointments_patient_id_fkey(full_name, email, phone)");

        if (statusFilter) q = q.eq("status", statusFilter);
        if (dateFilter) q = q.eq("appointment_date", dateFilter);

        const { data: appts } = await q.order("appointment_date", { ascending: false });
        const tbody = document.getElementById("adm-appointments-table-body");
        if (!tbody) return;

        if (!appts || appts.length === 0) {
          tbody.innerHTML = `<tr><td colspan="7" class="text-center p-4 text-muted">No appointments found matching filter.</td></tr>`;
          return;
        }

        tbody.innerHTML = appts.map(a => `
          <tr>
            <td>
              <div class="cell-user">
                <div class="cell-avatar"><i class="fa-solid fa-hospital-user"></i></div>
                <div>
                  <div class="cell-name">${a.profiles?.full_name || "Patient"}</div>
                  <div class="cell-email">${a.profiles?.phone || a.profiles?.email || ""}</div>
                </div>
              </div>
            </td>
            <td>Dr. ${a.doctors?.full_name || "Doctor"}</td>
            <td>${a.departments?.name || "General"}</td>
            <td>
              <div class="font-medium">${App.Utils.formatDate(a.appointment_date)}</div>
              <div class="text-xs text-muted">${a.appointment_time}</div>
            </td>
            <td class="text-sm">${a.reason || "General"}</td>
            <td>${App.Utils.getStatusBadge(a.status)}</td>
            <td>
              <div class="cell-actions">
                ${a.status === "pending" ? `
                  <button title="Approve Appointment" style="color:var(--success);" onclick="App.AdminAppointments.updateStatus('${a.id}', 'confirmed', '${a.patient_id}')">
                    <i class="fa-solid fa-check"></i>
                  </button>
                  <button title="Reject Appointment" class="danger" onclick="App.AdminAppointments.updateStatus('${a.id}', 'rejected', '${a.patient_id}')">
                    <i class="fa-solid fa-xmark"></i>
                  </button>
                ` : ''}
                ${a.status === "confirmed" ? `
                  <button title="Mark Completed" style="color:var(--primary);" onclick="App.AdminAppointments.updateStatus('${a.id}', 'completed', '${a.patient_id}')">
                    <i class="fa-solid fa-circle-check"></i>
                  </button>
                ` : ''}
              </div>
            </td>
          </tr>
        `).join("");
      } catch (err) {
        console.error("Error loading admin appointments:", err);
      }
    },

    async updateStatus(id, newStatus, patientId) {
      try {
        await App.Config.client.from("appointments").update({ status: newStatus }).eq("id", id);
        if (patientId) {
          await App.Config.client.from("notifications").insert({
            user_id: patientId,
            title: `Appointment ${newStatus.toUpperCase()}`,
            message: `Your appointment has been marked as ${newStatus}.`,
            type: "appointment"
          });
        }
        App.UI.toast(`Appointment marked as ${newStatus}.`, "success");
        App.AdminAppointments.loadAppointments();
      } catch (err) {
        App.UI.toast("Failed to update status.", "error");
      }
    }
  },

  // -------------------------------------------------------------
  // 23. ADMIN MEDICAL RECORDS
  // -------------------------------------------------------------
  AdminMedicalRecords: {
    async loadRecords() {
      try {
        const q = (document.getElementById("adm-record-search")?.value || "").toLowerCase();
        const { data: recs } = await App.Config.client.from("medical_records")
          .select("*, doctors(full_name), profiles!medical_records_patient_id_fkey(full_name)")
          .order("record_date", { ascending: false });

        const filtered = (recs || []).filter(r => {
          return (r.diagnosis || "").toLowerCase().includes(q) || (r.symptoms || "").toLowerCase().includes(q);
        });

        const tbody = document.getElementById("adm-records-table-body");
        if (!tbody) return;

        if (filtered.length === 0) {
          tbody.innerHTML = `<tr><td colspan="7" class="text-center p-4 text-muted">No medical records found.</td></tr>`;
          return;
        }

        tbody.innerHTML = filtered.map(r => `
          <tr>
            <td class="font-medium">${App.Utils.formatDate(r.record_date)}</td>
            <td>${r.profiles?.full_name || "Patient"}</td>
            <td>Dr. ${r.doctors?.full_name || "Doctor"}</td>
            <td><span class="badge badge-primary">${r.diagnosis}</span></td>
            <td class="text-sm">${r.treatment || "—"}</td>
            <td class="text-sm text-muted">${r.followup_date ? App.Utils.formatDate(r.followup_date) : "—"}</td>
            <td>
              <button class="btn btn-secondary btn-sm" onclick="App.AdminMedicalRecords.openEditModal('${r.id}')">
                <i class="fa-solid fa-pen-to-square"></i> Edit
              </button>
            </td>
          </tr>
        `).join("");
      } catch (err) {
        console.error("Error loading medical records:", err);
      }
    },

    async openAddModal() {
      document.getElementById("modal-record-title").textContent = "Add Clinical Medical Record";
      document.getElementById("form-record-crud").reset();
      document.getElementById("rec-form-id").value = "";
      document.getElementById("rec-form-date").value = new Date().toISOString().split("T")[0];

      // Populate Patients and Doctors dropdowns
      const [pts, docs] = await Promise.all([
        App.Config.client.from("profiles").select("id, full_name").eq("role", "patient").order("full_name"),
        App.Config.client.from("doctors").select("id, full_name, specialization").eq("status", "active").order("full_name")
      ]);

      const pSelect = document.getElementById("rec-form-patient");
      const dSelect = document.getElementById("rec-form-doctor");

      if (pSelect && pts.data) {
        pSelect.innerHTML = pts.data.map(p => `<option value="${p.id}">${p.full_name}</option>`).join("");
      }
      if (dSelect && docs.data) {
        dSelect.innerHTML = docs.data.map(d => `<option value="${d.id}">${d.full_name} (${d.specialization})</option>`).join("");
      }

      App.UI.openModal("modal-record-form");
    },

    async openEditModal(id) {
      const { data: r } = await App.Config.client.from("medical_records").select("*").eq("id", id).single();
      if (!r) return;

      await App.AdminMedicalRecords.openAddModal();
      document.getElementById("modal-record-title").textContent = "Edit Clinical Medical Record";
      document.getElementById("rec-form-id").value = r.id;
      document.getElementById("rec-form-patient").value = r.patient_id;
      document.getElementById("rec-form-doctor").value = r.doctor_id;
      document.getElementById("rec-form-diagnosis").value = r.diagnosis;
      document.getElementById("rec-form-symptoms").value = r.symptoms || "";
      document.getElementById("rec-form-treatment").value = r.treatment || "";
      document.getElementById("rec-form-date").value = r.record_date || "";
      document.getElementById("rec-form-followup").value = r.followup_date || "";
    },

    async saveRecord(e) {
      e.preventDefault();
      const id = document.getElementById("rec-form-id").value;
      const patientId = document.getElementById("rec-form-patient").value;

      const payload = {
        patient_id: patientId,
        doctor_id: document.getElementById("rec-form-doctor").value,
        diagnosis: document.getElementById("rec-form-diagnosis").value.trim(),
        symptoms: document.getElementById("rec-form-symptoms").value.trim(),
        treatment: document.getElementById("rec-form-treatment").value.trim(),
        record_date: document.getElementById("rec-form-date").value || null,
        followup_date: document.getElementById("rec-form-followup").value || null
      };

      try {
        if (id) {
          await App.Config.client.from("medical_records").update(payload).eq("id", id);
          App.UI.toast("Medical record updated.", "success");
        } else {
          await App.Config.client.from("medical_records").insert(payload);
          await App.Config.client.from("notifications").insert({
            user_id: patientId,
            title: "New Medical Record Added",
            message: `Clinical record updated: ${payload.diagnosis}`,
            type: "info"
          });
          App.UI.toast("Medical record created.", "success");
        }
        App.UI.closeModal("modal-record-form");
        App.AdminMedicalRecords.loadRecords();
      } catch (err) {
        App.UI.toast("Failed to save medical record.", "error");
      }
    }
  },

  // -------------------------------------------------------------
  // 24. ADMIN PRESCRIPTIONS
  // -------------------------------------------------------------
  AdminPrescriptions: {
    async loadPrescriptions() {
      try {
        const { data: prescs } = await App.Config.client.from("prescriptions")
          .select("*, doctors(full_name), profiles!prescriptions_patient_id_fkey(full_name), prescription_items(*)")
          .order("prescription_date", { ascending: false });

        const tbody = document.getElementById("adm-prescriptions-table-body");
        if (!tbody || !prescs) return;

        if (prescs.length === 0) {
          tbody.innerHTML = `<tr><td colspan="6" class="text-center p-4 text-muted">No prescriptions issued yet.</td></tr>`;
          return;
        }

        tbody.innerHTML = prescs.map(p => `
          <tr>
            <td class="font-medium">${App.Utils.formatDate(p.prescription_date)}</td>
            <td>${p.profiles?.full_name || "Patient"}</td>
            <td>Dr. ${p.doctors?.full_name || "Doctor"}</td>
            <td class="text-sm font-semibold">${(p.prescription_items || []).map(i => i.medicine_name).join(", ") || "—"}</td>
            <td class="text-sm text-muted">${p.notes || "—"}</td>
            <td>
              <button class="btn btn-secondary btn-sm" onclick="App.PatientPrescriptions.viewPrescription('${p.id}')">
                <i class="fa-solid fa-print"></i> Print
              </button>
            </td>
          </tr>
        `).join("");
      } catch (err) {
        console.error("Error loading prescriptions:", err);
      }
    },

    async openAddModal() {
      document.getElementById("form-presc-crud").reset();
      const [pts, docs] = await Promise.all([
        App.Config.client.from("profiles").select("id, full_name").eq("role", "patient").order("full_name"),
        App.Config.client.from("doctors").select("id, full_name").eq("status", "active").order("full_name")
      ]);

      const pSelect = document.getElementById("presc-form-patient");
      const dSelect = document.getElementById("presc-form-doctor");

      if (pSelect && pts.data) pSelect.innerHTML = pts.data.map(p => `<option value="${p.id}">${p.full_name}</option>`).join("");
      if (dSelect && docs.data) dSelect.innerHTML = docs.data.map(d => `<option value="${d.id}">Dr. ${d.full_name}</option>`).join("");

      const container = document.getElementById("presc-items-container");
      if (container) {
        container.innerHTML = "";
        App.AdminPrescriptions.addMedicineRow();
      }

      App.UI.openModal("modal-prescription-form");
    },

    addMedicineRow() {
      const container = document.getElementById("presc-items-container");
      if (!container) return;

      const row = document.createElement("div");
      row.className = "presc-item-row card p-3 mb-2";
      row.style.background = "var(--bg-tertiary)";
      row.innerHTML = `
        <div class="form-row">
          <div class="form-group">
            <label>Medicine Name <span class="required">*</span></label>
            <input type="text" class="form-control presc-item-name" placeholder="e.g. Amoxicillin 500mg" required>
          </div>
          <div class="form-group">
            <label>Dosage</label>
            <input type="text" class="form-control presc-item-dose" placeholder="e.g. 1 Tablet">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Frequency</label>
            <input type="text" class="form-control presc-item-freq" placeholder="e.g. 3 times daily">
          </div>
          <div class="form-group">
            <label>Duration</label>
            <input type="text" class="form-control presc-item-dur" placeholder="e.g. 5 Days">
          </div>
        </div>
        <div class="flex justify-between items-center mt-1">
          <input type="text" class="form-control presc-item-inst" placeholder="Instructions (e.g. Take after food)">
          <button type="button" class="btn btn-danger btn-sm ml-2" onclick="this.closest('.presc-item-row').remove()" style="margin-left:0.5rem;">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      `;
      container.appendChild(row);
    },

    async savePrescription(e) {
      e.preventDefault();
      const patientId = document.getElementById("presc-form-patient").value;
      const doctorId = document.getElementById("presc-form-doctor").value;
      const notes = document.getElementById("presc-form-notes").value.trim();

      const items = [];
      document.querySelectorAll(".presc-item-row").forEach(row => {
        const name = row.querySelector(".presc-item-name").value.trim();
        if (name) {
          items.push({
            medicine_name: name,
            dosage: row.querySelector(".presc-item-dose").value.trim(),
            frequency: row.querySelector(".presc-item-freq").value.trim(),
            duration: row.querySelector(".presc-item-dur").value.trim(),
            instructions: row.querySelector(".presc-item-inst").value.trim()
          });
        }
      });

      if (items.length === 0) {
        App.UI.toast("Please add at least one medication.", "warning");
        return;
      }

      try {
        const { data: presc, error } = await App.Config.client.from("prescriptions").insert({
          patient_id: patientId,
          doctor_id: doctorId,
          notes
        }).select().single();

        if (error) throw error;

        // Insert items
        const itemRows = items.map(i => ({ ...i, prescription_id: presc.id }));
        await App.Config.client.from("prescription_items").insert(itemRows);

        // Notify patient
        await App.Config.client.from("notifications").insert({
          user_id: patientId,
          title: "New Prescription Issued",
          message: `Your prescription is ready with ${items.length} prescribed medication(s).`,
          type: "prescription"
        });

        App.UI.toast("Prescription issued successfully.", "success");
        App.UI.closeModal("modal-prescription-form");
        App.AdminPrescriptions.loadPrescriptions();
      } catch (err) {
        App.UI.toast("Failed to issue prescription.", "error");
      }
    }
  },

  // -------------------------------------------------------------
  // 25. ADMIN DIAGNOSTIC LAB REPORTS
  // -------------------------------------------------------------
  AdminLabReports: {
    async loadLabReports() {
      try {
        const { data: reports } = await App.Config.client.from("lab_reports")
          .select("*, doctors(full_name), profiles!lab_reports_patient_id_fkey(full_name)")
          .order("test_date", { ascending: false });

        const tbody = document.getElementById("adm-lab-reports-table-body");
        if (!tbody || !reports) return;

        if (reports.length === 0) {
          tbody.innerHTML = `<tr><td colspan="8" class="text-center p-4 text-muted">No diagnostic lab reports recorded.</td></tr>`;
          return;
        }

        tbody.innerHTML = reports.map(r => `
          <tr>
            <td class="font-semibold">${r.test_name}</td>
            <td>${App.Utils.formatDate(r.test_date)}</td>
            <td>${r.profiles?.full_name || "Patient"}</td>
            <td>Dr. ${r.doctors?.full_name || "Specialist"}</td>
            <td>${r.result || "—"}</td>
            <td class="text-sm text-muted">${r.reference_range || "—"}</td>
            <td>${App.Utils.getStatusBadge(r.status)}</td>
            <td>
              <button class="btn btn-secondary btn-sm" onclick="App.AdminLabReports.openEditModal('${r.id}')">
                <i class="fa-solid fa-pen-to-square"></i> Edit
              </button>
            </td>
          </tr>
        `).join("");
      } catch (err) {
        console.error("Error loading lab reports:", err);
      }
    },

    async openAddModal() {
      document.getElementById("modal-lab-title").textContent = "Add Diagnostic Lab Report";
      document.getElementById("form-lab-crud").reset();
      document.getElementById("lab-form-id").value = "";
      document.getElementById("lab-form-date").value = new Date().toISOString().split("T")[0];

      const [pts, docs] = await Promise.all([
        App.Config.client.from("profiles").select("id, full_name").eq("role", "patient").order("full_name"),
        App.Config.client.from("doctors").select("id, full_name").eq("status", "active").order("full_name")
      ]);

      const pSelect = document.getElementById("lab-form-patient");
      const dSelect = document.getElementById("lab-form-doctor");

      if (pSelect && pts.data) pSelect.innerHTML = pts.data.map(p => `<option value="${p.id}">${p.full_name}</option>`).join("");
      if (dSelect && docs.data) dSelect.innerHTML = docs.data.map(d => `<option value="${d.id}">Dr. ${d.full_name}</option>`).join("");

      App.UI.openModal("modal-lab-form");
    },

    async openEditModal(id) {
      const { data: r } = await App.Config.client.from("lab_reports").select("*").eq("id", id).single();
      if (!r) return;

      await App.AdminLabReports.openAddModal();
      document.getElementById("modal-lab-title").textContent = "Edit Lab Diagnostic Report";
      document.getElementById("lab-form-id").value = r.id;
      document.getElementById("lab-form-patient").value = r.patient_id;
      document.getElementById("lab-form-doctor").value = r.doctor_id || "";
      document.getElementById("lab-form-test").value = r.test_name;
      document.getElementById("lab-form-result").value = r.result || "";
      document.getElementById("lab-form-range").value = r.reference_range || "";
      document.getElementById("lab-form-date").value = r.test_date || "";
      document.getElementById("lab-form-status").value = r.status || "completed";
    },

    async saveLabReport(e) {
      e.preventDefault();
      const id = document.getElementById("lab-form-id").value;
      const patientId = document.getElementById("lab-form-patient").value;

      const payload = {
        patient_id: patientId,
        doctor_id: document.getElementById("lab-form-doctor").value || null,
        test_name: document.getElementById("lab-form-test").value.trim(),
        result: document.getElementById("lab-form-result").value.trim(),
        reference_range: document.getElementById("lab-form-range").value.trim(),
        test_date: document.getElementById("lab-form-date").value || null,
        status: document.getElementById("lab-form-status").value
      };

      try {
        if (id) {
          await App.Config.client.from("lab_reports").update(payload).eq("id", id);
          App.UI.toast("Lab report updated.", "success");
        } else {
          await App.Config.client.from("lab_reports").insert(payload);
          await App.Config.client.from("notifications").insert({
            user_id: patientId,
            title: "New Lab Report Ready",
            message: `Your diagnostic report for ${payload.test_name} is available.`,
            type: "lab_report"
          });
          App.UI.toast("Lab report recorded.", "success");
        }
        App.UI.closeModal("modal-lab-form");
        App.AdminLabReports.loadLabReports();
      } catch (err) {
        App.UI.toast("Failed to save lab report.", "error");
      }
    }
  },

  // -------------------------------------------------------------
  // 26. ADMIN PHARMACY & MEDICINES
  // -------------------------------------------------------------
  AdminMedicines: {
    async loadMedicines() {
      try {
        const q = (document.getElementById("adm-med-search")?.value || "").toLowerCase();
        const statusFilter = document.getElementById("adm-med-stock-filter")?.value;

        const { data: meds } = await App.Config.client.from("medicines").select("*").order("name");

        const filtered = (meds || []).filter(m => {
          const matchQ = m.name.toLowerCase().includes(q) || (m.manufacturer || "").toLowerCase().includes(q);
          const matchStatus = !statusFilter || m.stock_status === statusFilter;
          return matchQ && matchStatus;
        });

        const tbody = document.getElementById("adm-medicines-table-body");
        if (!tbody) return;

        if (filtered.length === 0) {
          tbody.innerHTML = `<tr><td colspan="9" class="text-center p-4 text-muted">No medicines found in pharmacy stock.</td></tr>`;
          return;
        }

        tbody.innerHTML = filtered.map(m => `
          <tr>
            <td class="font-bold">${m.name}</td>
            <td>${m.category || "—"}</td>
            <td>${m.manufacturer || "—"}</td>
            <td class="font-semibold ${m.quantity < 50 ? 'text-danger' : ''}">${m.quantity} Units</td>
            <td class="text-xs text-muted">${m.batch_number || "—"}</td>
            <td>${m.expiry_date ? App.Utils.formatDate(m.expiry_date) : "—"}</td>
            <td class="font-bold text-primary">₹${parseFloat(m.price || 0).toFixed(2)}</td>
            <td>${App.Utils.getStockBadge(m.stock_status, m.quantity)}</td>
            <td>
              <div class="cell-actions">
                <button title="Edit Medicine" onclick="App.AdminMedicines.openEditModal('${m.id}')">
                  <i class="fa-solid fa-pen-to-square"></i>
                </button>
              </div>
            </td>
          </tr>
        `).join("");
      } catch (err) {
        console.error("Error loading medicines:", err);
      }
    },

    openAddModal() {
      document.getElementById("modal-med-title").textContent = "Add Pharmacy Medicine";
      document.getElementById("form-med-crud").reset();
      document.getElementById("med-form-id").value = "";
      App.UI.openModal("modal-medicine-form");
    },

    async openEditModal(id) {
      const { data: m } = await App.Config.client.from("medicines").select("*").eq("id", id).single();
      if (!m) return;

      document.getElementById("modal-med-title").textContent = "Edit Medicine Stock";
      document.getElementById("med-form-id").value = m.id;
      document.getElementById("med-form-name").value = m.name;
      document.getElementById("med-form-cat").value = m.category || "";
      document.getElementById("med-form-mfg").value = m.manufacturer || "";
      document.getElementById("med-form-supplier").value = m.supplier || "";
      document.getElementById("med-form-qty").value = m.quantity || 0;
      document.getElementById("med-form-price").value = m.price || 0;
      document.getElementById("med-form-batch").value = m.batch_number || "";
      document.getElementById("med-form-expiry").value = m.expiry_date || "";
      document.getElementById("med-form-status").value = m.stock_status || "in_stock";

      App.UI.openModal("modal-medicine-form");
    },

    async saveMedicine(e) {
      e.preventDefault();
      const id = document.getElementById("med-form-id").value;
      const qty = parseInt(document.getElementById("med-form-qty").value) || 0;
      let stockStatus = document.getElementById("med-form-status").value;

      if (qty <= 0) stockStatus = "out_of_stock";
      else if (qty < 50) stockStatus = "low_stock";

      const payload = {
        name: document.getElementById("med-form-name").value.trim(),
        category: document.getElementById("med-form-cat").value.trim(),
        manufacturer: document.getElementById("med-form-mfg").value.trim(),
        supplier: document.getElementById("med-form-supplier").value.trim(),
        quantity: qty,
        price: parseFloat(document.getElementById("med-form-price").value) || 0,
        batch_number: document.getElementById("med-form-batch").value.trim(),
        expiry_date: document.getElementById("med-form-expiry").value || null,
        stock_status: stockStatus
      };

      try {
        if (id) {
          await App.Config.client.from("medicines").update(payload).eq("id", id);
          App.UI.toast("Medicine updated.", "success");
        } else {
          await App.Config.client.from("medicines").insert(payload);
          App.UI.toast("Medicine added to inventory.", "success");
        }
        App.UI.closeModal("modal-medicine-form");
        App.AdminMedicines.loadMedicines();
      } catch (err) {
        App.UI.toast("Failed to save medicine.", "error");
      }
    }
  },

  // -------------------------------------------------------------
  // 27. ADMIN ROOMS & BED OCCUPANCY
  // -------------------------------------------------------------
  AdminRooms: {
    async loadRooms() {
      try {
        const typeFilter = document.getElementById("adm-room-type-filter")?.value;
        const statusFilter = document.getElementById("adm-room-status-filter")?.value;

        const { data: rooms } = await App.Config.client.from("rooms").select("*, beds(*)").order("room_number");

        const filtered = (rooms || []).filter(r => {
          const matchType = !typeFilter || r.room_type === typeFilter;
          const matchStatus = !statusFilter || r.status === statusFilter;
          return matchType && matchStatus;
        });

        const tbody = document.getElementById("adm-rooms-table-body");
        if (!tbody) return;

        if (filtered.length === 0) {
          tbody.innerHTML = `<tr><td colspan="6" class="text-center p-4 text-muted">No rooms matching filter.</td></tr>`;
          return;
        }

        tbody.innerHTML = filtered.map(r => {
          const bedBadges = (r.beds || []).map(b => `
            <span class="badge ${b.is_available ? 'badge-success' : 'badge-danger'}" 
              style="cursor:pointer;" title="Click to toggle availability" onclick="App.AdminRooms.toggleBed('${b.id}', ${b.is_available})">
              Bed ${b.bed_number}: ${b.is_available ? 'Available' : 'Occupied'}
            </span>
          `).join(" ");

          return `
            <tr>
              <td class="font-bold">${r.room_number}</td>
              <td><span class="badge badge-primary">${r.room_type}</span></td>
              <td>Floor ${r.floor || 1}</td>
              <td>${App.Utils.getStatusBadge(r.status)}</td>
              <td>${bedBadges || "No beds configured"}</td>
              <td>
                <button class="btn btn-secondary btn-sm" onclick="App.AdminRooms.toggleRoomStatus('${r.id}', '${r.status}')">
                  Toggle Status
                </button>
              </td>
            </tr>
          `;
        }).join("");
      } catch (err) {
        console.error("Error loading rooms:", err);
      }
    },

    openAddModal() {
      document.getElementById("form-room-crud").reset();
      App.UI.openModal("modal-room-form");
    },

    async saveRoom(e) {
      e.preventDefault();
      const num = document.getElementById("room-form-num").value.trim();
      const type = document.getElementById("room-form-type").value;
      const floor = parseInt(document.getElementById("room-form-floor").value) || 1;

      try {
        const { data: room, error } = await App.Config.client.from("rooms").insert({
          room_number: num,
          room_type: type,
          floor,
          status: "available"
        }).select().single();

        if (error) throw error;

        // Auto-create 2 beds
        await App.Config.client.from("beds").insert([
          { room_id: room.id, bed_number: "A", is_available: true },
          { room_id: room.id, bed_number: "B", is_available: true }
        ]);

        App.UI.toast(`Room ${num} created with 2 beds.`, "success");
        App.UI.closeModal("modal-room-form");
        App.AdminRooms.loadRooms();
      } catch (err) {
        App.UI.toast("Failed to create room.", "error");
      }
    },

    async toggleBed(bedId, currentAvail) {
      App.UI.confirm(`Toggle bed to ${currentAvail ? 'OCCUPIED' : 'AVAILABLE'}?`, async () => {
        await App.Config.client.from("beds").update({ is_available: !currentAvail }).eq("id", bedId);
        App.UI.toast("Bed status updated.", "info");
        App.AdminRooms.loadRooms();
      });
    },

    async toggleRoomStatus(roomId, currentStatus) {
      const nextStatus = currentStatus === "available" ? "occupied" : "available";
      await App.Config.client.from("rooms").update({ status: nextStatus }).eq("id", roomId);
      App.UI.toast(`Room marked as ${nextStatus}.`, "info");
      App.AdminRooms.loadRooms();
    }
  },

  // -------------------------------------------------------------
  // 28. ADMIN EMERGENCY CASES
  // -------------------------------------------------------------
  AdminEmergency: {
    async loadEmergencies() {
      try {
        const priorityFilter = document.getElementById("adm-emg-priority-filter")?.value;
        const statusFilter = document.getElementById("adm-emg-status-filter")?.value;

        let q = App.Config.client.from("emergency_cases").select("*, doctors(full_name), rooms(room_number, room_type)");

        if (priorityFilter) q = q.eq("priority", priorityFilter);
        if (statusFilter) q = q.eq("status", statusFilter);

        const { data: cases } = await q.order("arrival_time", { ascending: false });
        const tbody = document.getElementById("adm-emergency-table-body");
        if (!tbody) return;

        if (!cases || cases.length === 0) {
          tbody.innerHTML = `<tr><td colspan="9" class="text-center p-4 text-muted">No emergency trauma cases matching filter.</td></tr>`;
          return;
        }

        tbody.innerHTML = cases.map(c => `
          <tr>
            <td class="text-xs font-semibold">${App.Utils.timeAgo(c.arrival_time)}</td>
            <td class="font-bold">${c.patient_name}</td>
            <td>${c.contact_number || "—"}</td>
            <td class="text-danger font-medium">${c.emergency_type}</td>
            <td><span class="badge priority-${c.priority}">${c.priority.toUpperCase()}</span></td>
            <td>Dr. ${c.doctors?.full_name || "Trauma Team"}</td>
            <td>${c.rooms?.room_number ? `${c.rooms.room_number} (${c.rooms.room_type})` : "ER Bay"}</td>
            <td>${App.Utils.getStatusBadge(c.status)}</td>
            <td>
              <select class="form-control" style="font-size:0.75rem; padding:0.2rem 0.5rem;" onchange="App.AdminEmergency.updateStatus('${c.id}', this.value)">
                <option value="active" ${c.status === 'active' ? 'selected' : ''}>Active</option>
                <option value="stabilized" ${c.status === 'stabilized' ? 'selected' : ''}>Stabilized</option>
                <option value="admitted" ${c.status === 'admitted' ? 'selected' : ''}>Admitted</option>
                <option value="discharged" ${c.status === 'discharged' ? 'selected' : ''}>Discharged</option>
              </select>
            </td>
          </tr>
        `).join("");
      } catch (err) {
        console.error("Error loading emergencies:", err);
      }
    },

    async openAddModal() {
      document.getElementById("form-emergency-crud").reset();
      const [docs, rms] = await Promise.all([
        App.Config.client.from("doctors").select("id, full_name").eq("status", "active"),
        App.Config.client.from("rooms").select("id, room_number, room_type").eq("status", "available")
      ]);

      const dSelect = document.getElementById("emg-form-doc");
      const rSelect = document.getElementById("emg-form-room");

      if (dSelect && docs.data) dSelect.innerHTML = `<option value="">-- Assign Emergency Doctor --</option>` + docs.data.map(d => `<option value="${d.id}">Dr. ${d.full_name}</option>`).join("");
      if (rSelect && rms.data) rSelect.innerHTML = `<option value="">-- Assign ER Room / Bay --</option>` + rms.data.map(r => `<option value="${r.id}">${r.room_number} (${r.room_type})</option>`).join("");

      App.UI.openModal("modal-emergency-form");
    },

    async saveEmergency(e) {
      e.preventDefault();
      const payload = {
        patient_name: document.getElementById("emg-form-name").value.trim(),
        contact_number: document.getElementById("emg-form-phone").value.trim(),
        emergency_type: document.getElementById("emg-form-type").value.trim(),
        priority: document.getElementById("emg-form-priority").value,
        doctor_id: document.getElementById("emg-form-doc").value || null,
        room_id: document.getElementById("emg-form-room").value || null,
        notes: document.getElementById("emg-form-notes").value.trim(),
        status: "active"
      };

      try {
        await App.Config.client.from("emergency_cases").insert(payload);
        App.UI.toast("Emergency case logged and triaged.", "danger");
        App.UI.closeModal("modal-emergency-form");
        App.AdminEmergency.loadEmergencies();
      } catch (err) {
        App.UI.toast("Failed to log emergency case.", "error");
      }
    },

    async updateStatus(id, newStatus) {
      await App.Config.client.from("emergency_cases").update({ status: newStatus }).eq("id", id);
      App.UI.toast(`Emergency status changed to ${newStatus}.`, "info");
      App.AdminEmergency.loadEmergencies();
    }
  },

  // -------------------------------------------------------------
  // 29. ADMIN BILLING & REVENUE
  // -------------------------------------------------------------
  AdminBilling: {
    async loadBilling() {
      try {
        const statusFilter = document.getElementById("adm-bill-status-filter")?.value;
        let q = App.Config.client.from("billing").select("*, profiles!billing_patient_id_fkey(full_name)");

        if (statusFilter) q = q.eq("payment_status", statusFilter);

        const { data: bills } = await q.order("invoice_date", { ascending: false });
        const tbody = document.getElementById("adm-billing-table-body");
        if (!tbody) return;

        if (!bills || bills.length === 0) {
          tbody.innerHTML = `<tr><td colspan="11" class="text-center p-4 text-muted">No invoices generated yet.</td></tr>`;
          return;
        }

        tbody.innerHTML = bills.map(b => `
          <tr>
            <td class="font-medium">${App.Utils.formatDate(b.invoice_date)}</td>
            <td>${b.profiles?.full_name || "Patient"}</td>
            <td>₹${parseFloat(b.consultation_fee || 0).toFixed(2)}</td>
            <td>₹${parseFloat(b.lab_charges || 0).toFixed(2)}</td>
            <td>₹${parseFloat(b.medicine_charges || 0).toFixed(2)}</td>
            <td>₹${parseFloat(b.room_charges || 0).toFixed(2)}</td>
            <td class="font-bold">₹${parseFloat(b.total_amount || 0).toFixed(2)}</td>
            <td class="text-success font-semibold">₹${parseFloat(b.paid_amount || 0).toFixed(2)}</td>
            <td class="text-danger font-semibold">₹${parseFloat(b.remaining_amount || 0).toFixed(2)}</td>
            <td>${App.Utils.getStatusBadge(b.payment_status)}</td>
            <td>
              <div class="cell-actions">
                <button class="btn btn-secondary btn-sm" onclick="App.AdminBilling.openPaymentModal('${b.id}', '${b.patient_id}', ${b.remaining_amount})" title="Collect Payment">
                  <i class="fa-solid fa-indian-rupee-sign"></i> Pay
                </button>
                <button class="btn btn-secondary btn-sm" onclick="App.PatientBilling.viewInvoice('${b.id}')" title="Print Invoice">
                  <i class="fa-solid fa-print"></i>
                </button>
              </div>
            </td>
          </tr>
        `).join("");
      } catch (err) {
        console.error("Error loading admin billing:", err);
      }
    },

    async openAddModal() {
      document.getElementById("form-billing-crud").reset();
      const { data: pts } = await App.Config.client.from("profiles").select("id, full_name").eq("role", "patient").order("full_name");
      const pSelect = document.getElementById("bill-form-patient");
      if (pSelect && pts) {
        pSelect.innerHTML = pts.map(p => `<option value="${p.id}">${p.full_name}</option>`).join("");
      }
      App.AdminBilling.calcTotal();
      App.UI.openModal("modal-billing-form");
    },

    calcTotal() {
      const c = parseFloat(document.getElementById("bill-form-consult").value) || 0;
      const l = parseFloat(document.getElementById("bill-form-lab").value) || 0;
      const m = parseFloat(document.getElementById("bill-form-meds").value) || 0;
      const r = parseFloat(document.getElementById("bill-form-room").value) || 0;
      const o = parseFloat(document.getElementById("bill-form-other").value) || 0;
      const total = c + l + m + r + o;
      const totalEl = document.getElementById("bill-calc-total");
      if (totalEl) totalEl.textContent = `₹${total.toFixed(2)}`;
    },

    async saveBill(e) {
      e.preventDefault();
      const patientId = document.getElementById("bill-form-patient").value;
      const c = parseFloat(document.getElementById("bill-form-consult").value) || 0;
      const l = parseFloat(document.getElementById("bill-form-lab").value) || 0;
      const m = parseFloat(document.getElementById("bill-form-meds").value) || 0;
      const r = parseFloat(document.getElementById("bill-form-room").value) || 0;
      const o = parseFloat(document.getElementById("bill-form-other").value) || 0;
      const paid = parseFloat(document.getElementById("bill-form-paid").value) || 0;

      try {
        await App.Config.client.from("billing").insert({
          patient_id: patientId,
          consultation_fee: c,
          lab_charges: l,
          medicine_charges: m,
          room_charges: r,
          other_charges: o,
          paid_amount: paid
        });

        await App.Config.client.from("notifications").insert({
          user_id: patientId,
          title: "New Hospital Invoice Generated",
          message: `An invoice has been generated for your recent services.`,
          type: "billing"
        });

        App.UI.toast("Invoice generated.", "success");
        App.UI.closeModal("modal-billing-form");
        App.AdminBilling.loadBilling();
      } catch (err) {
        App.UI.toast("Failed to generate bill.", "error");
      }
    },

    openPaymentModal(billId, patientId, remaining) {
      document.getElementById("pay-form-bill-id").value = billId;
      document.getElementById("pay-form-patient-id").value = patientId;
      document.getElementById("pay-form-amount").value = remaining > 0 ? remaining : 0;
      App.UI.openModal("modal-payment-form");
    },

    async savePayment(e) {
      e.preventDefault();
      const billId = document.getElementById("pay-form-bill-id").value;
      const patientId = document.getElementById("pay-form-patient-id").value;
      const amount = parseFloat(document.getElementById("pay-form-amount").value) || 0;
      const method = document.getElementById("pay-form-method").value;
      const ref = document.getElementById("pay-form-ref").value.trim();

      try {
        // Insert payment log
        await App.Config.client.from("payments").insert({
          billing_id: billId,
          patient_id: patientId,
          amount,
          payment_method: method,
          transaction_ref: ref
        });

        // Update billing table
        const { data: currentBill } = await App.Config.client.from("billing").select("paid_amount").eq("id", billId).single();
        const newPaid = (parseFloat(currentBill?.paid_amount || 0) + amount);
        await App.Config.client.from("billing").update({ paid_amount: newPaid }).eq("id", billId);

        App.UI.toast(`Payment of ₹${amount.toFixed(2)} recorded.`, "success");
        App.UI.closeModal("modal-payment-form");
        App.AdminBilling.loadBilling();
      } catch (err) {
        App.UI.toast("Failed to record payment.", "error");
      }
    }
  },

  // -------------------------------------------------------------
  // 30. ADMIN NOTIFICATIONS BROADCAST
  // -------------------------------------------------------------
  AdminNotifications: {
    async loadNotifications() {
      try {
        const { data: notifs } = await App.Config.client.from("notifications")
          .select("*, profiles!notifications_user_id_fkey(full_name, email)")
          .order("created_at", { ascending: false });

        const tbody = document.getElementById("adm-notifications-table-body");
        if (!tbody || !notifs) return;

        if (notifs.length === 0) {
          tbody.innerHTML = `<tr><td colspan="6" class="text-center p-4 text-muted">No notification alerts logged.</td></tr>`;
          return;
        }

        tbody.innerHTML = notifs.map(n => `
          <tr>
            <td class="text-xs text-muted">${App.Utils.formatDate(n.created_at)}</td>
            <td>${n.profiles?.full_name || n.profiles?.email || "User"}</td>
            <td class="font-semibold">${n.title}</td>
            <td class="text-sm">${n.message}</td>
            <td><span class="badge badge-primary">${n.type}</span></td>
            <td>${n.is_read ? '<span class="badge badge-success">Read</span>' : '<span class="badge badge-warning">Unread</span>'}</td>
          </tr>
        `).join("");
      } catch (err) {
        console.error("Error loading admin notifications:", err);
      }
    },

    async openSendModal() {
      document.getElementById("form-notif-crud").reset();
      const { data: pts } = await App.Config.client.from("profiles").select("id, full_name, role").order("full_name");
      const pSelect = document.getElementById("notif-form-patient");
      if (pSelect && pts) {
        pSelect.innerHTML = pts.map(p => `<option value="${p.id}">${p.full_name} (${p.role})</option>`).join("");
      }
      App.UI.openModal("modal-notification-form");
    },

    async sendNotification(e) {
      e.preventDefault();
      const userId = document.getElementById("notif-form-patient").value;
      const title = document.getElementById("notif-form-title").value.trim();
      const msg = document.getElementById("notif-form-msg").value.trim();
      const type = document.getElementById("notif-form-type").value;

      try {
        await App.Config.client.from("notifications").insert({
          user_id: userId,
          title,
          message: msg,
          type
        });
        App.UI.toast("Alert dispatched successfully.", "success");
        App.UI.closeModal("modal-notification-form");
        App.AdminNotifications.loadNotifications();
      } catch (err) {
        App.UI.toast("Failed to dispatch alert.", "error");
      }
    }
  },

  // -------------------------------------------------------------
  // 31. ADMIN ACTIVITY AUDIT LOGS
  // -------------------------------------------------------------
  AdminLogs: {
    async loadLogs() {
      try {
        const { data: logs } = await App.Config.client.from("activity_logs")
          .select("*, profiles!activity_logs_user_id_fkey(full_name, email)")
          .order("created_at", { ascending: false })
          .limit(50);

        const tbody = document.getElementById("adm-logs-table-body");
        if (!tbody || !logs) return;

        if (logs.length === 0) {
          tbody.innerHTML = `<tr><td colspan="5" class="text-center p-4 text-muted">No audit activity logged.</td></tr>`;
          return;
        }

        tbody.innerHTML = logs.map(l => `
          <tr>
            <td class="text-xs text-muted">${App.Utils.formatDate(l.created_at)}</td>
            <td>${l.profiles?.full_name || "System"}</td>
            <td><span class="badge badge-primary">${l.action}</span></td>
            <td class="text-sm">${l.entity_type || "—"}</td>
            <td class="text-xs text-muted font-mono">${JSON.stringify(l.details || {})}</td>
          </tr>
        `).join("");
      } catch (err) {
        console.error("Error loading activity logs:", err);
      }
    }
  },

  // -------------------------------------------------------------
  // 32. ADMIN SYSTEM SETTINGS
  // -------------------------------------------------------------
  AdminSettings: {
    async loadSettings() {
      try {
        const { data: sets } = await App.Config.client.from("hospital_settings").select("*");
        if (!sets) return;

        const map = {};
        sets.forEach(s => { map[s.key] = s.value; });

        if (map.hospital_name) document.getElementById("set-hospital-name").value = map.hospital_name;
        if (map.hospital_tagline) document.getElementById("set-hospital-tagline").value = map.hospital_tagline;
        if (map.hospital_phone) document.getElementById("set-hospital-phone").value = map.hospital_phone;
        if (map.emergency_phone) document.getElementById("set-emergency-phone").value = map.emergency_phone;
        if (map.hospital_email) document.getElementById("set-hospital-email").value = map.hospital_email;
        if (map.hospital_address) document.getElementById("set-hospital-address").value = map.hospital_address;
        if (map.appointment_slot_duration) document.getElementById("set-slot-duration").value = map.appointment_slot_duration;
      } catch (err) {
        console.error("Error loading hospital settings:", err);
      }
    },

    async saveSettings(e) {
      e.preventDefault();
      const settings = [
        { key: "hospital_name", value: document.getElementById("set-hospital-name").value.trim() },
        { key: "hospital_tagline", value: document.getElementById("set-hospital-tagline").value.trim() },
        { key: "hospital_phone", value: document.getElementById("set-hospital-phone").value.trim() },
        { key: "emergency_phone", value: document.getElementById("set-emergency-phone").value.trim() },
        { key: "hospital_email", value: document.getElementById("set-hospital-email").value.trim() },
        { key: "hospital_address", value: document.getElementById("set-hospital-address").value.trim() },
        { key: "appointment_slot_duration", value: document.getElementById("set-slot-duration").value.trim() }
      ];

      try {
        for (const s of settings) {
          await App.Config.client.from("hospital_settings").upsert(s, { onConflict: "key" });
        }
        App.UI.toast("Hospital settings saved.", "success");
      } catch (err) {
        App.UI.toast("Failed to update settings.", "error");
      }
    }
  },

  // -------------------------------------------------------------
  // 33. CSV DATA EXPORT TOOLS
  // -------------------------------------------------------------
  AdminExport: {
    async exportCSV(entity) {
      try {
        App.UI.toast(`Preparing ${entity} export...`, "info");
        const tables = {
          doctors: "doctors",
          patients: "profiles",
          appointments: "appointments",
          billing: "billing",
          medicines: "medicines"
        };
        const tbl = tables[entity] || entity;
        const { data, error } = await App.Config.client.from(tbl).select("*");

        if (error || !data || data.length === 0) {
          App.UI.toast("No records available to export.", "warning");
          return;
        }

        const headers = Object.keys(data[0]);
        const csvRows = [headers.join(",")];

        data.forEach(row => {
          const values = headers.map(h => {
            const val = row[h];
            if (val === null || val === undefined) return '""';
            return `"${String(val).replace(/"/g, '""')}"`;
          });
          csvRows.push(values.join(","));
        });

        const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `medicare_${entity}_${new Date().toISOString().split("T")[0]}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);
        App.UI.toast("CSV file downloaded.", "success");
      } catch (err) {
        App.UI.toast("Export failed.", "error");
      }
    }
  },

  // -------------------------------------------------------------
  // 34. REALTIME SUBSCRIPTIONS
  // -------------------------------------------------------------
  Realtime: {
    setup() {
      const db = App.Config.client;
      if (!db || !App.State.user) return;

      db.channel("public-notifications")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${App.State.user.id}` }, payload => {
          App.UI.toast(payload.new.title, "info");
          App.Notifications.loadUnread();
        })
        .subscribe();
    }
  },

  // -------------------------------------------------------------
  // 35. USER INTERFACE & UTILITIES
  // -------------------------------------------------------------
  UI: {
    initTheme() {
      const savedTheme = localStorage.getItem("medicare_theme") || "light";
      document.documentElement.setAttribute("data-theme", savedTheme);
      App.UI.updateThemeIcon(savedTheme);
    },

    toggleTheme() {
      const current = document.documentElement.getAttribute("data-theme") || "light";
      const next = current === "light" ? "dark" : "light";
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem("medicare_theme", next);
      App.UI.updateThemeIcon(next);
    },

    updateThemeIcon(theme) {
      const icons = [document.getElementById("topbar-theme-icon"), document.querySelector("#landing-theme-toggle i")];
      icons.forEach(i => {
        if (i) i.className = theme === "dark" ? "fa-solid fa-sun" : "fa-solid fa-moon";
      });
    },

    toast(message, type = "info") {
      const container = document.getElementById("toast-container");
      if (!container) return;

      const toast = document.createElement("div");
      toast.className = `toast ${type}`;
      const iconMap = {
        success: "fa-check",
        error: "fa-triangle-exclamation",
        warning: "fa-exclamation",
        info: "fa-info"
      };

      toast.innerHTML = `
        <div class="toast-icon"><i class="fa-solid ${iconMap[type] || 'fa-info'}"></i></div>
        <div class="toast-content">
          <div class="toast-title">${type.toUpperCase()}</div>
          <div class="toast-message">${message}</div>
        </div>
        <button class="toast-close" onclick="this.parentElement.remove()">&times;</button>
      `;

      container.appendChild(toast);
      setTimeout(() => {
        toast.classList.add("removing");
        setTimeout(() => toast.remove(), 300);
      }, 4000);
    },

    confirm(message, onConfirm) {
      const modal = document.getElementById("confirm-modal");
      const msgEl = document.getElementById("confirm-message");
      const confirmBtn = document.getElementById("confirm-action-btn");
      const cancelBtn = document.getElementById("confirm-cancel-btn");

      if (!modal) return;
      if (msgEl) msgEl.textContent = message;

      modal.classList.add("show");

      const cleanup = () => {
        modal.classList.remove("show");
        confirmBtn.onclick = null;
        cancelBtn.onclick = null;
      };

      confirmBtn.onclick = () => {
        cleanup();
        if (onConfirm) onConfirm();
      };
      cancelBtn.onclick = cleanup;
    },

    openModal(id) {
      const el = document.getElementById(id);
      if (el) el.classList.add("show");
    },

    closeModal(id) {
      const el = document.getElementById(id);
      if (el) el.classList.remove("show");
    },

    toggleSidebar() {
      const sidebar = document.getElementById("app-sidebar");
      const overlay = document.getElementById("sidebar-overlay");
      if (sidebar) sidebar.classList.toggle("open");
      if (overlay) overlay.classList.toggle("show");
    },

    closeSidebarMobile() {
      const sidebar = document.getElementById("app-sidebar");
      const overlay = document.getElementById("sidebar-overlay");
      if (sidebar) sidebar.classList.remove("open");
      if (overlay) overlay.classList.remove("show");
    },

    toggleProfileDropdown() {
      const dd = document.getElementById("topbar-profile-dropdown");
      if (dd) dd.classList.toggle("show");
    },

    toggleNotificationDropdown() {
      const dd = document.getElementById("topbar-notif-dropdown");
      if (dd) dd.classList.toggle("show");
    },

    closeDropdowns() {
      document.querySelectorAll(".profile-dropdown, .notification-dropdown").forEach(d => d.classList.remove("show"));
    }
  },

  // -------------------------------------------------------------
  // 36. GENERAL UTILITIES
  // -------------------------------------------------------------
  Utils: {
    formatDate(dateStr) {
      if (!dateStr) return "—";
      try {
        const d = new Date(dateStr);
        return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      } catch {
        return dateStr;
      }
    },

    timeAgo(dateStr) {
      if (!dateStr) return "";
      const seconds = Math.floor((new Date() - new Date(dateStr)) / 1000);
      let interval = seconds / 31536000;
      if (interval > 1) return Math.floor(interval) + " years ago";
      interval = seconds / 2592000;
      if (interval > 1) return Math.floor(interval) + " months ago";
      interval = seconds / 86400;
      if (interval > 1) return Math.floor(interval) + " days ago";
      interval = seconds / 3600;
      if (interval > 1) return Math.floor(interval) + "h ago";
      interval = seconds / 60;
      if (interval > 1) return Math.floor(interval) + "m ago";
      return "Just now";
    },

    getStatusBadge(status) {
      const map = {
        pending: "badge-warning",
        confirmed: "badge-primary",
        completed: "badge-success",
        cancelled: "badge-danger",
        rejected: "badge-danger",
        paid: "badge-success",
        partially_paid: "badge-warning",
        active: "badge-success",
        inactive: "badge-secondary"
      };
      return `<span class="badge ${map[status] || 'badge-primary'}">${(status || '').replace('_', ' ').toUpperCase()}</span>`;
    },

    getStockBadge(status, qty) {
      if (qty <= 0 || status === "out_of_stock") return `<span class="badge badge-danger">Out of Stock</span>`;
      if (qty < 50 || status === "low_stock") return `<span class="badge badge-warning">Low Stock Alert</span>`;
      return `<span class="badge badge-success">In Stock</span>`;
    }
  }
};

// Global click listener to close dropdown menus on outside click
document.addEventListener("click", e => {
  if (!e.target.closest(".topbar-profile") && !e.target.closest("#topbar-notif-btn") && !e.target.closest(".notification-dropdown")) {
    App.UI.closeDropdowns();
  }
});

// Document Ready Bootstrap
document.addEventListener("DOMContentLoaded", () => {
  App.init();
});
